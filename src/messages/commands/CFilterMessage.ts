import { Message, MessageOptions } from '../Message.js';
import { utils } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';

export interface CFilterArgs {
  filterType?: number;
  blockHash?: Uint8Array;
  filter?: Uint8Array;
}

/**
 * BIP 157 `cfilter`: a single compact filter for one block.
 * `blockHash` is in wire byte order. `filter` is the raw GCS payload.
 */
export class CFilterMessage extends Message {
  filterType: number;
  blockHash: Uint8Array;
  filter: Uint8Array;

  constructor(arg: CFilterArgs | undefined, options: MessageOptions) {
    super({ ...options, command: 'cfilter' });
    const a = arg ?? {};
    this.filterType = a.filterType ?? 0;
    this.blockHash = a.blockHash ?? new Uint8Array(32);
    this.filter = a.filter ?? new Uint8Array(0);
  }

  setPayload(payload: Uint8Array): void {
    const parser = new BufferReader(payload);
    this.filterType = parser.readUInt8();
    this.blockHash = parser.read(32).slice();
    const len = parser.readVarintNum();
    this.filter = parser.read(len).slice();
    utils.checkFinished(parser);
  }

  getPayload(): Uint8Array {
    if (this.blockHash.length !== 32) throw new Error('blockHash must be 32 bytes');
    const bw = new BufferWriter();
    bw.writeUInt8(this.filterType);
    bw.write(this.blockHash);
    bw.writeVarintNum(this.filter.length);
    bw.write(this.filter);
    return bw.concat();
  }
}