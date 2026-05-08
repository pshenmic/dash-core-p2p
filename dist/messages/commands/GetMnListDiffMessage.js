import { Message } from '../Message.js';
import { hexToBytes, bytesToHex } from '../../utils/binary.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
/**
 * Request a masternode list difference from a peer.
 */
export class GetMnListDiffMessage extends Message {
    baseBlockHash;
    blockHash;
    constructor(args, options) {
        super({ ...options, command: 'getmnlistdiff' });
        const a = args ?? {};
        this.baseBlockHash = a.baseBlockHash;
        this.blockHash = a.blockHash;
    }
    setPayload(payload) {
        const parser = new BufferReader(payload);
        if (parser.finished()) {
            throw new Error('No data received in payload');
        }
        this.baseBlockHash = bytesToHex(parser.read(32));
        this.blockHash = bytesToHex(parser.read(32));
    }
    getPayload() {
        const bw = new BufferWriter();
        bw.write(hexToBytes(this.baseBlockHash ?? '0'.repeat(64)));
        bw.write(hexToBytes(this.blockHash ?? '0'.repeat(64)));
        return bw.concat();
    }
}
//# sourceMappingURL=GetMnListDiffMessage.js.map