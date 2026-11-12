import { utils as sdkUtils } from 'dash-core-sdk';
import { BufferReader } from './encoding/BufferReader.js';
import { BufferWriter } from './encoding/BufferWriter.js';
import { bytesToHex, hexToBytes, reverseBytes } from './utils/binary.js';
const { doubleSHA256 } = sdkUtils;
/**
 * Governance object and vote types, serialized as in Dash Core
 * (src/governance/common.h, src/governance/vote.h).
 *
 * Hashes are hex strings in display order, as in RPC (`gobject list`,
 * `gobject getcurrentvotes`) and the rest of this library.
 *
 * NOTE: these live here until dash-core-sdk ships its own governance types;
 * the shapes are meant to be swappable for them.
 */
export const GovernanceObjectType = {
    UNKNOWN: 0,
    PROPOSAL: 1,
    TRIGGER: 2,
};
export const VoteOutcome = {
    NONE: 0,
    YES: 1,
    NO: 2,
    ABSTAIN: 3,
};
export const VoteSignal = {
    NONE: 0,
    FUNDING: 1,
    VALID: 2,
    DELETE: 3,
    ENDORSED: 4,
};
const ZERO_HASH = '0'.repeat(64);
class GovReader extends BufferReader {
    length;
    constructor(buf) {
        super(buf);
        this.length = buf.length;
    }
    need(n) {
        if (this.pos + n > this.length) {
            throw new Error(`governance: unexpected end of data (need ${n} bytes at offset ${this.pos}, have ${this.length - this.pos})`);
        }
    }
    // Checked primitives, so readVarintNum cannot run past the end either.
    read(len) { this.need(len); return super.read(len); }
    readUInt8() { this.need(1); return super.readUInt8(); }
    readUInt16LE() { this.need(2); return super.readUInt16LE(); }
    readUInt32LE() { this.need(4); return super.readUInt32LE(); }
    readInt32LE() { this.need(4); return super.readInt32LE(); }
    readUInt64LE() { this.need(8); return super.readUInt64LE(); }
    hashDisplay() { return bytesToHex(reverseBytes(this.read(32))); }
    int32() { return this.readInt32LE(); }
    uint32() { return this.readUInt32LE(); }
    int64() {
        const n = BigInt.asIntN(64, this.readUInt64LE());
        if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) {
            throw new Error('governance: int64 out of safe integer range');
        }
        return Number(n);
    }
    bytes() {
        return this.read(this.readVarintNum()).slice();
    }
    outpoint() {
        return { txid: this.hashDisplay(), vout: this.uint32() };
    }
    done() {
        if (this.pos !== this.length) {
            throw new Error(`governance: ${this.length - this.pos} unexpected trailing bytes`);
        }
    }
}
function writeHash(bw, hash) {
    bw.write(reverseBytes(hexToBytes(hash)));
}
function writeInt64(bw, n) {
    bw.writeUInt64LE(BigInt.asUintN(64, BigInt(n)));
}
function writeBytes(bw, data) {
    bw.writeVarintNum(data.length);
    bw.write(data);
}
function writeOutpoint(bw, o) {
    writeHash(bw, o.txid);
    bw.writeUInt32LE(o.vout);
}
/**
 * Core hashes the outpoint as the CTxIn it used to be: outpoint, empty
 * scriptSig, sequence 0xffffffff.
 */
function writeLegacyTxIn(bw, o) {
    writeOutpoint(bw, o);
    bw.writeUInt8(0);
    bw.writeUInt32LE(0xffffffff);
}
function hashDisplay(bytes) {
    return bytesToHex(reverseBytes(doubleSHA256(bytes)));
}
/**
 * A governance object (proposal or trigger), payload of `govobj`.
 *
 * Wire format:
 *   hashParent         uint256
 *   revision           int32
 *   time               int64
 *   collateralHash     uint256
 *   vchData            bytes   (UTF-8 JSON for proposals/triggers)
 *   type               int32   (GovernanceObjectType)
 *   masternodeOutpoint COutPoint (null for proposals)
 *   vchSig             bytes
 */
export class GovernanceObject {
    hashParent;
    revision;
    time;
    collateralHash;
    data;
    type;
    masternodeOutpoint;
    signature;
    constructor(args = {}) {
        this.hashParent = args.hashParent ?? ZERO_HASH;
        this.revision = args.revision ?? 1;
        this.time = args.time ?? 0;
        this.collateralHash = args.collateralHash ?? ZERO_HASH;
        this.data = args.data ?? new Uint8Array(0);
        this.type = args.type ?? GovernanceObjectType.UNKNOWN;
        this.masternodeOutpoint = args.masternodeOutpoint ?? { txid: ZERO_HASH, vout: 0xffffffff };
        this.signature = args.signature ?? new Uint8Array(0);
    }
    static fromBytes(bytes) {
        const r = new GovReader(bytes);
        const obj = new GovernanceObject({
            hashParent: r.hashDisplay(),
            revision: r.int32(),
            time: r.int64(),
            collateralHash: r.hashDisplay(),
            data: r.bytes(),
            type: r.int32(),
            masternodeOutpoint: r.outpoint(),
            signature: r.bytes(),
        });
        r.done();
        return obj;
    }
    toBytes() {
        const bw = new BufferWriter();
        writeHash(bw, this.hashParent);
        bw.writeInt32LE(this.revision);
        writeInt64(bw, this.time);
        writeHash(bw, this.collateralHash);
        writeBytes(bw, this.data);
        bw.writeInt32LE(this.type);
        writeOutpoint(bw, this.masternodeOutpoint);
        writeBytes(bw, this.signature);
        return bw.concat();
    }
    /**
     * Object hash, as announced in inv (MSG_GOVERNANCE_OBJECT) and shown by
     * `gobject list`. Like Core, this does not hash the wire serialization:
     * vchData is hashed as its hex string, the outpoint as a legacy CTxIn,
     * and the collateral hash and type are left out.
     */
    hash() {
        const bw = new BufferWriter();
        writeHash(bw, this.hashParent);
        bw.writeInt32LE(this.revision);
        writeInt64(bw, this.time);
        writeBytes(bw, new TextEncoder().encode(bytesToHex(this.data)));
        writeLegacyTxIn(bw, this.masternodeOutpoint);
        writeBytes(bw, this.signature);
        return hashDisplay(bw.concat());
    }
    /** vchData decoded as UTF-8. */
    dataString() {
        return new TextDecoder().decode(this.data);
    }
    /** vchData parsed as JSON; throws if it is not valid JSON. */
    dataJSON() {
        return JSON.parse(this.dataString());
    }
}
/**
 * A governance vote, payload of `govobjvote`.
 *
 * Wire format:
 *   masternodeOutpoint COutPoint
 *   nParentHash        uint256  (the governance object voted on)
 *   nVoteOutcome       int32    (VoteOutcome)
 *   nVoteSignal        int32    (VoteSignal)
 *   nTime              int64
 *   vchSig             bytes
 */
export class GovernanceVote {
    masternodeOutpoint;
    parentHash;
    outcome;
    signal;
    time;
    signature;
    constructor(args = {}) {
        this.masternodeOutpoint = args.masternodeOutpoint ?? { txid: ZERO_HASH, vout: 0xffffffff };
        this.parentHash = args.parentHash ?? ZERO_HASH;
        this.outcome = args.outcome ?? VoteOutcome.NONE;
        this.signal = args.signal ?? VoteSignal.NONE;
        this.time = args.time ?? 0;
        this.signature = args.signature ?? new Uint8Array(0);
    }
    static fromBytes(bytes) {
        const r = new GovReader(bytes);
        const vote = new GovernanceVote({
            masternodeOutpoint: r.outpoint(),
            parentHash: r.hashDisplay(),
            outcome: r.int32(),
            signal: r.int32(),
            time: r.int64(),
            signature: r.bytes(),
        });
        r.done();
        return vote;
    }
    toBytes() {
        const bw = new BufferWriter();
        writeOutpoint(bw, this.masternodeOutpoint);
        writeHash(bw, this.parentHash);
        bw.writeInt32LE(this.outcome);
        bw.writeInt32LE(this.signal);
        writeInt64(bw, this.time);
        writeBytes(bw, this.signature);
        return bw.concat();
    }
    /**
     * Vote hash, as announced in inv (MSG_GOVERNANCE_OBJECT_VOTE). Like Core,
     * this is not the wire serialization: the outpoint is hashed as a legacy
     * CTxIn, signal comes before outcome, and the signature is left out.
     */
    hash() {
        const bw = new BufferWriter();
        writeLegacyTxIn(bw, this.masternodeOutpoint);
        writeHash(bw, this.parentHash);
        bw.writeInt32LE(this.signal);
        bw.writeInt32LE(this.outcome);
        writeInt64(bw, this.time);
        return hashDisplay(bw.concat());
    }
}
//# sourceMappingURL=Governance.js.map