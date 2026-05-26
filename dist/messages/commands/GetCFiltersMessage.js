import { Message } from '../Message.js';
import { utils } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
/**
 * BIP 157 `getcfilters`: request a contiguous range of compact filters.
 * `stopHash` is in wire (internal) byte order.
 */
export class GetCFiltersMessage extends Message {
    filterType;
    startHeight;
    stopHash;
    constructor(arg, options) {
        super({ ...options, command: 'getcfilters' });
        const a = arg ?? {};
        this.filterType = a.filterType ?? 0;
        this.startHeight = a.startHeight ?? 0;
        this.stopHash = a.stopHash ?? new Uint8Array(32);
    }
    setPayload(payload) {
        const parser = new BufferReader(payload);
        this.filterType = parser.readUInt8();
        this.startHeight = parser.readUInt32LE();
        this.stopHash = parser.read(32);
        utils.checkFinished(parser);
    }
    getPayload() {
        if (this.stopHash.length !== 32)
            throw new Error('stopHash must be 32 bytes');
        const bw = new BufferWriter();
        bw.writeUInt8(this.filterType);
        bw.writeUInt32LE(this.startHeight);
        bw.write(this.stopHash);
        return bw.concat();
    }
}
//# sourceMappingURL=GetCFiltersMessage.js.map