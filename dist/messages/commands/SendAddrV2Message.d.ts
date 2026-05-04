import { Message, MessageOptions } from '../Message.js';
/**
 * Signals support for the addrv2 message format (BIP155).
 * Sent after version and before verack. No payload.
 */
export declare class SendAddrV2Message extends Message {
    constructor(_arg: undefined, options: MessageOptions);
    getPayload(): Uint8Array;
}
