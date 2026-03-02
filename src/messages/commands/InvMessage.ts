import { Message, MessageOptions } from '../Message.js';
import { utils } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';

export interface InventoryItem {
  type: number;
  hash: Uint8Array;
}

/**
 * Inventory message - announces known data items (transactions, blocks, etc.)
 */
export class InvMessage extends Message {
  inventory: InventoryItem[];

  constructor(arg: InventoryItem[] | undefined, options: MessageOptions) {
    super({ ...options, command: 'inv' });
    utils.checkInventory(arg ?? []);
    this.inventory = arg ?? [];
  }

  setPayload(payload: Uint8Array): void {
    this.inventory = [];
    const parser = new BufferReader(payload);
    const count = parser.readVarintNum();

    for (let i = 0; i < count; i++) {
      const type = parser.readUInt32LE();
      const hash = parser.read(32);
      this.inventory.push({ type, hash });
    }

    utils.checkFinished(parser);
  }

  getPayload(): Uint8Array {
    const bw = new BufferWriter();
    utils.writeInventory(this.inventory ?? [], bw);
    return bw.concat();
  }
}
