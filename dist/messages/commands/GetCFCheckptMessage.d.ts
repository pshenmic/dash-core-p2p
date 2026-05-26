import { Message, MessageOptions } from '../Message.js';
export interface GetCFCheckptArgs {
    filterType?: number;
    stopHash?: Uint8Array;
}
/**
 * BIP 157 `getcfcheckpt`: request filter headers at every 1000-block
 * checkpoint up to and including `stopHash`.
 */
export declare class GetCFCheckptMessage extends Message {
    filterType: number;
    stopHash: Uint8Array;
    constructor(arg: GetCFCheckptArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
