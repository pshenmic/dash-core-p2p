import { Message, MessageOptions } from '../Message.js';
import { Transaction } from 'dash-core-sdk';
/**
 * Transaction lock request message (InstantSend).
 */
export declare class TXLockRequestMessage extends Message {
    transaction: Transaction;
    constructor(arg: Transaction | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
