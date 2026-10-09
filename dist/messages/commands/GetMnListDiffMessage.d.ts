import { Message, MessageOptions } from '../Message.js';
export interface GetMnListDiffArgs {
    baseBlockHash?: string;
    blockHash?: string;
}
/**
 * Request a masternode list difference from a peer.
 *
 * Wire command is `getmnlistd` (Dash Core NetMsgType::GETMNLISTDIFF).
 * Hashes are kept in display order and reversed to wire order on serialization,
 * matching the convention used by MnListDiff.
 */
export declare class GetMnListDiffMessage extends Message {
    baseBlockHash: string | undefined;
    blockHash: string | undefined;
    constructor(args: GetMnListDiffArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
