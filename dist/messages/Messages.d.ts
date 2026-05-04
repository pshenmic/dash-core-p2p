import { type Network } from '../Network.js';
import { builder, type BuilderOptions } from './Builder.js';
import { Message } from './Message.js';
/**
 * A factory to build Dash protocol messages and parse incoming data.
 */
export declare class Messages {
    static readonly MINIMUM_LENGTH = 20;
    static readonly PAYLOAD_START = 16;
    static readonly Message: typeof Message;
    static readonly builder: typeof builder;
    private builderInstance;
    network: Network | null;
    [key: string]: unknown;
    constructor(options?: BuilderOptions);
    /**
     * Parse the next message from a Uint8Array buffer.
     * Returns `{ message, consumed }` where `consumed` is how many bytes to advance,
     * or `undefined` if more data is needed.
     * `message` may be absent if bytes were consumed but produced no message
     * (e.g. garbage before magic, bad checksum, or unsupported command).
     */
    parseBytes(buffer: Uint8Array): {
        message?: Message;
        consumed: number;
    } | undefined;
    private _buildFromBytes;
    add(key: string, name: string, Command: new (arg: unknown, options: object) => Message): void;
}
