import { Message, MessageOptions } from '../Message.js';
export interface GetMnListDiffArgs {
    baseBlockHash?: string;
    blockHash?: string;
}
/**
 * Request a masternode list difference from a peer.
 */
export declare class GetMnListDiffMessage extends Message {
    baseBlockHash: string | undefined;
    blockHash: string | undefined;
    constructor(args: GetMnListDiffArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
