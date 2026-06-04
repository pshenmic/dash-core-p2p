import { Message, MessageOptions } from '../Message.js';
export interface RejectMessageArgs {
    message?: string;
    ccode?: number;
    reason?: string;
    data?: Uint8Array;
}
export declare const RejectCCode: {
    readonly REJECT_MALFORMED: 1;
    readonly REJECT_INVALID: 16;
    readonly REJECT_OBSOLETE: 17;
    readonly REJECT_DUPLICATE: 18;
    readonly REJECT_NONSTANDARD: 64;
    readonly REJECT_DUST: 65;
    readonly REJECT_INSUFFICIENTFEE: 66;
    readonly REJECT_CHECKPOINT: 67;
};
/**
 * Message sent when a message is rejected.
 */
export declare class RejectMessage extends Message {
    message: string | undefined;
    ccode: number | undefined;
    reason: string | undefined;
    data: Uint8Array | undefined;
    static CCODE: {
        readonly REJECT_MALFORMED: 1;
        readonly REJECT_INVALID: 16;
        readonly REJECT_OBSOLETE: 17;
        readonly REJECT_DUPLICATE: 18;
        readonly REJECT_NONSTANDARD: 64;
        readonly REJECT_DUST: 65;
        readonly REJECT_INSUFFICIENTFEE: 66;
        readonly REJECT_CHECKPOINT: 67;
    };
    constructor(arg: RejectMessageArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
