import { Message, MessageOptions } from '../Message.js';
import { Transaction } from 'dash-core-sdk';

/**
 * Transaction lock request message (InstantSend).
 */
export class TXLockRequestMessage extends Message {
  transaction: Transaction;

  constructor(arg: Transaction | undefined, options: MessageOptions) {
    super({ ...options, command: 'ix' });
    if (arg != null && !(arg instanceof Transaction)) {
      throw new Error('Argument must be an instance of Transaction');
    }
    this.transaction = arg ?? new Transaction();
  }

  setPayload(payload: Uint8Array): void {
    this.transaction = Transaction.fromBytes(payload);
  }

  getPayload(): Uint8Array {
    return this.transaction.bytes();
  }
}
