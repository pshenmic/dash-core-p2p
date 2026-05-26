import { Message, MessageOptions } from '../Message.js';
import { type PeerAddr } from '../utils.js';
export interface VersionMessageArgs {
    version?: number;
    nonce?: Uint8Array;
    services?: bigint;
    timestamp?: Date;
    subversion?: string;
    startHeight?: number;
    relay?: boolean;
    mnAuthChallenge?: string | null;
    addrMe?: PeerAddr;
    addrYou?: PeerAddr;
}
/**
 * The version message is used on connection creation to advertise the type of node.
 */
export declare class VersionMessage extends Message {
    version: number;
    nonce: Uint8Array;
    services: bigint;
    timestamp: Date;
    subversion: string;
    startHeight: number;
    relay: boolean;
    mnAuthChallenge: string | null;
    addrMe?: PeerAddr;
    addrYou?: PeerAddr;
    constructor(arg: VersionMessageArgs | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
