import { Message, MessageOptions } from '../Message.js';
/**
 * Clear the bloom filter on a peer.
 */
export declare class FilterClearMessage extends Message {
    constructor(_arg: undefined, options: MessageOptions);
    getPayload(): Uint8Array;
}
