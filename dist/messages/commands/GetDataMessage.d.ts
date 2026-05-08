import { Message, MessageOptions } from '../Message.js';
import type { InventoryItem } from './InvMessage.js';
/**
 * Request specific data (transactions, blocks, etc.) from a peer.
 */
export declare class GetDataMessage extends Message {
    inventory: InventoryItem[];
    constructor(arg: InventoryItem[] | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
