import { Message } from '../Message.js';
import { MnListDiff } from '../../MnListDiff.js';
/**
 * Masternode list difference message.
 */
export class MnListDiffMessage extends Message {
    mnlistdiff;
    constructor(arg, options) {
        super({ ...options, command: 'mnlistdiff' });
        if (arg != null && !(arg instanceof MnListDiff)) {
            throw new Error('An instance of MnListDiff or undefined is expected');
        }
        this.mnlistdiff = arg;
    }
    setPayload(payload) {
        if (!(payload instanceof Uint8Array) || payload.length === 0) {
            throw new Error('No data found to create MnListDiff message');
        }
        this.mnlistdiff = MnListDiff.fromBytes(payload);
    }
    getPayload() {
        return this.mnlistdiff ? this.mnlistdiff.toBytes() : new Uint8Array(0);
    }
}
//# sourceMappingURL=MnListDiffMessage.js.map