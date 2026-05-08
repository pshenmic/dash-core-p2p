import { Message, MessageOptions } from '../Message.js';
/**
 * Requests the peer to announce new blocks via headers messages instead of inv (BIP130).
 * No payload. Send once after the handshake is complete.
 */
export declare class SendHeadersMessage extends Message {
    constructor(_arg: undefined, options: MessageOptions);
    getPayload(): Uint8Array;
}
