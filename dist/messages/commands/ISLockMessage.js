import { Message } from '../Message.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
import { bytesToHex, hexToBytes } from '../../utils/binary.js';
/**
 * InstantSend lock message (DIP10).
 * Received when a quorum has locked a transaction for instant finality.
 *
 * Wire format:
 *   inputs_count  varint
 *   inputs[]      36 bytes each  (txid 32 LE + vout 4 LE)
 *   txid          32 bytes LE
 *   sig           96 bytes BLS signature
 */
export class ISLockMessage extends Message {
    inputs;
    txid;
    sig;
    constructor(arg, options) {
        super({ ...options, command: 'islock' });
        const a = arg ?? {};
        this.inputs = a.inputs ?? [];
        this.txid = a.txid ?? '00'.repeat(32);
        this.sig = a.sig ?? new Uint8Array(96);
    }
    setPayload(payload) {
        const r = new BufferReader(payload);
        const count = r.readVarintNum();
        this.inputs = [];
        for (let i = 0; i < count; i++) {
            const txid = bytesToHex(r.read(32));
            const vout = r.readUInt32LE();
            this.inputs.push({ txid, vout });
        }
        this.txid = bytesToHex(r.read(32));
        this.sig = r.read(96);
    }
    getPayload() {
        const bw = new BufferWriter();
        bw.writeVarintNum(this.inputs.length);
        for (const input of this.inputs) {
            bw.write(hexToBytes(input.txid));
            bw.writeUInt32LE(input.vout);
        }
        bw.write(hexToBytes(this.txid));
        bw.write(this.sig);
        return bw.concat();
    }
}
//# sourceMappingURL=ISLockMessage.js.map