import { hexToBytes, reverseBytes } from './utils/binary.js';
import { BufferReader } from './encoding/BufferReader.js';
import { BufferWriter } from './encoding/BufferWriter.js';

export interface InventoryObject {
  type: number;
  hash: Uint8Array;
}

export const InventoryType = {
  ERROR: 0,
  TX: 1,
  BLOCK: 2,
  FILTERED_BLOCK: 3,
  DSTX: 16,
  CLSIG: 29,
  ISLOCK: 30,
  ISDLOCK: 31,
} as const;

export const InventoryTypeName: string[] = ['ERROR', 'TX', 'BLOCK', 'FILTERED_BLOCK'];

export class Inventory {
  type: number;
  hash: Uint8Array;

  constructor(obj: InventoryObject) {
    this.type = obj.type;
    if (!(obj.hash instanceof Uint8Array)) {
      throw new TypeError('Unexpected hash, expected to be a Uint8Array');
    }
    this.hash = obj.hash;
  }

  static forItem(type: number, hash: Uint8Array | string): Inventory {
    if (hash == null) {
      throw new Error('Hash is required')
    }

    let hashBuf: Uint8Array;
    if (typeof hash === 'string') {
      hashBuf = reverseBytes(hexToBytes(hash as string));
    } else {
      hashBuf = hash as Uint8Array;
    }
    return new Inventory({ type, hash: hashBuf });
  }

  static forBlock(hash: Uint8Array | string): Inventory {
    return Inventory.forItem(InventoryType.BLOCK, hash);
  }

  static forFilteredBlock(hash: Uint8Array | string): Inventory {
    return Inventory.forItem(InventoryType.FILTERED_BLOCK, hash);
  }

  static forTransaction(hash: Uint8Array | string): Inventory {
    return Inventory.forItem(InventoryType.TX, hash);
  }

  static forISLock(hash: Uint8Array | string): Inventory {
    return Inventory.forItem(InventoryType.ISLOCK, hash);
  }

  static forCLSig(hash: Uint8Array | string): Inventory {
    return Inventory.forItem(InventoryType.CLSIG, hash);
  }

  toBytes(): Uint8Array {
    const bw = new BufferWriter();
    bw.writeUInt32LE(this.type);
    bw.write(this.hash);
    return bw.concat();
  }

  toBufferWriter(bw: BufferWriter): BufferWriter {
    bw.writeUInt32LE(this.type);
    bw.write(this.hash);
    return bw;
  }

  static fromBytes(payload: Uint8Array): Inventory {
    const parser = new BufferReader(payload);
    return Inventory.fromBufferReader(parser);
  }

  static fromBufferReader(br: BufferReader): Inventory {
    const type = br.readUInt32LE();
    const hash = br.read(32);
    return new Inventory({ type, hash });
  }

  static TYPE = InventoryType;
  static TYPE_NAME = InventoryTypeName;
}
