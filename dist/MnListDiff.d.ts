import { Transaction } from 'dash-core-sdk';
/**
 * Lowest protocol version whose mnlistdiff layout this module implements:
 * versioned SML entries (70228), leading diff nVersion (70229) and
 * quorumsCLSigs (70230). See Dash Core src/evo/smldiff.h, src/evo/simplifiedmns.h.
 */
export declare const MNLISTDIFF_MIN_PROTOCOL_VERSION = 70230;
export declare const ProTxVersion: {
    readonly LegacyBLS: 1;
    readonly BasicBLS: 2;
    readonly ExtAddr: 3;
};
export declare const MnType: {
    readonly Regular: 0;
    readonly Evo: 1;
};
export declare const NetInfoPurpose: {
    readonly CORE_P2P: 0;
    readonly PLATFORM_P2P: 1;
    readonly PLATFORM_HTTPS: 2;
};
export declare const NetInfoType: {
    readonly Service: 1;
    readonly Domain: 2;
    readonly Invalid: 255;
};
/**
 * A network service address.
 * `host` is a printable IPv4/IPv6 address, or null for network types
 * that aren't decoded here (Tor, I2P, ...); `addr` always has the raw bytes.
 */
export interface NetAddress {
    networkId: number;
    addr: Uint8Array;
    host: string | null;
    port: number;
}
export type NetInfoEntry = {
    type: typeof NetInfoType.Service;
    service: NetAddress;
} | {
    type: typeof NetInfoType.Domain;
    domain: string;
    port: number;
} | {
    type: typeof NetInfoType.Invalid;
};
/** Extended network info (ProTx nVersion >= 3), entries grouped by NetInfoPurpose. */
export interface ExtNetInfo {
    version: number;
    entries: Partial<Record<number, NetInfoEntry[]>>;
}
export interface SimplifiedMNListEntry {
    nVersion: number;
    proRegTxHash: string;
    confirmedHash: string;
    /** Raw legacy CService, 16-byte IPv6 (v4-mapped) address + 2-byte big-endian port. Only for nVersion < 3. */
    service?: Uint8Array;
    /** Extended network info. Only for nVersion >= 3. */
    netInfo?: ExtNetInfo;
    /**
     * Core P2P address: the legacy `service` for nVersion < 3, otherwise the
     * first CORE_P2P Service entry of `netInfo`. Null if there is none.
     */
    address: NetAddress | null;
    pubKeyOperator: string;
    keyIDVoting: string;
    isValid: boolean;
    nType: number;
    /**
     * Evo nodes only. Read from the entry for nVersion < 3; for nVersion >= 3
     * it is the port of the first PLATFORM_HTTPS entry of `netInfo` (not serialized).
     */
    platformHTTPPort?: number;
    platformNodeID?: string;
}
export interface DeletedQuorum {
    llmqType: number;
    quorumHash: string;
}
/** CFinalCommitment, see Dash Core src/llmq/commitment.h. */
export interface FinalCommitment {
    nVersion: number;
    llmqType: number;
    quorumHash: string;
    quorumIndex?: number;
    signers: boolean[];
    validMembers: boolean[];
    quorumPublicKey: string;
    quorumVvecHash: string;
    quorumSig: string;
    membersSig: string;
}
export interface QuorumCLSig {
    signature: string;
    indexSet: number[];
}
/**
 * Represents the payload of a mnlistdiff message.
 * Encodes the diff of a simplified masternode list between two blocks.
 *
 * Hashes are hex strings in display order (as shown by RPC and explorers).
 */
export declare class MnListDiff {
    nVersion: number;
    baseBlockHash: string;
    blockHash: string;
    totalTransactions: number;
    merkleHashes: string[];
    merkleFlags: number[];
    cbTx: Transaction;
    deletedMNs: string[];
    mnList: SimplifiedMNListEntry[];
    deletedQuorums: DeletedQuorum[];
    newQuorums: FinalCommitment[];
    quorumsCLSigs: QuorumCLSig[];
    /** Exact cbTx bytes as received; used by toBytes() so round-tripping is lossless. */
    cbTxBytes: Uint8Array | undefined;
    static fromBytes(payload: Uint8Array, protocolVersion?: number): MnListDiff;
    toBytes(): Uint8Array;
    /** merkleRootMNList committed in the coinbase (display order), if present. */
    get merkleRootMNList(): string | undefined;
    /** merkleRootQuorums committed in the coinbase (display order); absent before CbTx version 2. */
    get merkleRootQuorums(): string | undefined;
    /** Block height committed in the coinbase, if present. */
    get coinbaseHeight(): number | undefined;
    /**
     * Merkle root of the block containing `cbTx`, rebuilt from the partial
     * merkle tree (merkleHashes / merkleFlags / totalTransactions), in display
     * order. Compare with the block header's merkle root.
     *
     * Returns null if the tree is malformed, mutated (CVE-2012-2459), or does
     * not prove exactly one match: the coinbase, at position 0.
     * Port of Core's CPartialMerkleTree::ExtractMatches.
     */
    calcBlockMerkleRoot(): string | null;
    /**
     * Hash of a single entry as used in merkleRootMNList: sha256d of the entry
     * serialized without its leading nVersion (Core's SER_GETHASH). Wire order.
     */
    static calcEntryHash(entry: SimplifiedMNListEntry): Uint8Array;
    /**
     * Merkle root over a full masternode list, in display order. Entries are
     * sorted by proRegTxHash (memcmp of wire bytes) as Core does. Compare with
     * `merkleRootMNList` on a diff from the zero base hash (a full list), or on
     * a list obtained by applying diffs.
     */
    static calcMerkleRootMNList(entries: SimplifiedMNListEntry[]): string;
    /**
     * Hash of a commitment as used in merkleRootQuorums: sha256d of the
     * commitment as serialized on the wire. Wire order.
     */
    static calcCommitmentHash(commitment: FinalCommitment): Uint8Array;
    /**
     * Merkle root over all active quorum commitments, in display order.
     * Commitment hashes are sorted by their wire bytes, as Core does. Compare
     * with `merkleRootQuorums` on a diff from the zero base hash (whose
     * newQuorums are all active quorums), or on a quorum list built from diffs.
     */
    static calcMerkleRootQuorums(commitments: FinalCommitment[]): string;
}
