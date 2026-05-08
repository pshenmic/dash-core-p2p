import { Message, MessageOptions } from '../Message.js';
import { Block } from "dash-core-sdk";
/**
 * Block message for broadcasting blocks to the network.
 */
export declare class BlockMessage extends Message {
    block: Block | undefined;
    constructor(arg: Block | undefined, options: MessageOptions & Block);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
