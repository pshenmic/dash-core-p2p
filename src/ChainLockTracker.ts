import EventEmitter from 'eventemitter3';
import { Pool } from './Pool.js';
import { Peer } from './Peer.js';
import { hexToBytes, bytesToHex, reverseBytes } from './utils/binary.js';
import type { Message } from './messages/Message.js';
import type { CLSigArgs } from './messages/commands/CLSigMessage.js';

/**
 * A ChainLock signature observation (DIP-8).
 *
 * `blockHash` is in DISPLAY order (matches `BlockHeader.hash()` and RPC),
 * not the wire-order hex returned by `CLSigMessage.blockHash`. Conversion
 * happens once when we ingest the message.
 */
export interface ChainLockInfo {
  height: number;
  blockHash: string;
  sig: Uint8Array;
  /** Peers that reported this exact (height, hash) pair. */
  reportedBy: Set<Peer>;
}

/**
 * Conflict observation: two peers reported different blockHash at the same
 * height, OR a peer reported a hash for a height that conflicts with the
 * already-locked tip. Per Dash Core (`InternalHasConflictingChainLock`),
 * this is either a malicious peer or a network partition — never normal.
 */
export interface ChainLockConflict {
  atHeight: number;
  existingHash: string;
  incomingHash: string;
  peer: Peer;
}

export interface ChainLockTrackerOptions {
  /**
   * Number of distinct peers that must report the same (height, hash)
   * before the tracker treats it as the new best lock. Default 1.
   *
   * Why this exists: this SDK has no BLS verification, so we cannot
   * cryptographically validate `sig`. A single malicious peer can fabricate
   * any (height, hash, sig) tuple. Requiring corroboration from ≥2 peers
   * raises the bar materially since they must be in collusion. For a wallet
   * with >=4 diverse peers, set this to 2.
   */
  minPeerConfirmations?: number;
  /**
   * Cap on the number of recent conflicts retained for diagnostics.
   * Default 16. The tracker only ever needs the most recent few; this
   * keeps memory bounded under sustained adversarial input.
   */
  maxConflictHistory?: number;
}

/**
 * Tracks the best ChainLock observed on the wire.
 *
 * What this module **does**:
 *   - Listens for `peerclsig`.
 *   - Maintains a strictly-monotonic-by-height best lock.
 *   - Surfaces conflict observations (two hashes at one height).
 *   - Tells you whether a given height is at or below the locked tip.
 *
 * What this module **does NOT do** (caller responsibilities):
 *   1. **BLS signature verification.** Not available in this SDK. The
 *      `minPeerConfirmations` knob is the only defense; on a healthy peer
 *      set, set it to ≥2. On an eclipsed peer set, no number is enough.
 *   2. **Chain ancestry.** A ChainLock at (H, X) makes every ancestor of
 *      X final. This module knows nothing about your header chain, so it
 *      cannot tell you whether YOUR block at height H' ≤ H is one of
 *      those ancestors. Callers with header state must check
 *      `myHash === best.blockHash || isAncestor(myHash, best.blockHash)`.
 *      Without that check, `isHeightCovered(H')` only proves that some
 *      block at H' is locked, not necessarily yours.
 *
 * Events:
 *   - `update`   (best: ChainLockInfo, prev: ChainLockInfo | null)
 *                The best lock advanced to a new height.
 *   - `conflict` (conflict: ChainLockConflict)
 *                A peer reported a hash that contradicts what we already
 *                accept at that height. Caller may want to ban the peer.
 *   - `stale`    (info: { height: number; from: Peer })
 *                A peer reported a clsig at or below our best height with
 *                a matching hash. Normal during initial relay; ignored.
 *   - `error`    (err: Error, peer?: Peer)
 *                Malformed clsig payload from a peer.
 */
export class ChainLockTracker extends EventEmitter {
  readonly pool: Pool;
  readonly minPeerConfirmations: number;
  readonly maxConflictHistory: number;

  /** The current best ChainLock, or null if none observed yet. */
  best: ChainLockInfo | null = null;
  /**
   * Locks pending corroboration: keyed by `${height}:${displayHash}`.
   * Once `reportedBy.size >= minPeerConfirmations` the entry promotes.
   */
  pending: Map<string, ChainLockInfo> = new Map();
  /** Recent conflict events, capped at `maxConflictHistory`. */
  conflicts: ChainLockConflict[] = [];

  private _closed: boolean = false;
  private _detachers: Array<() => void> = [];

  constructor(pool: Pool, options?: ChainLockTrackerOptions) {
    super();
    if (pool == null) {
      throw new TypeError('ChainLockTracker: pool is required');
    }
    this.pool = pool;
    this.minPeerConfirmations = Math.max(1, options?.minPeerConfirmations ?? 1);
    this.maxConflictHistory = Math.max(1, options?.maxConflictHistory ?? 16);
    this._attach();
  }

  /** True once `close()` has been called. */
  get closed(): boolean {
    return this._closed;
  }

  /**
   * True iff some block at `height` is chain-locked. Caller must still
   * verify their block hash is an ancestor of `best.blockHash` to claim
   * finality for a specific block (see class doc).
   */
  isHeightCovered(height: number): boolean {
    return this.best != null && height <= this.best.height;
  }

  /**
   * True iff `blockHash` at `height` matches the current locked tip
   * exactly. This is the only ancestry claim the tracker can prove on
   * its own — for ancestors below the tip, the caller's chain logic must
   * confirm `blockHash` is on the ancestor path of `best.blockHash`.
   */
  isExactLockedTip(blockHash: string, height: number): boolean {
    if (this.best == null) return false;
    return this.best.height === height && this.best.blockHash === blockHash.toLowerCase();
  }

  /** Detach all pool listeners. Idempotent. */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    for (const off of this._detachers) {
      try { off(); } catch { /* swallow */ }
    }
    this._detachers.length = 0;
  }

  private _attach(): void {
    const onClsig = (peer: Peer, msg: Message & CLSigArgs) => {
      this._ingest(peer, msg);
    };
    this._bind('peerclsig', onClsig);
  }

  private _bind(event: string, handler: (...args: any[]) => void): void {
    this.pool.on(event, handler);
    this._detachers.push(() => this.pool.off(event, handler));
  }

  private _ingest(peer: Peer, msg: Message & CLSigArgs): void {
    if (this._closed) return;
    const height = (msg as { height?: number }).height;
    const wireHashHex = (msg as { blockHash?: string }).blockHash;
    const sig = (msg as { sig?: Uint8Array }).sig;

    if (typeof height !== 'number' || !Number.isInteger(height) || height < 0) {
      this.emit('error', new Error('clsig: invalid height'), peer);
      return;
    }
    if (typeof wireHashHex !== 'string' || !/^[0-9a-f]{64}$/.test(wireHashHex)) {
      this.emit('error', new Error('clsig: invalid blockHash'), peer);
      return;
    }
    if (!(sig instanceof Uint8Array) || sig.length !== 96) {
      this.emit('error', new Error('clsig: invalid sig length'), peer);
      return;
    }

    // CLSigMessage stores blockHash as hex of WIRE bytes. Flip to display
    // order so callers can compare with BlockHeader.hash() / RPC hashes.
    const displayHash = bytesToHex(reverseBytes(hexToBytes(wireHashHex)));

    // Dash Core: clsigs at height <= best.height are dropped, but a
    // SAME-height same-hash relay is normal — just record the corroboration
    // (it may have come from a different peer).
    if (this.best != null && height < this.best.height) {
      this.emit('stale', { height, from: peer });
      return;
    }
    if (this.best != null && height === this.best.height) {
      if (this.best.blockHash === displayHash) {
        this.best.reportedBy.add(peer);
        this.emit('stale', { height, from: peer });
        return;
      }
      // Conflicting clsig at the locked height: per Dash Core, this is a
      // protocol-level red flag (reorg attempt or bad peer).
      this._recordConflict({
        atHeight: height,
        existingHash: this.best.blockHash,
        incomingHash: displayHash,
        peer,
      });
      return;
    }

    // height > best.height (or best is null) — candidate for promotion.
    const key = `${height}:${displayHash}`;

    // Reject if a competing hash at the same pending height already exists
    // with a *different* hash. That's the same conflict shape as above.
    for (const [k, info] of this.pending) {
      if (info.height === height && info.blockHash !== displayHash) {
        this._recordConflict({
          atHeight: height,
          existingHash: info.blockHash,
          incomingHash: displayHash,
          peer,
        });
        return;
      }
      // Garbage-collect pending entries that the network has moved past.
      if (this.best != null && info.height <= this.best.height) {
        this.pending.delete(k);
      }
    }

    let entry = this.pending.get(key);
    if (!entry) {
      entry = {
        height,
        blockHash: displayHash,
        sig,
        reportedBy: new Set<Peer>(),
      };
      this.pending.set(key, entry);
    }
    entry.reportedBy.add(peer);

    if (entry.reportedBy.size >= this.minPeerConfirmations) {
      const prev = this.best;
      this.best = entry;
      this.pending.delete(key);
      // Drop any pending entries we've now superseded.
      for (const [k, info] of this.pending) {
        if (info.height <= entry.height) this.pending.delete(k);
      }
      this.emit('update', entry, prev);
    }
  }

  private _recordConflict(c: ChainLockConflict): void {
    this.conflicts.push(c);
    if (this.conflicts.length > this.maxConflictHistory) {
      this.conflicts.splice(0, this.conflicts.length - this.maxConflictHistory);
    }
    this.emit('conflict', c);
  }
}