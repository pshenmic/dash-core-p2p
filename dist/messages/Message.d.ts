import type { Network } from '../Network.js';
export interface MessageOptions {
    command?: string;
    network?: Network;
    protocolVersion?: number;
    [key: string]: unknown;
}
/**
 * Base class for all Dash network protocol messages.
 */
export declare class Message {
    command: string;
    network: Network | undefined;
    constructor(options: MessageOptions);
    /**
     * Serialize the message to a Uint8Array, including the network envelope.
     */
    toBytes(): Uint8Array;
    serialize: () => Uint8Array;
    /**
     * Override in subclasses to provide the message payload.
     */
    getPayload(): Uint8Array;
    /**
     * Override in subclasses to parse the message payload.
     */
    setPayload(_payload: Uint8Array): void;
}
