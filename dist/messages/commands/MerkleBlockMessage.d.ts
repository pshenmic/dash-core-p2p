import { MerkleBlock } from "dash-core-sdk";
import { Message, MessageOptions } from '../Message.js';
/**
 * Contains information about a filtered block (Merkle block).
 */
export declare class MerkleBlockMessage extends Message {
    merkleBlock: MerkleBlock;
    constructor(arg: MerkleBlock, options: MessageOptions & MerkleBlock);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
