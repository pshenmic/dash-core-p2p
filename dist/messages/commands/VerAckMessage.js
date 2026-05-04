import { Message } from '../Message.js';
/**
 * Version acknowledgment - sent in response to a version message.
 */
export class VerAckMessage extends Message {
    constructor(_arg, options) {
        super({ ...options, command: 'verack' });
    }
    getPayload() {
        return new Uint8Array(0);
    }
}
//# sourceMappingURL=VerAckMessage.js.map