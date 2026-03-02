import EventEmitter from 'eventemitter3';
import { Messages } from './messages/Messages.js';
import { Networks, type Network } from './Network.js';
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

export const PeerStatus = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  READY: 'ready',
} as const;

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
export class Peer extends EventEmitter {
  static readonly MAX_RECEIVE_BUFFER = 10_000_000;
  static readonly STATUS = PeerStatus;

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

  socket: TCPSocket | null = null;
  protected socketFactory: SocketFactory | null;

  constructor(options: PeerOptions) {
    super();

    this.network = Networks.get(options.network as string) ?? Networks.defaultNetwork;
    this.port = options.port ?? this.network!.port;
    this.version = 0;
    this.bestHeight = 0;
    this.subversion = null;
    this.relay = options.relay !== false;
    this.versionSent = false;
    this.socketFactory = options.socketFactory ?? null;
    this.dataBuffer = new Uint8Array(0);

    this.messages = options.messages ?? new Messages({
      network: this.network!,
    });

    if (options.socket) {
      this.socket = options.socket;
      this.host = options.socket.remoteAddress ?? 'unknown';
      this.port = options.socket.remotePort ?? this.port;
      this.status = PeerStatus.CONNECTED;
      this._addSocketEventHandlers();
    } else {
      this.host = options.host ?? 'localhost';
      this.status = PeerStatus.DISCONNECTED;
    }

    // Automatic message handlers
    this.on('verack', () => {
      this.status = PeerStatus.READY;
      this.emit('ready');
    });

    this.on('version', (message: Message & { version: number; subversion: string; startHeight: number }) => {
      this.version = message.version;
      this.subversion = message.subversion;
      this.bestHeight = message.startHeight;

      const verackResponse = (this.messages as any).VerAck();
      this.sendMessage(verackResponse);

      if (!this.versionSent) {
        this._sendVersion();
      }
    });

    this.on('ping', (message: Message & { nonce: Uint8Array }) => {
      this._sendPong(message.nonce);
    });
  }

  /**
   * Set a SOCKS5 proxy for the connection.
   * Provide a custom socketFactory that handles SOCKS5 connections.
   * Example: use the `socks` npm package to create a SOCKS5-capable factory.
   */
  setProxy(_host: string, _port: number): this {
    if (this.status !== PeerStatus.DISCONNECTED) {
      throw new Error('Cannot set proxy on a connected peer');
    }
    throw new Error(
      'Built-in SOCKS5 proxy is not supported. ' +
      'Pass a socketFactory option that creates a SOCKS5 socket instead.',
    );
  }

  /**
   * Connect to the peer.
   */
  async connect(): Promise<this> {
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

  private _addSocketEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on('error', this._onError.bind(this));
    this.socket.on('end', this.disconnect.bind(this));

    this.socket.on('data', (data: Uint8Array) => {
      const chunk = data instanceof Uint8Array ? data : new Uint8Array(data as any);
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

  private _onError(e: Error): void {
    this.emit('error', e);
    if (this.status !== PeerStatus.DISCONNECTED) {
      this.disconnect();
    }
  }

  /**
   * Disconnect from the peer.
   */
  disconnect(): this {
    this.status = PeerStatus.DISCONNECTED;
    this.socket?.destroy();
    this.emit('disconnect');
    return this;
  }

  /**
   * Send a message to the peer.
   */
  sendMessage(message: Message): void {
    this.socket?.write(message.toBytes());
  }

  private _sendVersion(): void {
    const message = (this.messages as any).Version({ relay: this.relay });
    this.versionSent = true;
    this.sendMessage(message);
  }

  private _sendPong(nonce: Uint8Array): void {
    const message = (this.messages as any).Pong(nonce);
    this.sendMessage(message);
  }

  private _readMessage(): void {
    while (this.dataBuffer.length > 0) {
      const result = this.messages.parseBytes(this.dataBuffer);
      if (!result) break;
      this.dataBuffer = this.dataBuffer.subarray(result.consumed);
      if (result.message) {
        this.emit(result.message.command, result.message);
      }
    }
  }

  async _getSocket(): Promise<TCPSocket> {
    if (this.socketFactory) {
      return this.socketFactory();
    }

    // Try to use Node.js net module
    try {
      const { Socket } = await import('net');
      return new Socket() as unknown as TCPSocket;
    } catch {
      throw new Error(
        'TCP sockets are not available in this environment. ' +
        'Provide a socketFactory option to create a custom socket.',
      );
    }
  }
}
