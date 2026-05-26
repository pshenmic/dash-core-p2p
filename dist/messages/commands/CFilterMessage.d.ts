import { Message, MessageOptions } from '../Message.js';
export interface CFilterArgs {
    filterType?: number;
    blockHash?: Uint8Array;
    filter?: Uint8Array;
}
/**
 * BIP 157 `cfilter`: a single compact filter for one block.
 * `blockHash` is in wire byte order. `filter` is the raw GCS payload.
 */
export declare class CFilterMessage extends Message {
    filterType: number;
    blockHash: Uint8Array;
    filter: Uint8Array;
    constructor(arg: CFilterArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
