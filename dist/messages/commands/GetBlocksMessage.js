import { Message } from '../Message.js';
import { utils } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
/**
 * Query a peer for blocks starting from one or more hashes.
 */
export class GetBlocksMessage extends Message {
    version;
    starts;
    stop;
    constructor(arg, options) {
        super({ ...options, command: 'getblocks' });
        this.version = options.protocolVersion;
        const sanitized = utils.sanitizeStartStop(arg ?? {});
        this.starts = sanitized.starts;
        this.stop = sanitized.stop;
    }
    setPayload(payload) {
        const parser = new BufferReader(payload);
        if (parser.finished()) {
            throw new Error('No data received in payload');
        }
        this.version = parser.readUInt32LE();
        const startCount = parser.readVarintNum();
        this.starts = [];
        for (let i = 0; i < startCount; i++) {
            this.starts.push(parser.read(32));
        }
        this.stop = parser.read(32);
        utils.checkFinished(parser);
    }
    getPayload() {
        const bw = new BufferWriter();
        bw.writeUInt32LE(this.version);
        bw.writeVarintNum(this.starts.length);
        for (const start of this.starts) {
            bw.write(start);
        }
        if (this.stop.length !== 32) {
            throw new Error('Invalid hash length: ' + this.stop.length);
        }
        bw.write(this.stop);
        return bw.concat();
    }
}
//# sourceMappingURL=GetBlocksMessage.js.map