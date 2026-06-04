import { Message, MessageOptions } from '../Message.js';
/**
 * DarkSend queue message.
 */
export declare class DSQueueMessage extends Message {
    nonce: Uint8Array | undefined;
    constructor(_arg: undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
