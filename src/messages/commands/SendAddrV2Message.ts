import { Message, MessageOptions } from '../Message.js';

/**
 * Signals support for the addrv2 message format (BIP155).
 * Sent after version and before verack. No payload.
 */
export class SendAddrV2Message extends Message {
  constructor(_arg: undefined, options: MessageOptions) {
    super({ ...options, command: 'sendaddrv2' });
  }

  getPayload(): Uint8Array {
    return new Uint8Array(0);
  }
}
