import { Message, MessageOptions } from '../Message.js';
/**
 * Response to a getheaders message, containing block headers.
 * Each header is stored as a raw 80-byte Uint8Array.
 */
export declare class HeadersMessage extends Message {
    headers: Uint8Array[] | undefined;
    constructor(arg: Uint8Array[] | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
