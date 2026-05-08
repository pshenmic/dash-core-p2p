import EventEmitter from 'eventemitter3';
import { Messages } from './messages/Messages.js';
import { type Network } from './Network.js';
import type { Message } from './messages/Message.js';
/**
 * Cross-platform TCP socket interface.
 * In Node.js, this is backed by `net.Socket`.
 * In other environments, a compatible socket must be provided via options.
 */
export interface TCPSocket extends EventEmitter {
    remoteAddress?: string;
    remotePort?: number;
    connect(port: number, host: string): void;
    write(data: Uint8Array): void;
    destroy(): void;
}
export type SocketFactory = () => TCPSocket;
export interface PeerOptions {
    host?: string;
    port?: number;
    network?: string | Network;
    relay?: boolean;
    messages?: Messages;
    socket?: TCPSocket;
    socketFactory?: SocketFactory;
}
export declare const PeerStatus: {
    readonly DISCONNECTED: "disconnected";
    readonly CONNECTING: "connecting";
    readonly CONNECTED: "connected";
    readonly READY: "ready";
};
export type PeerStatusType = (typeof PeerStatus)[keyof typeof PeerStatus];
/**
 * Represents a single connection to a Dash P2P network peer.
 *
 * @example
 * ```typescript
 * const peer = new Peer({ host: '127.0.0.1' });
 * peer.on('tx', (tx) => console.log('New transaction:', tx));
 * await peer.connect();
 * ```
 */
export declare class Peer extends EventEmitter {
    static readonly MAX_RECEIVE_BUFFER = 10000000;
    static readonly STATUS: {
        readonly DISCONNECTED: "disconnected";
        readonly CONNECTING: "connecting";
        readonly CONNECTED: "connected";
        readonly READY: "ready";
    };
    host: string;
    port: number;
    network: Network | null;
    status: PeerStatusType;
    messages: Messages;
    dataBuffer: Uint8Array;
    version: number;
    bestHeight: number;
    subversion: string | null;
    relay: boolean;
    versionSent: boolean;
    socket: TCPSocket | null;
    protected socketFactory: SocketFactory | null;
    constructor(options: PeerOptions);
    /**
     * Set a SOCKS5 proxy for the connection.
     * Provide a custom socketFactory that handles SOCKS5 connections.
     * Example: use the `socks` npm package to create a SOCKS5-capable factory.
     */
    setProxy(_host: string, _port: number): this;
    /**
     * Connect to the peer.
     */
    connect(): Promise<this>;
    private _addSocketEventHandlers;
    private _onError;
    /**
     * Disconnect from the peer.
     */
    disconnect(): this;
    /**
     * Send a message to the peer.
     */
    sendMessage(message: Message): void;
    private _sendVersion;
    private _sendPong;
    private _readMessage;
    _getSocket(): Promise<TCPSocket>;
}
