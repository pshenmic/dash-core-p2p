import { BufferReader } from './encoding/BufferReader.js';
import { BufferWriter } from './encoding/BufferWriter.js';
export interface InventoryObject {
    type: number;
    hash: Uint8Array;
}
export declare const InventoryType: {
    readonly ERROR: 0;
    readonly TX: 1;
    readonly BLOCK: 2;
    readonly FILTERED_BLOCK: 3;
    readonly DSTX: 16;
    readonly CLSIG: 29;
    readonly ISLOCK: 30;
    readonly ISDLOCK: 31;
};
export declare const InventoryTypeName: string[];
export declare class Inventory {
    type: number;
    hash: Uint8Array;
    constructor(obj: InventoryObject);
    static forItem(type: number, hash: Uint8Array | string): Inventory;
    static forBlock(hash: Uint8Array | string): Inventory;
    static forFilteredBlock(hash: Uint8Array | string): Inventory;
    static forTransaction(hash: Uint8Array | string): Inventory;
    static forISLock(hash: Uint8Array | string): Inventory;
    static forCLSig(hash: Uint8Array | string): Inventory;
    toBytes(): Uint8Array;
    toBufferWriter(bw: BufferWriter): BufferWriter;
    static fromBytes(payload: Uint8Array): Inventory;
    static fromBufferReader(br: BufferReader): Inventory;
    static TYPE: {
        readonly ERROR: 0;
        readonly TX: 1;
        readonly BLOCK: 2;
        readonly FILTERED_BLOCK: 3;
        readonly DSTX: 16;
        readonly CLSIG: 29;
        readonly ISLOCK: 30;
        readonly ISDLOCK: 31;
    };
    static TYPE_NAME: string[];
}
