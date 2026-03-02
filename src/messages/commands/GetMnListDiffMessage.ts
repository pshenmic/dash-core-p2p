import { Message, MessageOptions } from '../Message.js';
import { hexToBytes, bytesToHex } from '../../utils/binary.js';

import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';

export interface GetMnListDiffArgs {
  baseBlockHash?: string;
  blockHash?: string;
}

/**
 * Request a masternode list difference from a peer.
 */
export class GetMnListDiffMessage extends Message {
  baseBlockHash: string | undefined;
  blockHash: string | undefined;

  constructor(args: GetMnListDiffArgs | undefined, options: MessageOptions) {
    super({ ...options, command: 'getmnlistdiff' });
    const a = args ?? {};
    this.baseBlockHash = a.baseBlockHash;
    this.blockHash = a.blockHash;
  }

  setPayload(payload: Uint8Array): void {
    const parser = new BufferReader(payload);
    if (parser.finished()) {
      throw new Error('No data received in payload');
    }
    this.baseBlockHash = bytesToHex(parser.read(32));
    this.blockHash = bytesToHex(parser.read(32));
  }

  getPayload(): Uint8Array {
    const bw = new BufferWriter();
    bw.write(hexToBytes(this.baseBlockHash ?? '0'.repeat(64)));
    bw.write(hexToBytes(this.blockHash ?? '0'.repeat(64)));
    return bw.concat();
  }
}
