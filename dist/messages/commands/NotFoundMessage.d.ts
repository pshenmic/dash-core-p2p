import { Message, MessageOptions } from '../Message.js';
import type { InventoryItem } from './InvMessage.js';
/**
 * Indicates that requested data was not found.
 */
export declare class NotFoundMessage extends Message {
    inventory: InventoryItem[];
    constructor(arg: InventoryItem[] | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
