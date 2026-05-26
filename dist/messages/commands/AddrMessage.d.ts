import { Message, MessageOptions } from '../Message.js';
import { type PeerAddr } from '../utils.js';
export interface AddrEntry extends PeerAddr {
    time: Date;
}
/**
 * Message containing network addresses of known peers.
 */
export declare class AddrMessage extends Message {
    addresses: AddrEntry[] | undefined;
    constructor(arg: AddrEntry[] | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
