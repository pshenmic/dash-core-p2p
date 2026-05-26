export declare const BASIC_FILTER_TYPE = 0;
export declare const GCS_P = 19;
export declare const GCS_M = 784931n;
export declare const NODE_COMPACT_FILTERS: number;
export declare function decodeGCS(filter: Uint8Array, P?: number): {
    N: number;
    values: bigint[];
};
export declare function deriveFilterKey(blockHashWire: Uint8Array): {
    k0: bigint;
    k1: bigint;
};
export declare function nextFilterHeader(filterBytes: Uint8Array, prevHeader: Uint8Array): Uint8Array;
export declare class CompactFilter {
    readonly N: number;
    readonly values: bigint[];
    readonly k0: bigint;
    readonly k1: bigint;
    readonly F: bigint;
    constructor(filter: Uint8Array, blockHashWire: Uint8Array, P?: number, M?: bigint);
    private hashItem;
    match(item: Uint8Array): boolean;
    matchAny(items: Uint8Array[]): boolean;
}
