import { Message } from '../Message.js';
import { Block } from "dash-core-sdk";
/**
 * Block message for broadcasting blocks to the network.
 */
export class BlockMessage extends Message {
    block;
    constructor(arg, options) {
        super({ ...options, command: 'block' });
        if (arg != null && !(arg instanceof Block)) {
            throw new Error('An instance of MerkleBlock or undefined is expected');
        }
        this.block = arg;
    }
    setPayload(payload) {
        if (!(payload instanceof Uint8Array)) {
            throw new Error('An instance of Uint8Array is expected');
        }
        this.block = Block.fromBytes(payload);
    }
    getPayload() {
        return this.block ? (this.block.bytes()) : new Uint8Array(0);
    }
}
//# sourceMappingURL=BlockMessage.js.map