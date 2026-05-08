import { Message, MessageOptions } from '../Message.js';
/**
 * Add data to an existing bloom filter on a peer.
 */
export declare class FilterAddMessage extends Message {
    data: Uint8Array | undefined;
    constructor(arg: Uint8Array | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
