import chai from 'chai';
import sinon from 'sinon';
import EventEmitter from 'eventemitter3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Peer, PeerStatus } from '../dist/Peer.js';
import { Messages } from '../dist/messages/Messages.js';
import { Networks } from '../dist/index.js';

const should = chai.should();
const { expect } = chai;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const messages = new Messages();

// Create a mock socket that mimics net.Socket's event interface
function createMockSocket() {
  const socket = new EventEmitter();
  socket.connect = sinon.spy();
  socket.write = sinon.spy();
  socket.destroy = sinon.spy();
  socket.remoteAddress = '127.0.0.1';
  socket.remotePort = 9999;
  return socket;
}

describe('Peer', function () {
  describe('Integration test', function () {
    it('parses a stream of data from a connection', function (done) {
      const peer = new Peer({ host: 'localhost' });
      let dataCallback;
      let connectCallback;

      const expected = { version: 1, verack: 1, inv: 18, addr: 4 };
      const received = { version: 0, verack: 0, inv: 0, addr: 0 };

      const stub = createMockSocket();
      stub.on('connect', function (cb) { connectCallback = cb; });

      // Override _getSocket to return our stub synchronously
      peer._getSocket = function () { return stub; };

      peer.on('connect', function () {
        dataCallback(readFileSync(join(__dirname, 'data/connection.log')));
      });

      stub.on = function (event, cb) {
        if (event === 'data') dataCallback = cb;
        if (event === 'connect') connectCallback = cb;
        if (event === 'error') {}
        if (event === 'end') {}
      };
      stub.connect = function () {
        if (connectCallback) connectCallback();
      };

      function check(message) {
        if (message.command in received) received[message.command]++;
        if (Object.keys(expected).every((k) => received[k] === expected[k])) {
          done();
        }
      }

      peer.on('version', check);
      peer.on('verack', check);
      peer.on('addr', check);
      peer.on('inv', check);

      peer.connect();
    });
  });

  it('create instance', function () {
    const peer = new Peer({ host: 'localhost' });
    peer.host.should.equal('localhost');
    peer.network.should.deep.equal(Networks.livenet);
    peer.port.should.equal(Networks.livenet.port);
  });

  it('create instance setting a port', function () {
    const peer = new Peer({ host: 'localhost', port: 8111 });
    peer.host.should.equal('localhost');
    peer.network.should.deep.equal(Networks.livenet);
    peer.port.should.equal(8111);
  });

  it('create instance setting a network', function () {
    const peer = new Peer({ host: 'localhost', network: Networks.testnet });
    peer.host.should.equal('localhost');
    peer.network.should.deep.equal(Networks.testnet);
    peer.port.should.equal(Networks.testnet.port);
  });

  it('create instance setting port and network', function () {
    const peer = new Peer({ host: 'localhost', port: 8111, network: Networks.testnet });
    peer.host.should.equal('localhost');
    peer.network.should.deep.equal(Networks.testnet);
    peer.port.should.equal(8111);
  });

  it('setProxy throws (not supported without socketFactory)', function () {
    const peer = new Peer({ host: 'localhost' });
    (function () {
      peer.setProxy('127.0.0.1', 9050);
    }).should.throw();
  });

  it('send pong on ping', function (done) {
    const peer = new Peer({ host: 'localhost' });
    const pingMessage = messages.Ping();
    peer.sendMessage = function (message) {
      message.command.should.equal('pong');
      message.nonce.should.deep.equal(pingMessage.nonce);
      done();
    };
    peer.emit('ping', pingMessage);
  });

  it('relay error from socket', function (done) {
    const stub = createMockSocket();
    const peer = new Peer({ host: 'localhost' });
    peer._getSocket = function () { return stub; };

    const error = new Error('test error');
    peer.on('error', function (err) {
      err.should.equal(error);
      done();
    });

    peer.connect();
    // Wait a tick for the async connect to set up
    setImmediate(() => {
      peer.socket.emit('error', error);
    });
  });

  it('will not disconnect twice on disconnect and error', function (done) {
    const stub = createMockSocket();
    const peer = new Peer({ host: 'localhost' });
    peer._getSocket = function () { return stub; };
    peer.on('error', sinon.stub());

    peer.connect();

    let called = 0;
    peer.on('disconnect', function () {
      called++;
      called.should.not.be.above(1);
      done();
    });

    setImmediate(() => {
      peer.disconnect();
      peer.socket.emit('error', new Error('fake error'));
    });
  });

  it('disconnect when receive buffer exceeds max', function (done) {
    const stub = createMockSocket();
    stub.connect = sinon.spy();

    const peer = new Peer({ host: 'localhost' });
    peer._getSocket = function () { return stub; };

    let disconnectCalled = false;
    const origDisconnect = peer.disconnect.bind(peer);
    peer.disconnect = function () {
      disconnectCalled = true;
      origDisconnect();
      done();
    };

    peer.connect();

    setImmediate(() => {
      // Simulate pushing too much data
      const bigBuf = new Uint8Array(Peer.MAX_RECEIVE_BUFFER + 1);
      peer.socket.emit('data', bigBuf);
    });
  });

  it('send message writes to socket', function () {
    const stub = createMockSocket();
    const peer = new Peer({ host: 'localhost', socket: stub });
    const msg = messages.VerAck();
    peer.sendMessage(msg);
    stub.write.calledOnce.should.equal(true);
  });

  it('disconnect destroys the socket', function () {
    const stub = createMockSocket();
    const peer = new Peer({ host: 'localhost', socket: stub });
    peer.disconnect();
    stub.destroy.calledOnce.should.equal(true);
    peer.status.should.equal(PeerStatus.DISCONNECTED);
  });

  it('uses STATUS constants', function () {
    Peer.STATUS.DISCONNECTED.should.equal('disconnected');
    Peer.STATUS.CONNECTING.should.equal('connecting');
    Peer.STATUS.CONNECTED.should.equal('connected');
    Peer.STATUS.READY.should.equal('ready');
  });
});
