import { Message, MessageOptions } from '../Message.js';
export interface Outpoint {
    txid: string;
    vout: number;
}
export interface ISLockArgs {
    inputs?: Outpoint[];
    txid?: string;
    sig?: Uint8Array;
}
/**
 * InstantSend lock message (DIP10).
 * Received when a quorum has locked a transaction for instant finality.
 *
 * Wire format:
 *   inputs_count  varint
 *   inputs[]      36 bytes each  (txid 32 LE + vout 4 LE)
 *   txid          32 bytes LE
 *   sig           96 bytes BLS signature
 */
export declare class ISLockMessage extends Message {
    inputs: Outpoint[];
    txid: string;
    sig: Uint8Array;
    constructor(arg: ISLockArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
