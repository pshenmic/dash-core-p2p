import { Message } from '../Message.js';
/**
 * Signals support for the addrv2 message format (BIP155).
 * Sent after version and before verack. No payload.
 */
export class SendAddrV2Message extends Message {
    constructor(_arg, options) {
        super({ ...options, command: 'sendaddrv2' });
    }
    getPayload() {
        return new Uint8Array(0);
    }
}
//# sourceMappingURL=SendAddrV2Message.js.map