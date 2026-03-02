declare module 'bloom-filter' {
  interface BloomFilterOptions {
    vData?: number[];
    nHashFuncs?: number;
    nTweak?: number;
    nFlags?: number;
  }

  class BloomFilter {
    vData: number[];
    nHashFuncs: number;
    nTweak: number;
    nFlags: number;

    constructor(options?: BloomFilterOptions);

    insert(data: Uint8Array | string): void;
    contains(data: Uint8Array | string): boolean;
    isRelevantAndUpdate(transaction: unknown): boolean;
    clear(): void;

    static fromBytes(payload: Uint8Array): BloomFilter;
    toBytes(): Uint8Array;

    static create(elements: number, falsePositiveRate: number, nTweak?: number, nFlags?: number): BloomFilter;
    static readonly BLOOM_UPDATE_ALL: number;
    static readonly BLOOM_UPDATE_NONE: number;
    static readonly BLOOM_UPDATE_P2PUBKEY_ONLY: number;
  }

  export = BloomFilter;
}
