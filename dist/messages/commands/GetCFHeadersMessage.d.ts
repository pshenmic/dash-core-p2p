import { Message, MessageOptions } from '../Message.js';
export interface GetCFHeadersArgs {
    filterType?: number;
    startHeight?: number;
    stopHash?: Uint8Array;
}
/**
 * BIP 157 `getcfheaders`: request a range of filter-header chain entries.
 */
export declare class GetCFHeadersMessage extends Message {
    filterType: number;
    startHeight: number;
    stopHash: Uint8Array;
    constructor(arg: GetCFHeadersArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
