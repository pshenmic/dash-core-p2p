import { Message, MessageOptions } from '../Message.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
import { bytesToHex, hexToBytes } from '../../utils/binary.js';

export interface CLSigArgs {
  height?: number;
  blockHash?: string;
  sig?: Uint8Array;
}

/**
 * ChainLock signature message (DIP8).
 * Received when a quorum has signed a block hash, making it irreversibly final.
 *
 * Wire format:
 *   height     4 bytes uint32 LE
 *   blockHash  32 bytes LE
 *   sig        96 bytes BLS signature
 */
export class CLSigMessage extends Message {
  height: number;
  blockHash: string;
  sig: Uint8Array;

  constructor(arg: CLSigArgs | undefined, options: MessageOptions) {
    super({ ...options, command: 'clsig' });
    const a = arg ?? {};
    this.height = a.height ?? 0;
    this.blockHash = a.blockHash ?? '00'.repeat(32);
    this.sig = a.sig ?? new Uint8Array(96);
  }

  setPayload(payload: Uint8Array): void {
    const r = new BufferReader(payload);
    this.height = r.readUInt32LE();
    this.blockHash = bytesToHex(r.read(32));
    this.sig = r.read(96);
  }

  getPayload(): Uint8Array {
    const bw = new BufferWriter();
    bw.writeUInt32LE(this.height);
    bw.write(hexToBytes(this.blockHash));
    bw.write(this.sig);
    return bw.concat();
  }
}