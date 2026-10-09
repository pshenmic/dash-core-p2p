import { Message } from '../Message.js';
import { hexToBytes, bytesToHex, reverseBytes } from '../../utils/binary.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
/**
 * Request a masternode list difference from a peer.
 *
 * Wire command is `getmnlistd` (Dash Core NetMsgType::GETMNLISTDIFF).
 * Hashes are kept in display order and reversed to wire order on serialization,
 * matching the convention used by MnListDiff.
 */
export class GetMnListDiffMessage extends Message {
    baseBlockHash;
    blockHash;
    constructor(args, options) {
        super({ ...options, command: 'getmnlistd' });
        const a = args ?? {};
        this.baseBlockHash = a.baseBlockHash;
        this.blockHash = a.blockHash;
    }
    setPayload(payload) {
        const parser = new BufferReader(payload);
        if (parser.finished()) {
            throw new Error('No data received in payload');
        }
        if (payload.length !== 64) {
            throw new Error('getmnlistd: invalid payload length ' + payload.length);
        }
        this.baseBlockHash = bytesToHex(reverseBytes(parser.read(32)));
        this.blockHash = bytesToHex(reverseBytes(parser.read(32)));
    }
    getPayload() {
        const bw = new BufferWriter();
        bw.write(reverseBytes(hexToBytes(this.baseBlockHash ?? '0'.repeat(64))));
        bw.write(reverseBytes(hexToBytes(this.blockHash ?? '0'.repeat(64))));
        return bw.concat();
    }
}
//# sourceMappingURL=GetMnListDiffMessage.js.map