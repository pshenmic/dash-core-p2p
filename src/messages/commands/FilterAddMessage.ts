import { Message, MessageOptions } from '../Message.js';

import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';

/**
 * Add data to an existing bloom filter on a peer.
 */
export class FilterAddMessage extends Message {
  data: Uint8Array | undefined;

  constructor(arg: Uint8Array | undefined, options: MessageOptions) {
    super({ ...options, command: 'filteradd' });
    if(arg != null && !(arg instanceof Uint8Array)) {
      throw new Error('First argument is expected to be a Uint8Array or undefined')
    }

    this.data = arg;
  }

  setPayload(payload: Uint8Array): void {
    const parser = new BufferReader(payload);
    this.data = parser.readVarLengthBuffer();
  }

  getPayload(): Uint8Array {
    const bw = new BufferWriter();
    const d = this.data ?? new Uint8Array(0);
    bw.writeVarintNum(d.length);
    bw.write(d);
    return bw.concat();
  }
}
