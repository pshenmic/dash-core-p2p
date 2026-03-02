import { MerkleBlock } from "dash-core-sdk";
import { Message, MessageOptions } from '../Message.js';

/**
 * Contains information about a filtered block (Merkle block).
 */
export class MerkleBlockMessage extends Message {
  merkleBlock: MerkleBlock;

  constructor(arg: MerkleBlock, options: MessageOptions & MerkleBlock) {
    super({ ...options, command: 'merkleblock' });

    if (arg != null && !(arg instanceof MerkleBlock)) {
      throw new Error('An instance of MerkleBlock or undefined is expected')
    }

    this.merkleBlock = arg;
  }

  setPayload(payload: Uint8Array): void {
    if (!(payload instanceof Uint8Array)) {
      throw new Error('An instance of Uint8Array is expected')
    }

    this.merkleBlock = MerkleBlock.fromBytes(payload);
  }

  getPayload(): Uint8Array {
    return this.merkleBlock ? (this.merkleBlock.bytes()) : new Uint8Array(0);
  }
}
