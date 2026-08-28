import EventEmitter from 'eventemitter3';
import { hexToBytes, bytesToHex, reverseBytes } from './utils/binary.js';
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
    pool;
    minPeerConfirmations;
    maxConflictHistory;
    /** The current best ChainLock, or null if none observed yet. */
    best = null;
    /**
     * Locks pending corroboration: keyed by `${height}:${displayHash}`.
     * Once `reportedBy.size >= minPeerConfirmations` the entry promotes.
     */
    pending = new Map();
    /** Recent conflict events, capped at `maxConflictHistory`. */
    conflicts = [];
    _closed = false;
    _detachers = [];
    constructor(pool, options) {
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
    get closed() {
        return this._closed;
    }
    /**
     * True iff some block at `height` is chain-locked. Caller must still
     * verify their block hash is an ancestor of `best.blockHash` to claim
     * finality for a specific block (see class doc).
     */
    isHeightCovered(height) {
        return this.best != null && height <= this.best.height;
    }
    /**
     * True iff `blockHash` at `height` matches the current locked tip
     * exactly. This is the only ancestry claim the tracker can prove on
     * its own — for ancestors below the tip, the caller's chain logic must
     * confirm `blockHash` is on the ancestor path of `best.blockHash`.
     */
    isExactLockedTip(blockHash, height) {
        if (this.best == null)
            return false;
        return this.best.height === height && this.best.blockHash === blockHash.toLowerCase();
    }
    /** Detach all pool listeners. Idempotent. */
    close() {
        if (this._closed)
            return;
        this._closed = true;
        for (const off of this._detachers) {
            try {
                off();
            }
            catch { /* swallow */ }
        }
        this._detachers.length = 0;
    }
    _attach() {
        const onClsig = (peer, msg) => {
            this._ingest(peer, msg);
        };
        this._bind('peerclsig', onClsig);
    }
    _bind(event, handler) {
        this.pool.on(event, handler);
        this._detachers.push(() => this.pool.off(event, handler));
    }
    _ingest(peer, msg) {
        if (this._closed)
            return;
        const height = msg.height;
        const wireHashHex = msg.blockHash;
        const sig = msg.sig;
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
                reportedBy: new Set(),
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
                if (info.height <= entry.height)
                    this.pending.delete(k);
            }
            this.emit('update', entry, prev);
        }
    }
    _recordConflict(c) {
        this.conflicts.push(c);
        if (this.conflicts.length > this.maxConflictHistory) {
            this.conflicts.splice(0, this.conflicts.length - this.maxConflictHistory);
        }
        this.emit('conflict', c);
    }
}
//# sourceMappingURL=ChainLockTracker.js.map