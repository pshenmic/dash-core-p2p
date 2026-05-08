import { Message } from '../Message.js';
import { utils } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';
/**
 * DarkSend queue message.
 */
export class DSQueueMessage extends Message {
    nonce;
    constructor(_arg, options) {
        super({ ...options, command: 'dsq' });
    }
    setPayload(payload) {
        const parser = new BufferReader(payload);
        this.nonce = parser.read(8);
    }
    getPayload() {
        return this.nonce ?? utils.getNonce();
    }
}
//# sourceMappingURL=DSQueueMessage.js.map