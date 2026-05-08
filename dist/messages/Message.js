import { strToBytes } from '../utils/binary.js';
import { BufferWriter } from '../encoding/BufferWriter.js';
import { utils as sdkUtils } from 'dash-core-sdk';
const { doubleSHA256 } = sdkUtils;
/**
 * Base class for all Dash network protocol messages.
 */
export class Message {
    command;
    network;
    constructor(options) {
        this.command = options.command ?? '';
        this.network = options.network;
    }
    /**
     * Serialize the message to a Uint8Array, including the network envelope.
     */
    toBytes() {
        if (this.network == null) {
            throw new Error('Need to have a defined network to serialize message');
        }
        const commandBuf = new Uint8Array(12);
        commandBuf.set(strToBytes(this.command).subarray(0, 12));
        const payload = this.getPayload();
        const checksum = (doubleSHA256(payload)).subarray(0, 4);
        const bw = new BufferWriter();
        bw.write(this.network.networkMagic);
        bw.write(commandBuf);
        bw.writeUInt32LE(payload.length);
        bw.write(checksum);
        bw.write(payload);
        return bw.concat();
    }
    serialize = this.toBytes;
    /**
     * Override in subclasses to provide the message payload.
     */
    getPayload() {
        return new Uint8Array(0);
    }
    /**
     * Override in subclasses to parse the message payload.
     */
    setPayload(_payload) {
        // default: no-op
    }
}
//# sourceMappingURL=Message.js.map