import bloomFilterLib from 'bloom-filter';
import { BufferReader } from './encoding/BufferReader.js';
import { BufferWriter } from './encoding/BufferWriter.js';

export class BloomFilter {
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
  private inner: InstanceType<typeof bloomFilterLib> | null;

  constructor(nHashFuncs: number, nTweak: number, nFlags: number, vData: number[]) {
    this.nHashFuncs = nHashFuncs;
    this.nTweak = nTweak;
    this.nFlags = nFlags;
    this.vData = vData;
    this.inner = nHashFuncs > 0 && vData.length > 0
      ? new bloomFilterLib({ vData, nHashFuncs, nTweak, nFlags })
      : null;
  }

  /** An empty filter as Core default-constructs it (no data, no hash functions). */
  static empty(): BloomFilter {
    return new BloomFilter(0, 0, 0, []);
  }

  static create(n: number, fpRate: number, nTweak = 0, nFlags = BloomFilter.BLOOM_UPDATE_ALL): BloomFilter {
    const inner = bloomFilterLib.create(n, fpRate, nTweak, nFlags);
    return new BloomFilter(inner.nHashFuncs, inner.nTweak, inner.nFlags, inner.vData);
  }

  insert(data: Uint8Array): void {
    if (!this.inner) return; // nothing to set, as in Core
    this.inner.insert(data as any);
    this.vData = this.inner.vData;
  }

  /** Like Core, a degenerate filter matches everything. */
  contains(data: Uint8Array): boolean {
    if (!this.inner) return true;
    return this.inner.contains(data as any);
  }

  static fromBytes(payload: Uint8Array): BloomFilter {
    const parser = new BufferReader(payload);
    const length = parser.readVarintNum();
    const vData: number[] = [];
    for (let i = 0; i < length; i++) {
      vData.push(parser.readUInt8());
    }
    const nHashFuncs = parser.readUInt32LE();
    const nTweak = parser.readUInt32LE();
    const nFlags = parser.readUInt8();
    return new BloomFilter(nHashFuncs, nTweak, nFlags, vData);
  }

  toBytes(): Uint8Array {
    const bw = new BufferWriter();
    bw.writeVarintNum(this.vData.length);
    for (let i = 0; i < this.vData.length; i++) {
      bw.writeUInt8(this.vData[i]!);
    }
    bw.writeUInt32LE(this.nHashFuncs);
    bw.writeUInt32LE(this.nTweak);
    bw.writeUInt8(this.nFlags);
    return bw.concat();
  }
}
