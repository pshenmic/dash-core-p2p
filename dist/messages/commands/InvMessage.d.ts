import { Message, MessageOptions } from '../Message.js';
export interface InventoryItem {
    type: number;
    hash: Uint8Array;
}
/**
 * Inventory message - announces known data items (transactions, blocks, etc.)
 */
export declare class InvMessage extends Message {
    inventory: InventoryItem[];
    constructor(arg: InventoryItem[] | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
