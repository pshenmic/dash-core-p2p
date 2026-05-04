import { Message, MessageOptions } from '../Message.js';
import { MnListDiff } from '../../MnListDiff.js';
/**
 * Masternode list difference message.
 */
export declare class MnListDiffMessage extends Message {
    mnlistdiff: MnListDiff | undefined;
    constructor(arg: MnListDiff | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
