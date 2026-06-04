import { Message } from '../Message.js';
/**
 * Requests the peer to announce new blocks via headers messages instead of inv (BIP130).
 * No payload. Send once after the handshake is complete.
 */
export class SendHeadersMessage extends Message {
    constructor(_arg, options) {
        super({ ...options, command: 'sendheaders' });
    }
    getPayload() {
        return new Uint8Array(0);
    }
}
//# sourceMappingURL=SendHeadersMessage.js.map