import { hexToBytes, reverseBytes } from './utils/binary.js';
import { BufferReader } from './encoding/BufferReader.js';
import { BufferWriter } from './encoding/BufferWriter.js';
export const InventoryType = {
    ERROR: 0,
    TX: 1,
    BLOCK: 2,
    FILTERED_BLOCK: 3,
    DSTX: 16,
    CLSIG: 29,
    ISLOCK: 30,
    ISDLOCK: 31,
};
export const InventoryTypeName = ['ERROR', 'TX', 'BLOCK', 'FILTERED_BLOCK'];
export class Inventory {
    type;
    hash;
    constructor(obj) {
        this.type = obj.type;
        if (!(obj.hash instanceof Uint8Array)) {
            throw new TypeError('Unexpected hash, expected to be a Uint8Array');
        }
        this.hash = obj.hash;
    }
    static forItem(type, hash) {
        if (hash == null) {
            throw new Error('Hash is required');
        }
        let hashBuf;
        if (typeof hash === 'string') {
            hashBuf = reverseBytes(hexToBytes(hash));
        }
        else {
            hashBuf = hash;
        }
        return new Inventory({ type, hash: hashBuf });
    }
    static forBlock(hash) {
        return Inventory.forItem(InventoryType.BLOCK, hash);
    }
    static forFilteredBlock(hash) {
        return Inventory.forItem(InventoryType.FILTERED_BLOCK, hash);
    }
    static forTransaction(hash) {
        return Inventory.forItem(InventoryType.TX, hash);
    }
    static forISLock(hash) {
        return Inventory.forItem(InventoryType.ISLOCK, hash);
    }
    static forCLSig(hash) {
        return Inventory.forItem(InventoryType.CLSIG, hash);
    }
    toBytes() {
        const bw = new BufferWriter();
        bw.writeUInt32LE(this.type);
        bw.write(this.hash);
        return bw.concat();
    }
    toBufferWriter(bw) {
        bw.writeUInt32LE(this.type);
        bw.write(this.hash);
        return bw;
    }
    static fromBytes(payload) {
        const parser = new BufferReader(payload);
        return Inventory.fromBufferReader(parser);
    }
    static fromBufferReader(br) {
        const type = br.readUInt32LE();
        const hash = br.read(32);
        return new Inventory({ type, hash });
    }
    static TYPE = InventoryType;
    static TYPE_NAME = InventoryTypeName;
}
//# sourceMappingURL=Inventory.js.map