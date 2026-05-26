import { Message, MessageOptions } from '../Message.js';
export interface GetBlocksArgs {
    starts?: Array<Uint8Array | string>;
    stop?: Uint8Array | string;
}
/**
 * Query a peer for blocks starting from one or more hashes.
 */
export declare class GetBlocksMessage extends Message {
    version: number;
    starts: Uint8Array[];
    stop: Uint8Array;
    constructor(arg: GetBlocksArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
