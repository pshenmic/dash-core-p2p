import EventEmitter from 'eventemitter3';
import { Peer, type PeerOptions, type TCPSocket } from './Peer.js';
import { Messages } from './messages/Messages.js';
import { Networks, type Network } from './Network.js';
import { strToBytes, bytesToHex } from './utils/binary.js';
import type { Message } from './messages/Message.js';
import { utils as sdkUtils } from 'dash-core-sdk';

const { doubleSHA256 } = sdkUtils;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export interface AddrInfo {
  ip: { v4?: string; v6?: string };
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
export class Pool extends EventEmitter {
  static readonly MaxConnectedPeers = 8;
  static readonly RetrySeconds = 30;
  static readonly PeerEvents: string[] = [
    'version', 'inv', 'getdata', 'ping', 'pong', 'addr',
    'getaddr', 'verack', 'reject', 'alert', 'headers', 'block', 'merkleblock',
    'tx', 'getblocks', 'getheaders', 'error', 'filterload', 'filteradd',
    'filterclear', 'getmnlistdiff', 'mnlistdiff', 'islock', 'clsig',
  ];

  keepalive: boolean = false;
  listenAddr: boolean;
  dnsSeed: boolean;
  maxSize: number;
  messages: Messages | undefined;
  network: Network | null;
  relay: boolean;

  _connectedPeers: Record<string, Peer> = {};
  _addrs: AddrInfo[] = [];
  private server: unknown = null;

  constructor(options?: PoolOptions) {
    super();

    const opts = options ?? {};
    this.listenAddr = opts.listenAddr !== false;
    this.dnsSeed = opts.dnsSeed !== false;
    this.maxSize = opts.maxSize ?? Pool.MaxConnectedPeers;
    this.messages = opts.messages;
    this.network = Networks.get(opts.network as string) ?? Networks.defaultNetwork;
    this.relay = opts.relay !== false;

    if (opts.addrs) {
      for (const addr of opts.addrs) {
        this._addAddr(addr);
      }
    }

    if (this.listenAddr) {
      this.on('peeraddr', (peer: Peer, message: Message & { addresses: AddrInfo[] }) => {
        const addrs = message.addresses ?? [];
        for (const addr of addrs) {
          const future = Date.now() + 10 * 60 * 1000;
          if (!addr.time || addr.time.getTime() <= 100_000_000_000 || addr.time.getTime() > future) {
            addr.time = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
          }
          this._addAddr(addr);
        }
      });
    }

    this.on('seed', (ips: string[]) => {
      for (const ip of ips) {
        this._addAddr({ ip: { v4: ip } });
      }
      if (this.keepalive) {
        this._fillConnections();
      }
    });

    this.on('peerdisconnect', (peer: Peer, addr: AddrInfo) => {
      this._deprioritizeAddr(addr);
      this._removeConnectedPeer(addr);
      if (this.keepalive) {
        this._fillConnections();
      }
    });
  }

  /**
   * Start connecting to peers. Uses DNS seeds if enabled.
   */
  connect(): this {
    this.keepalive = true;
    if (this.dnsSeed) {
      this._addAddrsFromSeeds();
    } else {
      this._fillConnections();
    }
    return this;
  }

  /**
   * Disconnect all peers.
   */
  disconnect(): this {
    this.keepalive = false;
    for (const peer of Object.values(this._connectedPeers)) {
      peer.disconnect();
    }
    return this;
  }

  /**
   * Returns the number of currently connected peers.
   */
  numberConnected(): number {
    return Object.keys(this._connectedPeers).length;
  }

  _fillConnections(): void {
    for (const addr of this._addrs) {
      if (this.numberConnected() >= this.maxSize) break;
      if (!addr.retryTime || now() > addr.retryTime) {
        this._connectPeer(addr);
      }
    }
  }

  private _removeConnectedPeer(addr: AddrInfo): void {
    const hash = addr.hash!;
    if (this._connectedPeers[hash]?.status !== 'disconnected') {
      this._connectedPeers[hash]?.disconnect();
    } else {
      delete this._connectedPeers[hash];
    }
  }

  private _connectPeer(addr: AddrInfo): void {
    const hash = addr.hash!;
    if (!this._connectedPeers[hash]) {
      const port = addr.port ?? this.network!.port;
      const ip = addr.ip.v4 ?? addr.ip.v6 ?? 'localhost';

      const peer = new Peer({
        host: ip,
        port,
        messages: this.messages,
        network: this.network ?? undefined,
        relay: this.relay,
      });

      peer.on('connect', () => {
        this.emit('peerconnect', peer, addr);
      });

      this._addPeerEventHandlers(peer, addr);
      peer.connect();
      this._connectedPeers[hash] = peer;
    }
  }

  /**
   * Add a peer from an established socket connection.
   */
  _addConnectedPeer(socket: TCPSocket, addr: AddrInfo): void {
    const hash = addr.hash!;
    if (!this._connectedPeers[hash]) {
      const peer = new Peer({
        socket,
        network: this.network ?? undefined,
        messages: this.messages,
      });

      this._addPeerEventHandlers(peer, addr);
      this._connectedPeers[hash] = peer;
      this.emit('peerconnect', peer, addr);
    }
  }

  private _addPeerEventHandlers(peer: Peer, addr: AddrInfo): void {
    peer.on('disconnect', () => {
      this.emit('peerdisconnect', peer, addr);
    });
    peer.on('ready', () => {
      this.emit('peerready', peer, addr);
    });
    for (const event of Pool.PeerEvents) {
      peer.on(event, (message: Message) => {
        this.emit('peer' + event, peer, message);
      });
    }
  }

  private _deprioritizeAddr(addr: AddrInfo): void {
    const idx = this._addrs.findIndex((a) => a.hash === addr.hash);
    if (idx !== -1) {
      const [item] = this._addrs.splice(idx, 1);
      item!.retryTime = now() + Pool.RetrySeconds;
      this._addrs.push(item!);
    }
  }

  _addAddr(addr: AddrInfo): AddrInfo {
    addr.port = addr.port ?? this.network!.port;

    // Create a stable hash key for the address using native TextEncoder
    const v6 = addr.ip.v6 ?? '';
    const v4 = addr.ip.v4 ?? '';
    const hashInput = strToBytes(v6 + v4 + String(addr.port));
    addr.hash = bytesToHex(doubleSHA256(hashInput));

    const exists = this._addrs.some((a) => a.hash === addr.hash);
    if (!exists) {
      this._addrs.unshift(addr);
    }
    return addr;
  }

  private _addAddrsFromSeed(seed: string): void {
    // Use dynamic import for Node.js dns module
    import('dns').then((dns) => {
      dns.resolve(seed, (err: Error | null, ips: string[]) => {
        if (err) {
          this.emit('seederror', err);
          return;
        }
        if (!ips || !ips.length) {
          this.emit('seederror', new Error('No IPs found from seed lookup.'));
          return;
        }
        this.emit('seed', ips);
      });
    }).catch((err) => {
      this.emit('seederror', err);
    });
  }

  private _addAddrsFromSeeds(): void {
    const seeds = this.network!.dnsSeeds;
    for (const seed of seeds) {
      this._addAddrsFromSeed(seed);
    }
  }

  inspect(): string {
    return (
      '<Pool network: ' +
      (this.network as any)?.name +
      ', connected: ' +
      this.numberConnected() +
      ', available: ' +
      this._addrs.length +
      '>'
    );
  }

  /**
   * Broadcast a message to all connected peers.
   */
  sendMessage(message: Message): void {
    for (const peer of Object.values(this._connectedPeers)) {
      peer.sendMessage(message);
    }
  }

  /**
   * Listen for incoming peer connections on the network port.
   * Node.js only.
   */
  async listen(): Promise<void> {
    const { createServer, isIPv6 } = await import('net');

    this.server = createServer((socket) => {
      const addr: AddrInfo = { ip: {} };
      if (isIPv6(socket.remoteAddress ?? '')) {
        addr.ip.v6 = socket.remoteAddress;
      } else {
        addr.ip.v4 = socket.remoteAddress;
      }
      addr.port = socket.remotePort;

      this._addAddr(addr);
      this._addConnectedPeer(socket as unknown as TCPSocket, addr);
    });

    (this.server as any).listen(this.network!.port);
  }
}
