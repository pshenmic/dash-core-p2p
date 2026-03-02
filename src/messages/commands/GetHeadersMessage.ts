import { Message, MessageOptions } from '../Message.js';
import { utils } from '../utils.js';
import type { GetBlocksArgs } from './GetBlocksMessage.js';

import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';


/**
 * Query a peer for block headers starting from one or more hashes.
 */
export class GetHeadersMessage extends Message {
  version: number;
  starts: Uint8Array[];
  stop: Uint8Array;

  constructor(arg: GetBlocksArgs | undefined, options: MessageOptions) {
    super({ ...options, command: 'getheaders' });
    this.version = options.protocolVersion as number;
    const sanitized = utils.sanitizeStartStop(arg ?? {});
    this.starts = sanitized.starts;
    this.stop = sanitized.stop;
  }

  setPayload(payload: Uint8Array): void {
    const parser = new BufferReader(payload);
    if (parser.finished()) {
      throw new Error('No data received in payload');
    }

    this.version = parser.readUInt32LE();
    const startCount = Math.min(parser.readVarintNum(), 500);
    this.starts = [];

    for (let i = 0; i < startCount; i++) {
      this.starts.push(parser.read(32));
    }

    this.stop = parser.read(32);
    utils.checkFinished(parser);
  }

  getPayload(): Uint8Array {
    const bw = new BufferWriter();
    bw.writeUInt32LE(this.version);
    bw.writeVarintNum(this.starts.length);

    for (const start of this.starts) {
      bw.write(start);
    }

    if (this.stop.length !== 32) {
      throw new Error('Invalid hash length: ' + this.stop.length);
    }
    bw.write(this.stop);
    return bw.concat();
  }
}
