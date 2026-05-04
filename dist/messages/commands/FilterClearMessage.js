import { Message } from '../Message.js';
/**
 * Clear the bloom filter on a peer.
 */
export class FilterClearMessage extends Message {
    constructor(_arg, options) {
        super({ ...options, command: 'filterclear' });
    }
    getPayload() {
        return new Uint8Array(0);
    }
}
//# sourceMappingURL=FilterClearMessage.js.map