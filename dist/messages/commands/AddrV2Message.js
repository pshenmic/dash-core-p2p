import { Message } from '../Message.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
export const NetworkID = {
    IPV4: 0x01,
    IPV6: 0x02,
    TORV2: 0x03,
    TORV3: 0x04,
    I2P: 0x05,
    CJDNS: 0x06,
    YGGDRASIL: 0x07,
};
const ADDR_LENGTHS = {
    [NetworkID.IPV4]: 4,
    [NetworkID.IPV6]: 16,
    [NetworkID.TORV2]: 10,
    [NetworkID.TORV3]: 32,
    [NetworkID.I2P]: 32,
    [NetworkID.CJDNS]: 16,
    [NetworkID.YGGDRASIL]: 16,
};
/**
 * Extended address message supporting Tor v3, I2P, CJDNS and other network types (BIP155).
 */
export class AddrV2Message extends Message {
    addresses;
    constructor(arg, options) {
        super({ ...options, command: 'addrv2' });
        this.addresses = arg;
    }
    setPayload(payload) {
        const parser = new BufferReader(payload);
        const count = parser.readVarintNum();
        if (count > 1000) {
            throw new Error('addrv2: too many entries: ' + count);
        }
        this.addresses = [];
        for (let i = 0; i < count; i++) {
            const time = new Date(parser.readUInt32LE() * 1000);
            const services = BigInt(parser.readVarintNum());
            const networkID = parser.readUInt8();
            const addr = parser.readVarLengthBuffer();
            const port = parser.readUInt16BE();
            const expectedLen = ADDR_LENGTHS[networkID];
            if (expectedLen !== undefined && addr.length !== expectedLen) {
                throw new Error(`addrv2: networkID 0x${networkID.toString(16)} addr length ${addr.length} != expected ${expectedLen}`);
            }
            this.addresses.push({ time, services, networkID, addr, port });
        }
    }
    getPayload() {
        const bw = new BufferWriter();
        const addresses = this.addresses ?? [];
        bw.writeVarintNum(addresses.length);
        for (const entry of addresses) {
            bw.writeUInt32LE(Math.floor(entry.time.getTime() / 1000));
            bw.writeVarintNum(Number(entry.services));
            bw.writeUInt8(entry.networkID);
            bw.writeVarintNum(entry.addr.length);
            bw.write(entry.addr);
            bw.writeUInt16BE(entry.port);
        }
        return bw.concat();
    }
}
//# sourceMappingURL=AddrV2Message.js.map