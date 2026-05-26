import { Message, MessageOptions } from '../Message.js';
export interface CFHeadersArgs {
    filterType?: number;
    stopHash?: Uint8Array;
    previousFilterHeader?: Uint8Array;
    filterHashes?: Uint8Array[];
}
/**
 * BIP 157 `cfheaders`: a contiguous list of filter hashes plus the
 * filter-header value of the block immediately before the range. Caller
 * derives the chain by repeated `dSHA256(filter_hash || prev_header)`.
 */
export declare class CFHeadersMessage extends Message {
    filterType: number;
    stopHash: Uint8Array;
    previousFilterHeader: Uint8Array;
    filterHashes: Uint8Array[];
    constructor(arg: CFHeadersArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
