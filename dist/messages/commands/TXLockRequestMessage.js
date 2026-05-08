import { Message } from '../Message.js';
import { Transaction } from 'dash-core-sdk';
/**
 * Transaction lock request message (InstantSend).
 */
export class TXLockRequestMessage extends Message {
    transaction;
    constructor(arg, options) {
        super({ ...options, command: 'ix' });
        if (arg != null && !(arg instanceof Transaction)) {
            throw new Error('Argument must be an instance of Transaction');
        }
        this.transaction = arg ?? new Transaction();
    }
    setPayload(payload) {
        this.transaction = Transaction.fromBytes(payload);
    }
    getPayload() {
        return this.transaction.bytes();
    }
}
//# sourceMappingURL=TXLockRequestMessage.js.map