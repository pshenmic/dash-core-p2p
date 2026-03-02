import { Message, MessageOptions } from '../Message.js';

/**
 * Clear the bloom filter on a peer.
 */
export class FilterClearMessage extends Message {
  constructor(_arg: undefined, options: MessageOptions) {
    super({ ...options, command: 'filterclear' });
  }

  getPayload(): Uint8Array {
    return new Uint8Array(0);
  }
}
