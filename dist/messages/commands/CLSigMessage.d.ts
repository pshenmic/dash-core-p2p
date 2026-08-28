import { Message, MessageOptions } from '../Message.js';
export interface CLSigArgs {
    height?: number;
    blockHash?: string;
    sig?: Uint8Array;
}
/**
 * ChainLock signature message (DIP8).
 * Received when a quorum has signed a block hash, making it irreversibly final.
 *
 * Wire format:
 *   height     4 bytes uint32 LE
 *   blockHash  32 bytes LE
 *   sig        96 bytes BLS signature
 */
export declare class CLSigMessage extends Message {
    height: number;
    blockHash: string;
    sig: Uint8Array;
    constructor(arg: CLSigArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
