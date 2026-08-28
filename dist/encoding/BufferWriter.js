export class BufferWriter {
    bufs;
    constructor() {
        this.bufs = [];
    }
    write(buf) {
        this.bufs.push(buf);
        return this;
    }
    concat() {
        const total = this.bufs.reduce((sum, b) => sum + b.length, 0);
        const result = new Uint8Array(total);
        let offset = 0;
        for (const buf of this.bufs) {
            result.set(buf, offset);
            offset += buf.length;
        }
        return result;
    }
    writeUInt8(n) {
        const buf = new Uint8Array(1);
        buf[0] = n;
        return this.write(buf);
    }
    writeUInt16LE(n) {
        const buf = new Uint8Array(2);
        new DataView(buf.buffer).setUint16(0, n, true);
        return this.write(buf);
    }
    writeUInt16BE(n) {
        const buf = new Uint8Array(2);
        new DataView(buf.buffer).setUint16(0, n, false);
        return this.write(buf);
    }
    writeUInt32LE(n) {
        const buf = new Uint8Array(4);
        new DataView(buf.buffer).setUint32(0, n, true);
        return this.write(buf);
    }
    writeUInt32BE(n) {
        const buf = new Uint8Array(4);
        new DataView(buf.buffer).setUint32(0, n, false);
        return this.write(buf);
    }
    writeInt32LE(n) {
        const buf = new Uint8Array(4);
        new DataView(buf.buffer).setInt32(0, n, true);
        return this.write(buf);
    }
    writeInt16LE(n) {
        const buf = new Uint8Array(2);
        new DataView(buf.buffer).setInt16(0, n, true);
        return this.write(buf);
    }
    writeUInt64LE(n) {
        const buf = new Uint8Array(8);
        new DataView(buf.buffer).setBigUint64(0, n, true);
        return this.write(buf);
    }
    writeVarintNum(n) {
        if (n < 0xfd) {
            return this.writeUInt8(n);
        }
        else if (n < 0x10000) {
            const buf = new Uint8Array(3);
            const dv = new DataView(buf.buffer);
            dv.setUint8(0, 0xfd);
            dv.setUint16(1, n, true);
            return this.write(buf);
        }
        else if (n < 0x100000000) {
            const buf = new Uint8Array(5);
            const dv = new DataView(buf.buffer);
            dv.setUint8(0, 0xfe);
            dv.setUint32(1, n, true);
            return this.write(buf);
        }
        else {
            const buf = new Uint8Array(9);
            const dv = new DataView(buf.buffer);
            dv.setUint8(0, 0xff);
            dv.setUint32(1, n >>> 0, true);
            dv.setUint32(5, Math.floor(n / 0x100000000), true);
            return this.write(buf);
        }
    }
}
//# sourceMappingURL=BufferWriter.js.map