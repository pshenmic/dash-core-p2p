import EventEmitter from 'eventemitter3';
import { Peer } from './Peer.js';
import { Networks } from './Network.js';
import { strToBytes, bytesToHex } from './utils/binary.js';
import { utils as sdkUtils } from 'dash-core-sdk';
const { doubleSHA256 } = sdkUtils;
function now() {
    return Math.floor(Date.now() / 1000);
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
    static MaxConnectedPeers = 8;
    static RetrySeconds = 30;
    static PeerEvents = [
        'version', 'inv', 'getdata', 'ping', 'pong', 'addr',
        'getaddr', 'verack', 'reject', 'alert', 'headers', 'block', 'merkleblock',
        'tx', 'getblocks', 'getheaders', 'error', 'filterload', 'filteradd',
        'filterclear', 'getmnlistdiff', 'mnlistdiff', 'islock', 'clsig',
        'getcfilters', 'cfilter', 'getcfheaders', 'cfheaders', 'getcfcheckpt', 'cfcheckpt',
    ];
    keepalive = false;
    listenAddr;
    dnsSeed;
    maxSize;
    messages;
    network;
    relay;
    _connectedPeers = {};
    _addrs = [];
    server = null;
    constructor(options) {
        super();
        const opts = options ?? {};
        this.listenAddr = opts.listenAddr !== false;
        this.dnsSeed = opts.dnsSeed !== false;
        this.maxSize = opts.maxSize ?? Pool.MaxConnectedPeers;
        this.messages = opts.messages;
        this.network = Networks.get(opts.network) ?? Networks.defaultNetwork;
        this.relay = opts.relay !== false;
        if (opts.addrs) {
            for (const addr of opts.addrs) {
                this._addAddr(addr);
            }
        }
        if (this.listenAddr) {
            this.on('peeraddr', (peer, message) => {
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
        this.on('seed', (ips) => {
            for (const ip of ips) {
                this._addAddr({ ip: { v4: ip } });
            }
            if (this.keepalive) {
                this._fillConnections();
            }
        });
        this.on('peerdisconnect', (peer, addr) => {
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
    connect() {
        this.keepalive = true;
        if (this.dnsSeed) {
            this._addAddrsFromSeeds();
        }
        else {
            this._fillConnections();
        }
        return this;
    }
    /**
     * Disconnect all peers.
     */
    disconnect() {
        this.keepalive = false;
        for (const peer of Object.values(this._connectedPeers)) {
            peer.disconnect();
        }
        return this;
    }
    /**
     * Returns the number of currently connected peers.
     */
    numberConnected() {
        return Object.keys(this._connectedPeers).length;
    }
    _fillConnections() {
        for (const addr of this._addrs) {
            if (this.numberConnected() >= this.maxSize)
                break;
            if (!addr.retryTime || now() > addr.retryTime) {
                this._connectPeer(addr);
            }
        }
    }
    _removeConnectedPeer(addr) {
        const hash = addr.hash;
        if (this._connectedPeers[hash]?.status !== 'disconnected') {
            this._connectedPeers[hash]?.disconnect();
        }
        else {
            delete this._connectedPeers[hash];
        }
    }
    _connectPeer(addr) {
        const hash = addr.hash;
        if (!this._connectedPeers[hash]) {
            const port = addr.port ?? this.network.port;
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
    _addConnectedPeer(socket, addr) {
        const hash = addr.hash;
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
    _addPeerEventHandlers(peer, addr) {
        peer.on('disconnect', () => {
            this.emit('peerdisconnect', peer, addr);
        });
        peer.on('ready', () => {
            this.emit('peerready', peer, addr);
        });
        for (const event of Pool.PeerEvents) {
            peer.on(event, (message) => {
                this.emit('peer' + event, peer, message);
            });
        }
    }
    _deprioritizeAddr(addr) {
        const idx = this._addrs.findIndex((a) => a.hash === addr.hash);
        if (idx !== -1) {
            const [item] = this._addrs.splice(idx, 1);
            item.retryTime = now() + Pool.RetrySeconds;
            this._addrs.push(item);
        }
    }
    _addAddr(addr) {
        addr.port = addr.port ?? this.network.port;
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
    _addAddrsFromSeed(seed) {
        // Use dynamic import for Node.js dns module
        import('dns').then((dns) => {
            dns.resolve(seed, (err, ips) => {
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
    _addAddrsFromSeeds() {
        const seeds = this.network.dnsSeeds;
        for (const seed of seeds) {
            this._addAddrsFromSeed(seed);
        }
    }
    inspect() {
        return ('<Pool network: ' +
            this.network?.name +
            ', connected: ' +
            this.numberConnected() +
            ', available: ' +
            this._addrs.length +
            '>');
    }
    /**
     * Broadcast a message to all connected peers.
     */
    sendMessage(message) {
        for (const peer of Object.values(this._connectedPeers)) {
            peer.sendMessage(message);
        }
    }
    /**
     * Listen for incoming peer connections on the network port.
     * Node.js only.
     */
    async listen() {
        const { createServer, isIPv6 } = await import('net');
        this.server = createServer((socket) => {
            const addr = { ip: {} };
            if (isIPv6(socket.remoteAddress ?? '')) {
                addr.ip.v6 = socket.remoteAddress;
            }
            else {
                addr.ip.v4 = socket.remoteAddress;
            }
            addr.port = socket.remotePort;
            this._addAddr(addr);
            this._addConnectedPeer(socket, addr);
        });
        this.server.listen(this.network.port);
    }
}
//# sourceMappingURL=Pool.js.map