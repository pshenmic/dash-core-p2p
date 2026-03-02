export class BufferReader {
  private buf: Uint8Array;
  pos: number;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.pos = 0;
  }

  finished(): boolean {
    return this.pos >= this.buf.length;
  }

  eof(): boolean {
    return this.finished();
  }

  read(len: number): Uint8Array {
    const result = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return result;
  }

  readAll(): Uint8Array {
    const result = this.buf.subarray(this.pos);
    this.pos = this.buf.length;
    return result;
  }

  readUInt8(): number {
    return this.buf[this.pos++]!;
  }

  readUInt16LE(): number {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 2);
    this.pos += 2;
    return view.getUint16(0, true);
  }

  readUInt16BE(): number {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 2);
    this.pos += 2;
    return view.getUint16(0, false);
  }

  readUInt32LE(): number {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4);
    this.pos += 4;
    return view.getUint32(0, true);
  }

  readUInt32BE(): number {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4);
    this.pos += 4;
    return view.getUint32(0, false);
  }

  readInt32LE(): number {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4);
    this.pos += 4;
    return view.getInt32(0, true);
  }

  readInt16LE(): number {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 2);
    this.pos += 2;
    return view.getInt16(0, true);
  }

  readUInt64LE(): bigint {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8);
    this.pos += 8;
    return view.getBigUint64(0, true);
  }

  readVarintNum(): number {
    const first = this.readUInt8();
    switch (first) {
      case 0xfd:
        return this.readUInt16LE();
      case 0xfe:
        return this.readUInt32LE();
      case 0xff: {
        const val = this.readUInt64LE();
        if (val <= BigInt(Number.MAX_SAFE_INTEGER)) {
          return Number(val);
        }
        throw new Error('number too large to retain precision');
      }
      default:
        return first;
    }
  }

  readVarLengthBuffer(): Uint8Array {
    const len = this.readVarintNum();
    return this.read(len);
  }
}
