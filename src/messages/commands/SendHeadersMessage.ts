import { Message, MessageOptions } from '../Message.js';

/**
 * Requests the peer to announce new blocks via headers messages instead of inv (BIP130).
 * No payload. Send once after the handshake is complete.
 */
export class SendHeadersMessage extends Message {
  constructor(_arg: undefined, options: MessageOptions) {
    super({ ...options, command: 'sendheaders' });
  }

  getPayload(): Uint8Array {
    return new Uint8Array(0);
  }
}