import { Message, MessageOptions } from '../Message.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';

export interface FeeFilterArgs {
  feeRate?: bigint;
}

/**
 * Fee filter message (BIP 133), command `feefilter`.
 *
 * A peer advertises the minimum fee rate (in duffs per 1000 bytes) it will
 * accept for relayed transactions; txs below this rate won't be relayed to or
 * accepted by that peer. Peers send this after the handshake, so it must be
 * parsed rather than rejected — otherwise it breaks the receive/broadcast flow.
 *
 * Wire format:
 *   feeRate  8 bytes int64 LE (duffs/kB)
 */
export class FeeFilterMessage extends Message {
  feeRate: bigint;

  constructor(arg: FeeFilterArgs | undefined, options: MessageOptions) {
    super({ ...options, command: 'feefilter' });
    this.feeRate = arg?.feeRate ?? 0n;
  }

  setPayload(payload: Uint8Array): void {
    const r = new BufferReader(payload);
    this.feeRate = r.readUInt64LE();
  }

  getPayload(): Uint8Array {
    const bw = new BufferWriter();
    bw.writeUInt64LE(this.feeRate);
    return bw.concat();
  }
}