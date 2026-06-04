import { Message, MessageOptions } from '../Message.js';
import { Transaction } from 'dash-core-sdk';
/**
 * Transaction message for broadcasting transactions to the network.
 */
export declare class TransactionMessage extends Message {
    transaction: Transaction;
    constructor(arg: Transaction | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
