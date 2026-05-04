import { Message, MessageOptions } from '../Message.js';
/**
 * Request the peer to send its mempool contents.
 */
export declare class MemPoolMessage extends Message {
    constructor(_arg: undefined, options: MessageOptions);
    getPayload(): Uint8Array;
}
