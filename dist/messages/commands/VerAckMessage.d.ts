import { Message, MessageOptions } from '../Message.js';
/**
 * Version acknowledgment - sent in response to a version message.
 */
export declare class VerAckMessage extends Message {
    constructor(_arg: undefined, options: MessageOptions);
    getPayload(): Uint8Array;
}
