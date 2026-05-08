import { Message } from '../Message.js';
import { utils } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
/**
 * BIP 157 `cfheaders`: a contiguous list of filter hashes plus the
 * filter-header value of the block immediately before the range. Caller
 * derives the chain by repeated `dSHA256(filter_hash || prev_header)`.
 */
export class CFHeadersMessage extends Message {
    filterType;
    stopHash;
    previousFilterHeader;
    filterHashes;
    constructor(arg, options) {
        super({ ...options, command: 'cfheaders' });
        const a = arg ?? {};
        this.filterType = a.filterType ?? 0;
        this.stopHash = a.stopHash ?? new Uint8Array(32);
        this.previousFilterHeader = a.previousFilterHeader ?? new Uint8Array(32);
        this.filterHashes = a.filterHashes ?? [];
    }
    setPayload(payload) {
        const parser = new BufferReader(payload);
        this.filterType = parser.readUInt8();
        this.stopHash = parser.read(32).slice();
        this.previousFilterHeader = parser.read(32).slice();
        const count = parser.readVarintNum();
        this.filterHashes = [];
        for (let i = 0; i < count; i++)
            this.filterHashes.push(parser.read(32).slice());
        utils.checkFinished(parser);
    }
    getPayload() {
        if (this.stopHash.length !== 32)
            throw new Error('stopHash must be 32 bytes');
        if (this.previousFilterHeader.length !== 32)
            throw new Error('previousFilterHeader must be 32 bytes');
        const bw = new BufferWriter();
        bw.writeUInt8(this.filterType);
        bw.write(this.stopHash);
        bw.write(this.previousFilterHeader);
        bw.writeVarintNum(this.filterHashes.length);
        for (const h of this.filterHashes) {
            if (h.length !== 32)
                throw new Error('filterHash must be 32 bytes');
            bw.write(h);
        }
        return bw.concat();
    }
}
//# sourceMappingURL=CFHeadersMessage.js.map