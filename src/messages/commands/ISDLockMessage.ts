import { Message, MessageOptions } from '../Message.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
import { bytesToHex, hexToBytes } from '../../utils/binary.js';
import type { Outpoint } from './ISLockMessage.js';

export interface ISDLockArgs {
  version?: number;
  inputs?: Outpoint[];
  txid?: string;
  cycleHash?: string;
  sig?: Uint8Array;
}

/**
 * Deterministic InstantSend lock message (DIP24), command `isdlock`.
 *
 * This supersedes the legacy DIP-10 `islock` (see {@link ISLockMessage}):
 * current Dash Core no longer emits `islock`, only `isdlock`. The wire shape
 * adds a leading `nVersion` byte and a `cycleHash` (the hash of the first
 * block in the signing quorum's DKG cycle, which deterministically selects
 * the quorum).
 *
 * Wire format (Dash Core `instantsend::InstantSendLock`):
 *   nVersion      1 byte  uint8   (CURRENT_VERSION = 1)
 *   inputs_count  varint
 *   inputs[]      36 bytes each   (txid 32 LE + vout 4 LE)
 *   txid          32 bytes LE
 *   cycleHash     32 bytes LE
 *   sig           96 bytes BLS signature
 */
export class ISDLockMessage extends Message {
  version: number;
  inputs: Outpoint[];
  txid: string;
  cycleHash: string;
  sig: Uint8Array;

  constructor(arg: ISDLockArgs | undefined, options: MessageOptions) {
    super({ ...options, command: 'isdlock' });
    const a = arg ?? {};
    this.version = a.version ?? 1;
    this.inputs = a.inputs ?? [];
    this.txid = a.txid ?? '00'.repeat(32);
    this.cycleHash = a.cycleHash ?? '00'.repeat(32);
    this.sig = a.sig ?? new Uint8Array(96);
  }

  setPayload(payload: Uint8Array): void {
    const r = new BufferReader(payload);

    this.version = r.readUInt8();

    const count = r.readVarintNum();
    this.inputs = [];
    for (let i = 0; i < count; i++) {
      const txid = bytesToHex(r.read(32));
      const vout = r.readUInt32LE();
      this.inputs.push({ txid, vout });
    }

    this.txid = bytesToHex(r.read(32));
    this.cycleHash = bytesToHex(r.read(32));
    this.sig = r.read(96);
  }

  getPayload(): Uint8Array {
    const bw = new BufferWriter();
    bw.writeUInt8(this.version);
    bw.writeVarintNum(this.inputs.length);
    for (const input of this.inputs) {
      bw.write(hexToBytes(input.txid));
      bw.writeUInt32LE(input.vout);
    }
    bw.write(hexToBytes(this.txid));
    bw.write(hexToBytes(this.cycleHash));
    bw.write(this.sig);
    return bw.concat();
  }
}