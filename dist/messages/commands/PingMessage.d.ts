import { Message, MessageOptions } from '../Message.js';
/**
 * A message to confirm that a connection is still valid.
 */
export declare class PingMessage extends Message {
    nonce: Uint8Array;
    constructor(arg: Uint8Array | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
