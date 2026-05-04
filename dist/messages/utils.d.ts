import { BufferReader } from '../encoding/BufferReader.js';
import { BufferWriter } from '../encoding/BufferWriter.js';
import { InventoryItem } from './commands/InvMessage.js';
export interface IPAddress {
    v4: string;
    v6: string;
}
export interface PeerAddr {
    services: bigint;
    ip: IPAddress;
    port: number;
    time?: Date;
}
declare function getRandomBytes(n: number): Uint8Array;
declare function writeIP(ip: IPAddress, bw: BufferWriter): void;
declare function writeAddr(addr: PeerAddr | undefined, bw: BufferWriter): void;
declare function writeInventory(inventory: Array<{
    type: number;
    hash: Uint8Array;
}>, bw: BufferWriter): void;
declare function parseIP(parser: BufferReader): IPAddress;
declare function parseAddr(parser: BufferReader): PeerAddr;
declare function checkInventory(arg: InventoryItem[]): void;
declare function checkFinished(parser: BufferReader): void;
declare function getNonce(): Uint8Array;
declare function sanitizeStartStop(obj: {
    starts?: Array<Uint8Array | string>;
    stop?: Uint8Array | string;
}): {
    starts: Uint8Array[];
    stop: Uint8Array;
};
export declare const utils: {
    getRandomBytes: typeof getRandomBytes;
    checkInventory: typeof checkInventory;
    checkFinished: typeof checkFinished;
    getNonce: typeof getNonce;
    writeIP: typeof writeIP;
    writeAddr: typeof writeAddr;
    writeInventory: typeof writeInventory;
    parseIP: typeof parseIP;
    parseAddr: typeof parseAddr;
    sanitizeStartStop: typeof sanitizeStartStop;
};
export {};
