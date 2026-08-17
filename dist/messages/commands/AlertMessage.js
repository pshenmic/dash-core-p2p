import { Message } from '../Message.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
/**
 * Alert message for broadcasting network-wide alerts.
 */
export class AlertMessage extends Message {
    payload;
    signature;
    constructor(arg, options) {
        super({ ...options, command: 'alert' });
        const a = arg ?? {};
        if (a.payload != null && !(a.payload instanceof Uint8Array)) {
            throw new Error('Payload must be a Uint8Array');
        }
        if (a.payload != null && !(a.payload instanceof Uint8Array)) {
            throw new Error('Signature must be a Uint8Array');
        }
        this.payload = a.payload;
        this.signature = a.signature;
    }
    setPayload(data) {
        const parser = new BufferReader(data);
        this.payload = parser.readVarLengthBuffer();
        this.signature = parser.readVarLengthBuffer();
    }
    getPayload() {
        const bw = new BufferWriter();
        const p = this.payload ?? new Uint8Array(0);
        const s = this.signature ?? new Uint8Array(0);
        bw.writeVarintNum(p.length);
        bw.write(p);
        bw.writeVarintNum(s.length);
        bw.write(s);
        return bw.concat();
    }
}
//# sourceMappingURL=AlertMessage.js.map