export declare class BufferReader {
    private buf;
    pos: number;
    constructor(buf: Uint8Array);
    finished(): boolean;
    eof(): boolean;
    read(len: number): Uint8Array;
    readAll(): Uint8Array;
    readUInt8(): number;
    readUInt16LE(): number;
    readUInt16BE(): number;
    readUInt32LE(): number;
    readUInt32BE(): number;
    readInt32LE(): number;
    readInt16LE(): number;
    readUInt64LE(): bigint;
    readVarintNum(): number;
    readVarLengthBuffer(): Uint8Array;
}
