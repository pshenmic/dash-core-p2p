import { type Network } from '../Network.js';
import type { MessageOptions } from './Message.js';
import type { Message } from './Message.js';
export interface BuilderOptions {
    network?: Network;
    protocolVersion?: number;
    [key: string]: unknown;
}
export type MessageFactory<T = unknown> = {
    (arg?: T): Message;
    fromBytes(bytes: Uint8Array): Message;
    forTransaction?: (hash: Uint8Array | string) => Message;
    forBlock?: (hash: Uint8Array | string) => Message;
    forFilteredBlock?: (hash: Uint8Array | string) => Message;
};
export interface Builder {
    defaults: {
        protocolVersion: number;
        network: unknown;
    };
    inventoryCommands: string[];
    commandsMap: Record<string, string>;
    unsupportedCommands: string[];
    commands: Record<string, MessageFactory>;
    add(key: string, Command: new (arg: unknown, options: MessageOptions) => Message): void;
}
export declare function builder(options?: BuilderOptions): Builder;
