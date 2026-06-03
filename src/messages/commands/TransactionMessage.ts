import { Message, MessageOptions } from '../Message.js';
import { Transaction } from 'dash-core-sdk';
import {bytesToHex} from "../../utils/binary.js";

/**
 * Transaction message for broadcasting transactions to the network.
 */
export class TransactionMessage extends Message {
  transaction: Transaction;

  constructor(arg: Transaction | undefined, options: MessageOptions) {
    super({ ...options, command: 'tx' });
    if (arg != null && !(arg instanceof Transaction)) {
      throw new Error('Argument must be an instance of Transaction');
    }
    this.transaction = arg ?? new Transaction();
  }

  setPayload(payload: Uint8Array): void {
    // Use .slice() to get a fresh ArrayBuffer at offset 0.
    // Transaction.fromBytes uses `new DataView(bytes.buffer)` without accounting
    // for byteOffset — a subarray of a larger message buffer would produce wrong
    // version/type values and therefore a wrong hash().
    //
    // Wrap in try/catch because the SDK's tx parser can throw RangeError on
    // malformed extraPayload varints or truncated inputs. We'd rather keep the
    // peer connection alive and drop the one bad tx than crash the sync.
    try {
      this.transaction = Transaction.fromBytes(payload.slice());
    } catch (e) {
      console.warn(`[tx] failed to parse transaction ${bytesToHex(payload)} (${payload.byteLength} bytes): ${(e as Error).message}`);
      this.transaction = new Transaction();
    }
  }

  getPayload(): Uint8Array {
    return this.transaction.bytes();
  }
}
