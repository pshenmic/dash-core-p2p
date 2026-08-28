import { Message, MessageOptions } from '../Message.js';
/**
 * Sync status count message.
 */
export declare class SyncStatusCountMessage extends Message {
    itemId: number | undefined;
    count: number | undefined;
    constructor(arg: {
        itemId?: number;
        count?: number;
    } | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
