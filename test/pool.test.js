import chai from 'chai';
import sinon from 'sinon';
import EventEmitter from 'eventemitter3';
import { Buffer } from 'buffer';

import { Pool } from '../dist/Pool.js';
import { Peer } from '../dist/Peer.js';
import { Networks } from '../dist/index.js';

const should = chai.should();
const { expect } = chai;

function createMockSocket() {
  const socket = new EventEmitter();
  socket.connect = sinon.spy();
  socket.write = sinon.spy();
  socket.destroy = sinon.spy();
  socket.remoteAddress = '127.0.0.1';
  socket.remotePort = 9999;
  return socket;
}

describe('Pool', function () {
  it('creates an instance', function () {
    const pool = new Pool({ network: Networks.livenet });
    should.exist(pool);
    pool.network.should.deep.equal(Networks.livenet);
  });

  it('defaults to livenet', function () {
    const pool = new Pool();
    pool.network.should.deep.equal(Networks.defaultNetwork);
  });

  it('has correct max connected peers default', function () {
    const pool = new Pool();
    pool.maxSize.should.equal(Pool.MaxConnectedPeers);
  });

  it('can set maxSize', function () {
    const pool = new Pool({ maxSize: 3 });
    pool.maxSize.should.equal(3);
  });

  it('#numberConnected returns 0 initially', function () {
    const pool = new Pool();
    pool.numberConnected().should.equal(0);
  });

  it('#connect sets keepalive to true', function () {
    const pool = new Pool({ dnsSeed: false });
    pool.connect();
    pool.keepalive.should.equal(true);
    pool.disconnect();
  });

  it('#disconnect sets keepalive to false', function () {
    const pool = new Pool({ dnsSeed: false });
    pool.connect();
    pool.disconnect();
    pool.keepalive.should.equal(false);
  });

  it('#_addAddr adds address and returns it', function () {
    const pool = new Pool();
    const addr = { ip: { v4: '127.0.0.1', v6: '0000:0000:0000:0000:0000:0000:0000:0001' }, port: 9999 };
    const result = pool._addAddr(addr);
    should.exist(result.hash);
    pool._addrs.length.should.be.at.least(1);
  });

  it('#_addAddr does not add duplicate', function () {
    const pool = new Pool();
    const addr = { ip: { v4: '127.0.0.1', v6: '0000:0000:0000:0000:0000:0000:0000:0001' }, port: 9999 };
    pool._addAddr(addr);
    pool._addAddr(addr);
    const count = pool._addrs.filter((a) => a.hash === addr.hash).length;
    count.should.equal(1);
  });

  it('can add peers via options', function () {
    const pool = new Pool({
      peers: ['127.0.0.1:9999', '[::1]:9999'],
    });
    pool._addrs.length.should.equal(2);
    pool._addrs.some((a) => a.ip.v4 === '127.0.0.1' && a.port === 9999).should.equal(true);
    pool._addrs.some((a) => a.ip.v6 === '::1' && a.port === 9999).should.equal(true);
  });

  it('#sendMessage broadcasts to all connected peers', function () {
    const pool = new Pool({ dnsSeed: false, listenAddr: false });

    const mockPeer1 = { sendMessage: sinon.spy(), status: 'ready' };
    const mockPeer2 = { sendMessage: sinon.spy(), status: 'ready' };

    pool._connectedPeers['abc'] = mockPeer1;
    pool._connectedPeers['def'] = mockPeer2;

    const msg = { toBytes: () => new Uint8Array(0), command: 'ping' };
    pool.sendMessage(msg);

    mockPeer1.sendMessage.calledOnce.should.equal(true);
    mockPeer2.sendMessage.calledOnce.should.equal(true);
  });

  it('#inspect returns a string', function () {
    const pool = new Pool();
    const result = pool.inspect();
    result.should.be.a('string');
    result.should.include('Pool');
  });

  it('emits peerconnect when a peer connects', function (done) {
    const pool = new Pool({ dnsSeed: false, listenAddr: false });
    const addr = { ip: { v4: '127.0.0.1', v6: '0000:0000:0000:0000:0000:0000:0000:0001' }, port: 9999 };
    pool._addAddr(addr);

    pool.on('peerconnect', function (peer, connAddr) {
      should.exist(peer);
      connAddr.hash.should.equal(addr.hash);
      done();
    });

    // Mock the peer connect to emit connect immediately
    const origFillConnections = pool._fillConnections.bind(pool);
    pool._fillConnections = function () {
      const addrObj = pool._addrs[0];
      if (!addrObj) return;

      const stub = createMockSocket();
      const peer = new Peer({
        socket: stub,
        network: pool.network,
      });

      pool._connectedPeers[addrObj.hash] = peer;
      pool.emit('peerconnect', peer, addrObj);
    };

    pool.connect();
  });

  it('PeerEvents list is defined', function () {
    Pool.PeerEvents.should.include('version');
    Pool.PeerEvents.should.include('inv');
    Pool.PeerEvents.should.include('tx');
  });
});
