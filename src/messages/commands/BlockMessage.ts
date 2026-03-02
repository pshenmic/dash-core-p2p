import { Message, MessageOptions } from '../Message.js';
import { Block } from "dash-core-sdk";

/**
 * Block message for broadcasting blocks to the network.
 */
export class BlockMessage extends Message {
  block: Block | undefined;

  constructor(arg: Block | undefined, options: MessageOptions & Block) {
    super({ ...options, command: 'block' });

    if (arg != null && !(arg instanceof Block)) {
      throw new Error('An instance of MerkleBlock or undefined is expected')
    }

    this.block = arg;
  }

  setPayload(payload: Uint8Array): void {
    if (!(payload instanceof Uint8Array)) {
      throw new Error('An instance of Uint8Array is expected')
    }

    this.block = Block.fromBytes(payload);
  }

  getPayload(): Uint8Array {
    return this.block ? (this.block.bytes()) : new Uint8Array(0);
  }
}
