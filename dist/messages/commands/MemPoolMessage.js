import { Message } from '../Message.js';
/**
 * Request the peer to send its mempool contents.
 */
export class MemPoolMessage extends Message {
    constructor(_arg, options) {
        super({ ...options, command: 'mempool' });
    }
    getPayload() {
        return new Uint8Array(0);
    }
}
//# sourceMappingURL=MemPoolMessage.js.map