import EventEmitter from 'eventemitter3';
import { Transaction } from 'dash-core-sdk';
import { PeerStatus } from './Peer.js';
import { InventoryType } from './Inventory.js';
import { Messages } from './messages/Messages.js';
import { hexToBytes, bytesToHex, reverseBytes, bytesEqual } from './utils/binary.js';
/**
 * Maximum standard transaction size accepted by Dash/Bitcoin Core nodes for
 * mempool relay. Transactions larger than this will be ignored or get the
 * sender banned, so reject them before they go on the wire.
 */
export const MAX_STANDARD_TX_SIZE = 100_000;
/**
 * Pre-flight validation for a transaction about to hit the P2P network.
 *
 * The checks here cover the mistakes a relay node will ban or drop us for:
 * missing inputs/outputs, oversized payload, unserializable extras, and an
 * unstable txid. We deliberately do NOT validate signatures or fees — that
 * is the wallet's job, not ours.
 */
export function validateTransactionForBroadcast(tx, opts) {
    if (!(tx instanceof Transaction)) {
        throw new TypeError('broadcast: expected a dash-core-sdk Transaction');
    }
    if (!Array.isArray(tx.inputs) || tx.inputs.length === 0) {
        throw new Error('broadcast: transaction has no inputs');
    }
    if (!Array.isArray(tx.outputs) || tx.outputs.length === 0) {
        throw new Error('broadcast: transaction has no outputs');
    }
    let bytes;
    try {
        bytes = tx.bytes();
    }
    catch (e) {
        throw new Error('broadcast: failed to serialize transaction: ' + e.message);
    }
    if (bytes.length === 0) {
        throw new Error('broadcast: serialized transaction is empty');
    }
    const max = opts?.maxTxSize ?? MAX_STANDARD_TX_SIZE;
    if (bytes.length > max) {
        throw new Error(`broadcast: transaction is ${bytes.length} bytes, over the ${max}-byte standard relay limit`);
    }
    let txid;
    try {
        txid = tx.hash();
    }
    catch (e) {
        throw new Error('broadcast: failed to compute txid: ' + e.message);
    }
    if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/.test(txid)) {
        throw new Error('broadcast: tx.hash() did not return a 32-byte hex string');
    }
}
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
export class TxBroadcast extends EventEmitter {
    pool;
    tx;
    /** Display-order (RPC) hex of the txid, matching `tx.hash()`. */
    txid;
    /** 32-byte internal/wire-order txid used on the wire. */
    txidWire;
    /** Peers we have already sent `inv` to. */
    invSentTo = new Set();
    /** Peers we have already sent the `tx` message to. */
    txSentTo = new Set();
    /** Peers that issued `getdata` for our txid. */
    requestedBy = new Set();
    /**
     * Peers that announced our txid back to us via `inv`. Only populated when
     * the pool was started with `relay: true` — otherwise peers will not push
     * mempool inv to us.
     */
    propagatedFrom = new Set();
    /** True once a matching `isdlock` (or legacy `islock`) has been received. */
    instantLocked = false;
    /** Every `reject` message we observed for this tx (one per peer). */
    rejections = [];
    _closed = false;
    _detachers = [];
    _txidWireHex;
    /**
     * Message factory used to build inv/tx messages. Falls back to a fresh
     * Messages bound to the pool's network when the pool was constructed
     * without one (Pool only auto-creates Messages inside its Peers, not on
     * itself).
     */
    _messages;
    constructor(pool, tx, options) {
        super();
        if (pool == null) {
            throw new TypeError('TxBroadcast: pool is required');
        }
        if (!options?.skipValidation) {
            validateTransactionForBroadcast(tx, options);
        }
        this.pool = pool;
        this.tx = tx;
        this.txid = tx.hash();
        this.txidWire = reverseBytes(hexToBytes(this.txid));
        this._txidWireHex = bytesToHex(this.txidWire);
        this._messages = pool.messages ?? new Messages({ network: pool.network ?? undefined });
        this._attach();
    }
    /** True once `close()` has been called. */
    get closed() {
        return this._closed;
    }
    /** Ready peers currently in the pool. */
    readyPeers() {
        const map = this.pool._connectedPeers ?? {};
        const out = [];
        for (const p of Object.values(map)) {
            if (p && p.status === PeerStatus.READY)
                out.push(p);
        }
        return out;
    }
    /**
     * Send `inv(MSG_TX, txid)` to a peer. If `peer` is omitted, send to every
     * ready peer that has not yet been invited. Safe to call repeatedly.
     *
     * Returns the peers actually contacted on this call.
     */
    announce(peer) {
        this._assertOpen();
        const targets = peer ? [peer] : this.readyPeers();
        const sent = [];
        for (const p of targets) {
            if (this.invSentTo.has(p))
                continue;
            if (p.status !== PeerStatus.READY)
                continue;
            try {
                const inv = this._buildInv();
                p.sendMessage(inv);
                this.invSentTo.add(p);
                sent.push(p);
            }
            catch (e) {
                this.emit('error', e, p);
            }
        }
        return sent;
    }
    /**
     * Send the full `tx` message to a peer, unsolicited. Use as a fallback
     * when a peer has not requested via `getdata` after some interval.
     * Idempotent per peer.
     */
    push(peer) {
        this._assertOpen();
        if (peer.status !== PeerStatus.READY)
            return false;
        if (this.txSentTo.has(peer))
            return false;
        try {
            const txMsg = this._messages
                .Transaction(this.tx);
            peer.sendMessage(txMsg);
            this.txSentTo.add(peer);
            this.emit('sent', peer);
            return true;
        }
        catch (e) {
            this.emit('error', e, peer);
            return false;
        }
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
    _assertOpen() {
        if (this._closed)
            throw new Error('TxBroadcast: session is closed');
    }
    _buildInv() {
        const factory = this._messages.Inventory;
        return factory([{ type: InventoryType.TX, hash: this.txidWire }]);
    }
    _matchesTxid(item) {
        if (!isTxInvType(item.type))
            return false;
        if (!(item.hash instanceof Uint8Array) || item.hash.length !== 32)
            return false;
        return bytesEqual(item.hash, this.txidWire);
    }
    _attach() {
        const onGetData = (peer, msg) => {
            const inv = msg.inventory ?? [];
            let matched = false;
            for (const item of inv) {
                if (this._matchesTxid(item)) {
                    matched = true;
                    break;
                }
            }
            if (!matched)
                return;
            // Serve the peer in response to its request, then record the ack.
            this.push(peer);
            if (!this.requestedBy.has(peer)) {
                this.requestedBy.add(peer);
                this.emit('request', peer);
            }
        };
        const onInv = (peer, msg) => {
            const inv = msg.inventory ?? [];
            for (const item of inv) {
                if (this._matchesTxid(item)) {
                    if (!this.propagatedFrom.has(peer)) {
                        this.propagatedFrom.add(peer);
                        this.emit('propagated', peer);
                    }
                    return;
                }
            }
        };
        const onIslock = (_peer, msg) => {
            // ISLockMessage.txid is hex of wire bytes (internal byte order), not
            // display order — compare against the wire-hex of our txid.
            const txidHex = msg.txid;
            if (!txidHex)
                return;
            if (txidHex.toLowerCase() !== this._txidWireHex)
                return;
            if (this.instantLocked)
                return;
            this.instantLocked = true;
            this.emit('islock', msg);
        };
        const onIsdlock = (_peer, msg) => {
            // ISDLockMessage.txid is hex of wire bytes (internal byte order), same
            // convention as the legacy islock — compare against our wire-hex txid.
            const txidHex = msg.txid;
            if (!txidHex)
                return;
            if (txidHex.toLowerCase() !== this._txidWireHex)
                return;
            if (this.instantLocked)
                return;
            this.instantLocked = true;
            this.emit('isdlock', msg);
        };
        const onReject = (peer, msg) => {
            // BIP 61: `reject` for a tx carries message="tx" and data=txid (wire order).
            if ((msg.message ?? '').toLowerCase() !== 'tx')
                return;
            if (!msg.data || msg.data.length < 32)
                return;
            const hash = msg.data.subarray(0, 32);
            if (!bytesEqual(hash, this.txidWire))
                return;
            const info = {
                peer,
                ccode: msg.ccode ?? 0,
                reason: msg.reason ?? '',
            };
            this.rejections.push(info);
            this.emit('reject', info);
        };
        this._bind('peergetdata', onGetData);
        this._bind('peerinv', onInv);
        this._bind('peerislock', onIslock);
        this._bind('peerisdlock', onIsdlock);
        this._bind('peerreject', onReject);
    }
    _bind(event, handler) {
        this.pool.on(event, handler);
        this._detachers.push(() => this.pool.off(event, handler));
    }
}
function isTxInvType(type) {
    // MSG_TX (1) and Dash DSTX (16, PrivateSend) both carry transactions. Match
    // either when reconciling inv/getdata against our broadcast.
    return type === InventoryType.TX || type === InventoryType.DSTX;
}
//# sourceMappingURL=Broadcast.js.map