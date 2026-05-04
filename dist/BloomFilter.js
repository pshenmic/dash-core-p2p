import bloomFilterLib from 'bloom-filter';
import { BufferReader } from './encoding/BufferReader.js';
import { BufferWriter } from './encoding/BufferWriter.js';
export class BloomFilter {
    static BLOOM_UPDATE_NONE = 0;
    static BLOOM_UPDATE_ALL = 1;
    static BLOOM_UPDATE_P2PUBKEY_ONLY = 2;
    nHashFuncs;
    nTweak;
    nFlags;
    vData;
    inner;
    constructor(nHashFuncs, nTweak, nFlags, vData) {
        this.nHashFuncs = nHashFuncs;
        this.nTweak = nTweak;
        this.nFlags = nFlags;
        this.vData = vData;
        this.inner = new bloomFilterLib({ vData, nHashFuncs, nTweak, nFlags });
    }
    static create(n, fpRate, nTweak = 0, nFlags = BloomFilter.BLOOM_UPDATE_ALL) {
        const inner = bloomFilterLib.create(n, fpRate, nTweak, nFlags);
        return new BloomFilter(inner.nHashFuncs, inner.nTweak, inner.nFlags, inner.vData);
    }
    insert(data) {
        this.inner.insert(data);
        this.vData = this.inner.vData;
    }
    contains(data) {
        return this.inner.contains(data);
    }
    static fromBytes(payload) {
        const parser = new BufferReader(payload);
        const length = parser.readVarintNum();
        const vData = [];
        for (let i = 0; i < length; i++) {
            vData.push(parser.readUInt8());
        }
        const nHashFuncs = parser.readUInt32LE();
        const nTweak = parser.readUInt32LE();
        const nFlags = parser.readUInt8();
        return new BloomFilter(nHashFuncs, nTweak, nFlags, vData);
    }
    toBytes() {
        const bw = new BufferWriter();
        bw.writeVarintNum(this.vData.length);
        for (let i = 0; i < this.vData.length; i++) {
            bw.writeUInt8(this.vData[i]);
        }
        bw.writeUInt32LE(this.nHashFuncs);
        bw.writeUInt32LE(this.nTweak);
        bw.writeUInt8(this.nFlags);
        return bw.concat();
    }
}
//# sourceMappingURL=BloomFilter.js.map