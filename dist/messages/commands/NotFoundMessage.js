import { Message } from '../Message.js';
import { utils } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
/**
 * Indicates that requested data was not found.
 */
export class NotFoundMessage extends Message {
    inventory;
    constructor(arg, options) {
        super({ ...options, command: 'notfound' });
        utils.checkInventory(arg ?? []);
        this.inventory = arg ?? [];
    }
    setPayload(payload) {
        this.inventory = [];
        const parser = new BufferReader(payload);
        const count = parser.readVarintNum();
        for (let i = 0; i < count; i++) {
            const type = parser.readUInt32LE();
            const hash = parser.read(32);
            this.inventory.push({ type, hash });
        }
        utils.checkFinished(parser);
    }
    getPayload() {
        const bw = new BufferWriter();
        utils.writeInventory(this.inventory ?? [], bw);
        return bw.concat();
    }
}
//# sourceMappingURL=NotFoundMessage.js.map