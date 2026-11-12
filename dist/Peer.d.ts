import EventEmitter from 'eventemitter3';
import { Messages } from './messages/Messages.js';
import { type Network } from './Network.js';
import type { Message } from './messages/Message.js';
import type { Transaction } from 'dash-core-sdk';
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
/** Answer to {@link Peer.queryTransaction}. */
export type TxQueryResult = {
    status: 'found';
    tx: Transaction;
} | {
    status: 'notfound';
};
export interface TxQueryOptions {
    /** Milliseconds to wait for tx/notfound before rejecting. Default 30000. */
    timeout?: number;
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
 * // Undecodable messages are dropped and reported instead of thrown:
 * peer.on('parseerror', (err) => console.warn(err.command, err.message));
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
    /**
     * Ask the peer for a transaction with getdata(MSG_TX) and report its answer:
     * `found` with the tx (from its mempool or relay cache), or `notfound`.
     * Rejects on timeout or disconnect, which mean "no answer", not "not found".
     *
     * Note that Core only serves a mempool tx it has announced to us or that is
     * older than its unconditional relay delay, so a tx the peer received very
     * recently may come back as `notfound`.
     *
     * @param txid display-order hex, as returned by `Transaction.hash()`
     */
    queryTransaction(txid: string, options?: TxQueryOptions): Promise<TxQueryResult>;
    private _sendVersion;
    private _sendPong;
    private _readMessage;
    _getSocket(): Promise<TCPSocket>;
}
