import { Message, MessageOptions } from '../Message.js';
import type { Outpoint } from './ISLockMessage.js';
export interface ISDLockArgs {
    version?: number;
    inputs?: Outpoint[];
    txid?: string;
    cycleHash?: string;
    sig?: Uint8Array;
}
/**
 * Deterministic InstantSend lock message (DIP24), command `isdlock`.
 *
 * This supersedes the legacy DIP-10 `islock` (see {@link ISLockMessage}):
 * current Dash Core no longer emits `islock`, only `isdlock`. The wire shape
 * adds a leading `nVersion` byte and a `cycleHash` (the hash of the first
 * block in the signing quorum's DKG cycle, which deterministically selects
 * the quorum).
 *
 * Wire format (Dash Core `instantsend::InstantSendLock`):
 *   nVersion      1 byte  uint8   (CURRENT_VERSION = 1)
 *   inputs_count  varint
 *   inputs[]      36 bytes each   (txid 32 LE + vout 4 LE)
 *   txid          32 bytes LE
 *   cycleHash     32 bytes LE
 *   sig           96 bytes BLS signature
 */
export declare class ISDLockMessage extends Message {
    version: number;
    inputs: Outpoint[];
    txid: string;
    cycleHash: string;
    sig: Uint8Array;
    constructor(arg: ISDLockArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
