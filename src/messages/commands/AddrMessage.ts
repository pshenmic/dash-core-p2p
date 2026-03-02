import { Message, MessageOptions } from '../Message.js';
import { utils, type PeerAddr } from '../utils.js';

import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';

export interface AddrEntry extends PeerAddr {
  time: Date;
}

/**
 * Message containing network addresses of known peers.
 */
export class AddrMessage extends Message {
  addresses: AddrEntry[] | undefined;

  constructor(arg: AddrEntry[] | undefined, options: MessageOptions) {
    super({ ...options, command: 'addr' });

    if(arg != null && (!Array.isArray(arg) || (arg[0]?.services == null) || (arg[0].ip == null) || (arg[0].port == null))) {
      throw new Error('First argument is expected to be an array of addrs')
    }

    this.addresses = arg;
  }

  setPayload(payload: Uint8Array): void {
    const parser = new BufferReader(payload);
    const addrCount = parser.readVarintNum();
    this.addresses = [];

    for (let i = 0; i < addrCount; i++) {
      const time = new Date(parser.readUInt32LE() * 1000);
      const addr = utils.parseAddr(parser) as AddrEntry;
      addr.time = time;
      this.addresses.push(addr);
    }

    utils.checkFinished(parser);
  }

  getPayload(): Uint8Array {
    const bw = new BufferWriter();
    const addresses = this.addresses ?? [];
    bw.writeVarintNum(addresses.length);

    for (const addr of addresses) {
      bw.writeUInt32LE(addr.time.getTime() / 1000);
      utils.writeAddr(addr, bw);
    }

    return bw.concat();
  }
}
