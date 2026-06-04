import { Transaction } from 'dash-core-sdk';
export interface SimplifiedMNListEntry {
    proRegTxHash: string;
    confirmedHash: string;
    service: Uint8Array;
    pubKeyOperator: string;
    keyIDVoting: string;
    isValid: boolean;
}
export interface DeletedQuorum {
    llmqType: number;
    quorumHash: string;
}
/**
 * Represents the payload of a mnlistdiff message.
 * Encodes the diff of a simplified masternode list between two blocks.
 */
export declare class MnListDiff {
    baseBlockHash: string;
    blockHash: string;
    totalTransactions: number;
    merkleHashes: string[];
    merkleFlags: number[];
    cbTx: Transaction;
    deletedMNs: string[];
    mnList: SimplifiedMNListEntry[];
    deletedQuorums: DeletedQuorum[];
    newQuorums: Uint8Array[];
    static fromBytes(payload: Uint8Array): MnListDiff;
    toBytes(): Uint8Array;
}
