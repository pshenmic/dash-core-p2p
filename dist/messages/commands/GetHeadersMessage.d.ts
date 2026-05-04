import { Message, MessageOptions } from '../Message.js';
import type { GetBlocksArgs } from './GetBlocksMessage.js';
/**
 * Query a peer for block headers starting from one or more hashes.
 */
export declare class GetHeadersMessage extends Message {
    version: number;
    starts: Uint8Array[];
    stop: Uint8Array;
    constructor(arg: GetBlocksArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
