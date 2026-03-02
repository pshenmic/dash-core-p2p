import { Message, MessageOptions } from '../Message.js';
import { BloomFilter } from '../../BloomFilter.js';

/**
 * Request peer to send inv messages based on a bloom filter.
 */
export class FilterLoadMessage extends Message {
  filter: BloomFilter | undefined;

  constructor(arg: { filter?: BloomFilter } | undefined, options: MessageOptions) {
    super({ ...options, command: 'filterload' });
    const a = arg ?? {};
    if (a.filter != null && !(a.filter instanceof BloomFilter)) {
      throw new Error('An instance of BloomFilter is expected');
    }
    this.filter = a.filter;
  }

  setPayload(payload: Uint8Array): void {
    this.filter = BloomFilter.fromBytes(payload);
  }

  getPayload(): Uint8Array {
    if (this.filter) {
      return this.filter.toBytes();
    }
    return new Uint8Array(0);
  }
}
