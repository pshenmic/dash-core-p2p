import { Message, MessageOptions } from '../Message.js';
/**
 * Response to a ping message.
 */
export declare class PongMessage extends Message {
    nonce: Uint8Array;
    constructor(arg: Uint8Array | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
