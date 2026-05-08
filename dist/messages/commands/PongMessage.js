import { Message } from '../Message.js';
import { utils } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';
/**
 * Response to a ping message.
 */
export class PongMessage extends Message {
    nonce;
    constructor(arg, options) {
        super({ ...options, command: 'pong' });
        if (arg != null && (!(arg instanceof Uint8Array)) || (arg instanceof Uint8Array && arg.length !== 8)) {
            throw new Error('First argument is expected to be an 8 byte buffer');
        }
        this.nonce = arg ?? utils.getNonce();
    }
    setPayload(payload) {
        const parser = new BufferReader(payload);
        this.nonce = parser.read(8);
        utils.checkFinished(parser);
    }
    getPayload() {
        return this.nonce;
    }
}
//# sourceMappingURL=PongMessage.js.map