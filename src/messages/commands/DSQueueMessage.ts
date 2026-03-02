import { Message, MessageOptions } from '../Message.js';
import { utils } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';

/**
 * DarkSend queue message.
 */
export class DSQueueMessage extends Message {
  nonce: Uint8Array | undefined;

  constructor(_arg: undefined, options: MessageOptions) {
    super({ ...options, command: 'dsq' });
  }

  setPayload(payload: Uint8Array): void {
    const parser = new BufferReader(payload);
    this.nonce = parser.read(8);
  }

  getPayload(): Uint8Array {
    return this.nonce ?? utils.getNonce();
  }
}
