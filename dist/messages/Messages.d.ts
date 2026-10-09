import { type Network } from '../Network.js';
import { builder, type BuilderOptions } from './Builder.js';
import { Message } from './Message.js';
/**
 * A complete, checksum-valid message whose payload could not be decoded
 * (unknown command or a parser error). The message has already been consumed.
 */
export declare class MessageParseError extends Error {
    command: string;
    payload: Uint8Array;
    cause: unknown;
    constructor(command: string, payload: Uint8Array, cause: unknown);
}
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
     * If the message is complete but its payload can't be decoded, `error` is set
     * and the message is skipped; this method does not throw on bad payloads.
     */
    parseBytes(buffer: Uint8Array): {
        message?: Message;
        error?: MessageParseError;
        consumed: number;
    } | undefined;
    private _buildFromBytes;
    add(key: string, name: string, Command: new (arg: unknown, options: object) => Message): void;
}
