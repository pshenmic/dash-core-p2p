import { Message, MessageOptions } from '../Message.js';
import { BloomFilter } from '../../BloomFilter.js';
/**
 * Request peer to send inv messages based on a bloom filter.
 */
export declare class FilterLoadMessage extends Message {
    filter: BloomFilter | undefined;
    constructor(arg: {
        filter?: BloomFilter;
    } | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
