import { Message, MessageOptions } from '../Message.js';

/**
 * Request a list of known peers from the connected peer.
 */
export class GetAddrMessage extends Message {
  constructor(_arg: undefined, options: MessageOptions) {
    super({ ...options, command: 'getaddr' });
  }

  getPayload(): Uint8Array {
    return new Uint8Array(0);
  }
}
