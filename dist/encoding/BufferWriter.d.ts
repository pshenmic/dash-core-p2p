export declare class BufferWriter {
    private bufs;
    constructor();
    write(buf: Uint8Array): this;
    concat(): Uint8Array;
    writeUInt8(n: number): this;
    writeUInt16LE(n: number): this;
    writeUInt16BE(n: number): this;
    writeUInt32LE(n: number): this;
    writeUInt32BE(n: number): this;
    writeInt32LE(n: number): this;
    writeInt16LE(n: number): this;
    writeUInt64LE(n: bigint): this;
    writeVarintNum(n: number): this;
}
