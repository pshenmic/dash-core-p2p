import { Message, MessageOptions } from '../Message.js';
export interface CFCheckptArgs {
    filterType?: number;
    stopHash?: Uint8Array;
    filterHeaders?: Uint8Array[];
}
/**
 * BIP 157 `cfcheckpt`: filter-header chain values at every 1000th block.
 * Use these to anchor `cfheaders` ranges before fetching `cfilter` data.
 */
export declare class CFCheckptMessage extends Message {
    filterType: number;
    stopHash: Uint8Array;
    filterHeaders: Uint8Array[];
    constructor(arg: CFCheckptArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
