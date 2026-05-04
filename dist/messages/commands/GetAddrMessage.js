import { Message } from '../Message.js';
/**
 * Request a list of known peers from the connected peer.
 */
export class GetAddrMessage extends Message {
    constructor(_arg, options) {
        super({ ...options, command: 'getaddr' });
    }
    getPayload() {
        return new Uint8Array(0);
    }
}
//# sourceMappingURL=GetAddrMessage.js.map