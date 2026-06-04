import { Message, MessageOptions } from '../Message.js';
export interface FeeFilterArgs {
    feeRate?: bigint;
}
/**
 * Fee filter message (BIP 133), command `feefilter`.
 *
 * A peer advertises the minimum fee rate (in duffs per 1000 bytes) it will
 * accept for relayed transactions; txs below this rate won't be relayed to or
 * accepted by that peer. Peers send this after the handshake, so it must be
 * parsed rather than rejected — otherwise it breaks the receive/broadcast flow.
 *
 * Wire format:
 *   feeRate  8 bytes int64 LE (duffs/kB)
 */
export declare class FeeFilterMessage extends Message {
    feeRate: bigint;
    constructor(arg: FeeFilterArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
