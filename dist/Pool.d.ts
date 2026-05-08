import EventEmitter from 'eventemitter3';
import { Peer, type TCPSocket } from './Peer.js';
import { Messages } from './messages/Messages.js';
import { type Network } from './Network.js';
import type { Message } from './messages/Message.js';
export interface AddrInfo {
    ip: {
        v4?: string;
        v6?: string;
    };
    port?: number;
    hash?: string;
    retryTime?: number;
    time?: Date;
}
export interface PoolOptions {
    network?: string | Network;
    listenAddr?: boolean;
    dnsSeed?: boolean;
    relay?: boolean;
    maxSize?: number;
    messages?: Messages;
    addrs?: AddrInfo[];
}
/**
 * A pool of peer connections to the Dash P2P network.
 * Manages multiple peer connections, DNS seed discovery, and automatic reconnection.
 *
 * @example
 * ```typescript
 * const pool = new Pool({ network: 'livenet' });
 * pool.on('peerinv', (peer, message) => {
 *   // handle inventory announcement
 * });
 * pool.connect();
 * ```
 */
export declare class Pool extends EventEmitter {
    static readonly MaxConnectedPeers = 8;
    static readonly RetrySeconds = 30;
    static readonly PeerEvents: string[];
    keepalive: boolean;
    listenAddr: boolean;
    dnsSeed: boolean;
    maxSize: number;
    messages: Messages | undefined;
    network: Network | null;
    relay: boolean;
    _connectedPeers: Record<string, Peer>;
    _addrs: AddrInfo[];
    private server;
    constructor(options?: PoolOptions);
    /**
     * Start connecting to peers. Uses DNS seeds if enabled.
     */
    connect(): this;
    /**
     * Disconnect all peers.
     */
    disconnect(): this;
    /**
     * Returns the number of currently connected peers.
     */
    numberConnected(): number;
    _fillConnections(): void;
    private _removeConnectedPeer;
    private _connectPeer;
    /**
     * Add a peer from an established socket connection.
     */
    _addConnectedPeer(socket: TCPSocket, addr: AddrInfo): void;
    private _addPeerEventHandlers;
    private _deprioritizeAddr;
    _addAddr(addr: AddrInfo): AddrInfo;
    private _addAddrsFromSeed;
    private _addAddrsFromSeeds;
    inspect(): string;
    /**
     * Broadcast a message to all connected peers.
     */
    sendMessage(message: Message): void;
    /**
     * Listen for incoming peer connections on the network port.
     * Node.js only.
     */
    listen(): Promise<void>;
}
