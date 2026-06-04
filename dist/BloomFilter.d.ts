export declare class BloomFilter {
    static readonly BLOOM_UPDATE_NONE = 0;
    static readonly BLOOM_UPDATE_ALL = 1;
    static readonly BLOOM_UPDATE_P2PUBKEY_ONLY = 2;
    nHashFuncs: number;
    nTweak: number;
    nFlags: number;
    vData: number[];
    private inner;
    constructor(nHashFuncs: number, nTweak: number, nFlags: number, vData: number[]);
    static create(n: number, fpRate: number, nTweak?: number, nFlags?: number): BloomFilter;
    insert(data: Uint8Array): void;
    contains(data: Uint8Array): boolean;
    static fromBytes(payload: Uint8Array): BloomFilter;
    toBytes(): Uint8Array;
}
