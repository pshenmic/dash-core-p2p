import { Message } from '../Message.js';
import { utils } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
/**
 * Response to a getheaders message, containing block headers.
 * Each header is stored as a raw 80-byte Uint8Array.
 */
export class HeadersMessage extends Message {
    headers;
    constructor(arg, options) {
        super({ ...options, command: 'headers' });
        if (arg != null && !Array.isArray(arg)) {
            throw new Error('First argument is expected to be an array of block headers');
        }
        this.headers = arg;
    }
    setPayload(payload) {
        if (!(payload instanceof Uint8Array) || payload.length === 0) {
            throw new Error('No data found to create Headers message');
        }
        const parser = new BufferReader(payload);
        const count = parser.readVarintNum();
        this.headers = [];
        for (let i = 0; i < count; i++) {
            // Use .slice() to get a proper copy with a fresh ArrayBuffer at offset 0.
            // BlockHeader.fromBytes uses `new DataView(bytes.buffer)` which ignores
            // byteOffset — a subarray into a larger message buffer would be misread.
            this.headers.push(parser.read(80).slice());
            const txnCount = parser.readUInt8();
            if (txnCount !== 0) {
                throw new Error('Transaction count should always be 0');
            }
        }
        utils.checkFinished(parser);
    }
    getPayload() {
        const bw = new BufferWriter();
        const headers = this.headers ?? [];
        bw.writeVarintNum(headers.length);
        for (const header of headers) {
            bw.write(header);
            bw.writeUInt8(0);
        }
        return bw.concat();
    }
}
//# sourceMappingURL=HeadersMessage.js.map