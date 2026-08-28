import EventEmitter from 'eventemitter3';
import { Transaction } from 'dash-core-sdk';
import { Pool } from './Pool.js';
import { Peer } from './Peer.js';
/**
 * Maximum standard transaction size accepted by Dash/Bitcoin Core nodes for
 * mempool relay. Transactions larger than this will be ignored or get the
 * sender banned, so reject them before they go on the wire.
 */
export declare const MAX_STANDARD_TX_SIZE = 100000;
export interface RejectInfo {
    peer: Peer;
    ccode: number;
    reason: string;
}
export interface BroadcastOptions {
    /** Skip pre-flight validation. Default false (validation runs). */
    skipValidation?: boolean;
    /** Override the per-tx size cap. Default {@link MAX_STANDARD_TX_SIZE}. */
    maxTxSize?: number;
}
/**
 * Pre-flight validation for a transaction about to hit the P2P network.
 *
 * The checks here cover the mistakes a relay node will ban or drop us for:
 * missing inputs/outputs, oversized payload, unserializable extras, and an
 * unstable txid. We deliberately do NOT validate signatures or fees — that
 * is the wallet's job, not ours.
 */
export declare function validateTransactionForBroadcast(tx: Transaction, opts?: {
    maxTxSize?: number;
}): void;
/**
 * Protocol-level session that pushes one transaction onto the Dash P2P
 * network and surfaces the network's response.
 *
 * This class is **mechanism only**. It does NOT make policy decisions about
 * what "success" means, how long to wait, or when to retry. Callers compose
 * those on top using the events:
 *
 *   - `request`    (peer)           peer sent `getdata(MSG_TX, txid)`
 *   - `sent`       (peer)           we wrote the `tx` message to a peer
 *   - `propagated` (peer)           peer announced our tx back via `inv`
 *                                   (relay confirmation; only fires when WE
 *                                   sent the version handshake with fRelay=1
 *                                   so peers will push mempool inv to us)
 *   - `isdlock`    (msg)            DIP-24 deterministic InstantSend lock for
 *                                   our tx arrived. This is the modern IS
 *                                   confirmation signal on current Dash Core
 *                                   (master/develop emit `isdlock` only).
 *                                   Also sets `instantLocked`.
 *   - `islock`     (msg)            DIP-10 legacy InstantSend lock arrived.
 *                                   NOTE: removed from current Dash Core
 *                                   (master/develop have no NetMsgType::ISLOCK
 *                                   and CInstantSendLock is serialized as
 *                                   `isdlock` only). This event is kept for
 *                                   compatibility with older peers but will
 *                                   not fire from up-to-date mainnet nodes.
 *                                   Prefer `isdlock` for modern networks.
 *   - `reject`     (info)           peer sent `reject` for our tx (BIP 61).
 *                                   NOTE: BIP 61 was removed from Dash Core
 *                                   (no NetMsgType::REJECT in current source).
 *                                   This event will not fire from up-to-date
 *                                   peers; treat its absence as "no signal",
 *                                   not "no rejection".
 *   - `error`      (err, peer?)     swallowed wire-write failure
 *
 * Byte-order note: txids on the wire (inv/getdata/notfound/reject/islock)
 * are in internal/wire order — the byte-reverse of the RPC/display hex that
 * `Transaction.hash()` returns. This class handles the conversion once at
 * construction; consumers always work in display-order hex via `.txid`.
 *
 * Idempotency: `announce()` skips peers already invited. `push()` skips
 * peers already served. Both check `peer.status === READY`.
 */
export declare class TxBroadcast extends EventEmitter {
    readonly pool: Pool;
    readonly tx: Transaction;
    /** Display-order (RPC) hex of the txid, matching `tx.hash()`. */
    readonly txid: string;
    /** 32-byte internal/wire-order txid used on the wire. */
    readonly txidWire: Uint8Array;
    /** Peers we have already sent `inv` to. */
    readonly invSentTo: Set<Peer>;
    /** Peers we have already sent the `tx` message to. */
    readonly txSentTo: Set<Peer>;
    /** Peers that issued `getdata` for our txid. */
    readonly requestedBy: Set<Peer>;
    /**
     * Peers that announced our txid back to us via `inv`. Only populated when
     * the pool was started with `relay: true` — otherwise peers will not push
     * mempool inv to us.
     */
    readonly propagatedFrom: Set<Peer>;
    /** True once a matching `isdlock` (or legacy `islock`) has been received. */
    instantLocked: boolean;
    /** Every `reject` message we observed for this tx (one per peer). */
    readonly rejections: RejectInfo[];
    private _closed;
    private _detachers;
    private readonly _txidWireHex;
    /**
     * Message factory used to build inv/tx messages. Falls back to a fresh
     * Messages bound to the pool's network when the pool was constructed
     * without one (Pool only auto-creates Messages inside its Peers, not on
     * itself).
     */
    private readonly _messages;
    constructor(pool: Pool, tx: Transaction, options?: BroadcastOptions);
    /** True once `close()` has been called. */
    get closed(): boolean;
    /** Ready peers currently in the pool. */
    readyPeers(): Peer[];
    /**
     * Send `inv(MSG_TX, txid)` to a peer. If `peer` is omitted, send to every
     * ready peer that has not yet been invited. Safe to call repeatedly.
     *
     * Returns the peers actually contacted on this call.
     */
    announce(peer?: Peer): Peer[];
    /**
     * Send the full `tx` message to a peer, unsolicited. Use as a fallback
     * when a peer has not requested via `getdata` after some interval.
     * Idempotent per peer.
     */
    push(peer: Peer): boolean;
    /** Detach all pool listeners. Idempotent. */
    close(): void;
    private _assertOpen;
    private _buildInv;
    private _matchesTxid;
    private _attach;
    private _bind;
}
