import EventEmitter from 'eventemitter3';
import { Pool } from './Pool.js';
import { Peer } from './Peer.js';
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
export declare class ChainLockTracker extends EventEmitter {
    readonly pool: Pool;
    readonly minPeerConfirmations: number;
    readonly maxConflictHistory: number;
    /** The current best ChainLock, or null if none observed yet. */
    best: ChainLockInfo | null;
    /**
     * Locks pending corroboration: keyed by `${height}:${displayHash}`.
     * Once `reportedBy.size >= minPeerConfirmations` the entry promotes.
     */
    pending: Map<string, ChainLockInfo>;
    /** Recent conflict events, capped at `maxConflictHistory`. */
    conflicts: ChainLockConflict[];
    private _closed;
    private _detachers;
    constructor(pool: Pool, options?: ChainLockTrackerOptions);
    /** True once `close()` has been called. */
    get closed(): boolean;
    /**
     * True iff some block at `height` is chain-locked. Caller must still
     * verify their block hash is an ancestor of `best.blockHash` to claim
     * finality for a specific block (see class doc).
     */
    isHeightCovered(height: number): boolean;
    /**
     * True iff `blockHash` at `height` matches the current locked tip
     * exactly. This is the only ancestry claim the tracker can prove on
     * its own — for ancestors below the tip, the caller's chain logic must
     * confirm `blockHash` is on the ancestor path of `best.blockHash`.
     */
    isExactLockedTip(blockHash: string, height: number): boolean;
    /** Detach all pool listeners. Idempotent. */
    close(): void;
    private _attach;
    private _bind;
    private _ingest;
    private _recordConflict;
}
