import { Message } from '../Message.js';
import { utils } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
/**
 * BIP 157 `cfcheckpt`: filter-header chain values at every 1000th block.
 * Use these to anchor `cfheaders` ranges before fetching `cfilter` data.
 */
export class CFCheckptMessage extends Message {
    filterType;
    stopHash;
    filterHeaders;
    constructor(arg, options) {
        super({ ...options, command: 'cfcheckpt' });
        const a = arg ?? {};
        this.filterType = a.filterType ?? 0;
        this.stopHash = a.stopHash ?? new Uint8Array(32);
        this.filterHeaders = a.filterHeaders ?? [];
    }
    setPayload(payload) {
        const parser = new BufferReader(payload);
        this.filterType = parser.readUInt8();
        this.stopHash = parser.read(32).slice();
        const count = parser.readVarintNum();
        this.filterHeaders = [];
        for (let i = 0; i < count; i++)
            this.filterHeaders.push(parser.read(32).slice());
        utils.checkFinished(parser);
    }
    getPayload() {
        if (this.stopHash.length !== 32)
            throw new Error('stopHash must be 32 bytes');
        const bw = new BufferWriter();
        bw.writeUInt8(this.filterType);
        bw.write(this.stopHash);
        bw.writeVarintNum(this.filterHeaders.length);
        for (const h of this.filterHeaders) {
            if (h.length !== 32)
                throw new Error('filterHeader must be 32 bytes');
            bw.write(h);
        }
        return bw.concat();
    }
}
//# sourceMappingURL=CFCheckptMessage.js.map