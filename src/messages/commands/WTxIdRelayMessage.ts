import { Message, MessageOptions } from '../Message.js';

/**
 * Witness-txid relay negotiation (BIP 339), command `wtxidrelay`.
 *
 * Sent between `version` and `verack` to negotiate relaying transactions by
 * wtxid. Carries no payload. We don't act on it, but it must be parsed rather
 * than rejected so it doesn't break the connection / broadcast flow.
 */
export class WTxIdRelayMessage extends Message {
  constructor(_arg: undefined, options: MessageOptions) {
    super({ ...options, command: 'wtxidrelay' });
  }

  getPayload(): Uint8Array {
    return new Uint8Array(0);
  }
}