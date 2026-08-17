import { Message, MessageOptions } from '../Message.js';
export interface GetCFiltersArgs {
    filterType?: number;
    startHeight?: number;
    stopHash?: Uint8Array;
}
/**
 * BIP 157 `getcfilters`: request a contiguous range of compact filters.
 * `stopHash` is in wire (internal) byte order.
 */
export declare class GetCFiltersMessage extends Message {
    filterType: number;
    startHeight: number;
    stopHash: Uint8Array;
    constructor(arg: GetCFiltersArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
