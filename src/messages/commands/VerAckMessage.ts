import { Message, MessageOptions } from '../Message.js';

/**
 * Version acknowledgment - sent in response to a version message.
 */
export class VerAckMessage extends Message {
  constructor(_arg: undefined, options: MessageOptions) {
    super({ ...options, command: 'verack' });
  }

  getPayload(): Uint8Array {
    return new Uint8Array(0);
  }
}
