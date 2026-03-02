import { Message, MessageOptions } from '../Message.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';

/**
 * Sync status count message.
 */
export class SyncStatusCountMessage extends Message {
  itemId: number | undefined;
  count: number | undefined;

  constructor(arg: { itemId?: number; count?: number } | undefined, options: MessageOptions) {
    super({ ...options, command: 'ssc' });
    const a = arg ?? {};
    this.itemId = a.itemId;
    this.count = a.count;
  }

  setPayload(payload: Uint8Array): void {
    const parser = new BufferReader(payload);
    this.itemId = parser.readUInt32LE();
    this.count = parser.readUInt32LE();
  }

  getPayload(): Uint8Array {
    const bw = new BufferWriter();
    bw.writeUInt32LE(this.itemId ?? 0);
    bw.writeUInt32LE(this.count ?? 0);
    return bw.concat();
  }
}
