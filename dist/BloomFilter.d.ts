export declare class BloomFilter {
    static readonly BLOOM_UPDATE_NONE = 0;
    static readonly BLOOM_UPDATE_ALL = 1;
    static readonly BLOOM_UPDATE_P2PUBKEY_ONLY = 2;
    nHashFuncs: number;
    nTweak: number;
    nFlags: number;
    vData: number[];
    /**
     * Null for a degenerate filter (no data or no hash functions), such as
     * Core's default-constructed CBloomFilter used in govsync. The library
     * cannot represent those.
     */
    private inner;
    constructor(nHashFuncs: number, nTweak: number, nFlags: number, vData: number[]);
    /** An empty filter as Core default-constructs it (no data, no hash functions). */
    static empty(): BloomFilter;
    static create(n: number, fpRate: number, nTweak?: number, nFlags?: number): BloomFilter;
    insert(data: Uint8Array): void;
    /** Like Core, a degenerate filter matches everything. */
    contains(data: Uint8Array): boolean;
    static fromBytes(payload: Uint8Array): BloomFilter;
    toBytes(): Uint8Array;
}
