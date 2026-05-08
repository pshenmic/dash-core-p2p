export class BufferReader {
    buf;
    pos;
    constructor(buf) {
        this.buf = buf;
        this.pos = 0;
    }
    finished() {
        return this.pos >= this.buf.length;
    }
    eof() {
        return this.finished();
    }
    read(len) {
        const result = this.buf.subarray(this.pos, this.pos + len);
        this.pos += len;
        return result;
    }
    readAll() {
        const result = this.buf.subarray(this.pos);
        this.pos = this.buf.length;
        return result;
    }
    readUInt8() {
        return this.buf[this.pos++];
    }
    readUInt16LE() {
        const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 2);
        this.pos += 2;
        return view.getUint16(0, true);
    }
    readUInt16BE() {
        const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 2);
        this.pos += 2;
        return view.getUint16(0, false);
    }
    readUInt32LE() {
        const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4);
        this.pos += 4;
        return view.getUint32(0, true);
    }
    readUInt32BE() {
        const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4);
        this.pos += 4;
        return view.getUint32(0, false);
    }
    readInt32LE() {
        const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4);
        this.pos += 4;
        return view.getInt32(0, true);
    }
    readInt16LE() {
        const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 2);
        this.pos += 2;
        return view.getInt16(0, true);
    }
    readUInt64LE() {
        const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8);
        this.pos += 8;
        return view.getBigUint64(0, true);
    }
    readVarintNum() {
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
    readVarLengthBuffer() {
        const len = this.readVarintNum();
        return this.read(len);
    }
}
//# sourceMappingURL=BufferReader.js.map