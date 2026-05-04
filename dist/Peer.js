import EventEmitter from 'eventemitter3';
import { Messages } from './messages/Messages.js';
import { Networks } from './Network.js';
export const PeerStatus = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    READY: 'ready',
};
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
export class Peer extends EventEmitter {
    static MAX_RECEIVE_BUFFER = 10_000_000;
    static STATUS = PeerStatus;
    host;
    port;
    network;
    status;
    messages;
    dataBuffer;
    version;
    bestHeight;
    subversion;
    relay;
    versionSent;
    socket = null;
    socketFactory;
    constructor(options) {
        super();
        this.network = Networks.get(options.network) ?? Networks.defaultNetwork;
        this.port = options.port ?? this.network.port;
        this.version = 0;
        this.bestHeight = 0;
        this.subversion = null;
        this.relay = options.relay !== false;
        this.versionSent = false;
        this.socketFactory = options.socketFactory ?? null;
        this.dataBuffer = new Uint8Array(0);
        this.messages = options.messages ?? new Messages({
            network: this.network,
        });
        if (options.socket) {
            this.socket = options.socket;
            this.host = options.socket.remoteAddress ?? 'unknown';
            this.port = options.socket.remotePort ?? this.port;
            this.status = PeerStatus.CONNECTED;
            this._addSocketEventHandlers();
        }
        else {
            this.host = options.host ?? 'localhost';
            this.status = PeerStatus.DISCONNECTED;
        }
        // Automatic message handlers
        this.on('verack', () => {
            this.status = PeerStatus.READY;
            this.emit('ready');
        });
        this.on('version', (message) => {
            this.version = message.version;
            this.subversion = message.subversion;
            this.bestHeight = message.startHeight;
            const verackResponse = this.messages.VerAck();
            this.sendMessage(verackResponse);
            if (!this.versionSent) {
                this._sendVersion();
            }
        });
        this.on('ping', (message) => {
            this._sendPong(message.nonce);
        });
    }
    /**
     * Set a SOCKS5 proxy for the connection.
     * Provide a custom socketFactory that handles SOCKS5 connections.
     * Example: use the `socks` npm package to create a SOCKS5-capable factory.
     */
    setProxy(_host, _port) {
        if (this.status !== PeerStatus.DISCONNECTED) {
            throw new Error('Cannot set proxy on a connected peer');
        }
        throw new Error('Built-in SOCKS5 proxy is not supported. ' +
            'Pass a socketFactory option that creates a SOCKS5 socket instead.');
    }
    /**
     * Connect to the peer.
     */
    async connect() {
        this.socket = await this._getSocket();
        this.status = PeerStatus.CONNECTING;
        this.socket.on('connect', () => {
            this.status = PeerStatus.CONNECTED;
            this.emit('connect');
            this._sendVersion();
        });
        this._addSocketEventHandlers();
        this.socket.connect(this.port, this.host);
        return this;
    }
    _addSocketEventHandlers() {
        if (!this.socket)
            return;
        this.socket.on('error', this._onError.bind(this));
        this.socket.on('end', this.disconnect.bind(this));
        this.socket.on('data', (data) => {
            const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
            const combined = new Uint8Array(this.dataBuffer.length + chunk.length);
            combined.set(this.dataBuffer);
            combined.set(chunk, this.dataBuffer.length);
            this.dataBuffer = combined;
            if (this.dataBuffer.length > Peer.MAX_RECEIVE_BUFFER) {
                return this.disconnect();
            }
            this._readMessage();
        });
    }
    _onError(e) {
        this.emit('error', e);
        if (this.status !== PeerStatus.DISCONNECTED) {
            this.disconnect();
        }
    }
    /**
     * Disconnect from the peer.
     */
    disconnect() {
        this.status = PeerStatus.DISCONNECTED;
        this.socket?.destroy();
        this.emit('disconnect');
        return this;
    }
    /**
     * Send a message to the peer.
     */
    sendMessage(message) {
        this.socket?.write(message.toBytes());
    }
    _sendVersion() {
        const message = this.messages.Version({ relay: this.relay });
        this.versionSent = true;
        this.sendMessage(message);
    }
    _sendPong(nonce) {
        const message = this.messages.Pong(nonce);
        this.sendMessage(message);
    }
    _readMessage() {
        while (this.dataBuffer.length > 0) {
            const result = this.messages.parseBytes(this.dataBuffer);
            if (!result)
                break;
            this.dataBuffer = this.dataBuffer.subarray(result.consumed);
            if (result.message) {
                this.emit(result.message.command, result.message);
            }
        }
    }
    async _getSocket() {
        if (this.socketFactory) {
            return this.socketFactory();
        }
        // Try to use Node.js net module
        try {
            const { Socket } = await import('net');
            return new Socket();
        }
        catch {
            throw new Error('TCP sockets are not available in this environment. ' +
                'Provide a socketFactory option to create a custom socket.');
        }
    }
}
//# sourceMappingURL=Peer.js.map