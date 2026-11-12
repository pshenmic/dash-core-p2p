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
export declare const GovernanceObjectType: {
    readonly UNKNOWN: 0;
    readonly PROPOSAL: 1;
    readonly TRIGGER: 2;
};
export declare const VoteOutcome: {
    readonly NONE: 0;
    readonly YES: 1;
    readonly NO: 2;
    readonly ABSTAIN: 3;
};
export declare const VoteSignal: {
    readonly NONE: 0;
    readonly FUNDING: 1;
    readonly VALID: 2;
    readonly DELETE: 3;
    readonly ENDORSED: 4;
};
export interface GovernanceOutpoint {
    txid: string;
    vout: number;
}
export interface GovernanceObjectArgs {
    hashParent?: string;
    revision?: number;
    time?: number;
    collateralHash?: string;
    data?: Uint8Array;
    type?: number;
    masternodeOutpoint?: GovernanceOutpoint;
    signature?: Uint8Array;
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
export declare class GovernanceObject {
    hashParent: string;
    revision: number;
    time: number;
    collateralHash: string;
    data: Uint8Array;
    type: number;
    masternodeOutpoint: GovernanceOutpoint;
    signature: Uint8Array;
    constructor(args?: GovernanceObjectArgs);
    static fromBytes(bytes: Uint8Array): GovernanceObject;
    toBytes(): Uint8Array;
    /**
     * Object hash, as announced in inv (MSG_GOVERNANCE_OBJECT) and shown by
     * `gobject list`. Like Core, this does not hash the wire serialization:
     * vchData is hashed as its hex string, the outpoint as a legacy CTxIn,
     * and the collateral hash and type are left out.
     */
    hash(): string;
    /** vchData decoded as UTF-8. */
    dataString(): string;
    /** vchData parsed as JSON; throws if it is not valid JSON. */
    dataJSON(): unknown;
}
export interface GovernanceVoteArgs {
    masternodeOutpoint?: GovernanceOutpoint;
    parentHash?: string;
    outcome?: number;
    signal?: number;
    time?: number;
    signature?: Uint8Array;
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
export declare class GovernanceVote {
    masternodeOutpoint: GovernanceOutpoint;
    parentHash: string;
    outcome: number;
    signal: number;
    time: number;
    signature: Uint8Array;
    constructor(args?: GovernanceVoteArgs);
    static fromBytes(bytes: Uint8Array): GovernanceVote;
    toBytes(): Uint8Array;
    /**
     * Vote hash, as announced in inv (MSG_GOVERNANCE_OBJECT_VOTE). Like Core,
     * this is not the wire serialization: the outpoint is hashed as a legacy
     * CTxIn, signal comes before outcome, and the signature is left out.
     */
    hash(): string;
}
