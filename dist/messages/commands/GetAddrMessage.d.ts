import { Message, MessageOptions } from '../Message.js';
/**
 * Request a list of known peers from the connected peer.
 */
export declare class GetAddrMessage extends Message {
    constructor(_arg: undefined, options: MessageOptions);
    getPayload(): Uint8Array;
}
