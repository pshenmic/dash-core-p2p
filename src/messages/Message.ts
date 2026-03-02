import type { Network } from '../Network.js';
import { strToBytes } from '../utils/binary.js';
import { BufferWriter } from '../encoding/BufferWriter.js';
import { utils as sdkUtils } from 'dash-core-sdk';

const { doubleSHA256 } = sdkUtils;

export interface MessageOptions {
  command?: string;
  network?: Network;
  protocolVersion?: number;
  [key: string]: unknown;
}

/**
 * Base class for all Dash network protocol messages.
 */
export class Message {
  command: string;
  network: Network | undefined;

  constructor(options: MessageOptions) {
    this.command = options.command ?? '';
    this.network = options.network;
  }

  /**
   * Serialize the message to a Uint8Array, including the network envelope.
   */
  toBytes(): Uint8Array {
    if (this.network == null) {
      throw new Error('Need to have a defined network to serialize message');
    }

    const commandBuf = new Uint8Array(12);
    commandBuf.set(strToBytes(this.command).subarray(0, 12));

    const payload = this.getPayload();
    const checksum = (doubleSHA256(payload)).subarray(0, 4);

    const bw = new BufferWriter();
    bw.write(this.network!.networkMagic as unknown as Uint8Array);
    bw.write(commandBuf);
    bw.writeUInt32LE(payload.length);
    bw.write(checksum);
    bw.write(payload);

    return bw.concat() as unknown as Uint8Array;
  }

  serialize = this.toBytes;

  /**
   * Override in subclasses to provide the message payload.
   */
  getPayload(): Uint8Array {
    return new Uint8Array(0);
  }

  /**
   * Override in subclasses to parse the message payload.
   */
  setPayload(_payload: Uint8Array): void {
    // default: no-op
  }
}
