import { Message } from '../Message.js';
import { utils } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
/**
 * BIP 157 `getcfcheckpt`: request filter headers at every 1000-block
 * checkpoint up to and including `stopHash`.
 */
export class GetCFCheckptMessage extends Message {
    filterType;
    stopHash;
    constructor(arg, options) {
        super({ ...options, command: 'getcfcheckpt' });
        const a = arg ?? {};
        this.filterType = a.filterType ?? 0;
        this.stopHash = a.stopHash ?? new Uint8Array(32);
    }
    setPayload(payload) {
        const parser = new BufferReader(payload);
        this.filterType = parser.readUInt8();
        this.stopHash = parser.read(32);
        utils.checkFinished(parser);
    }
    getPayload() {
        if (this.stopHash.length !== 32)
            throw new Error('stopHash must be 32 bytes');
        const bw = new BufferWriter();
        bw.writeUInt8(this.filterType);
        bw.write(this.stopHash);
        return bw.concat();
    }
}
//# sourceMappingURL=GetCFCheckptMessage.js.map