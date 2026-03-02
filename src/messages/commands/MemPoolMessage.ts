import { Message, MessageOptions } from '../Message.js';

/**
 * Request the peer to send its mempool contents.
 */
export class MemPoolMessage extends Message {
  constructor(_arg: undefined, options: MessageOptions) {
    super({ ...options, command: 'mempool' });
  }

  getPayload(): Uint8Array {
    return new Uint8Array(0);
  }
}
