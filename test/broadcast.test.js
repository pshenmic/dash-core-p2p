import chai from 'chai';
import sinon from 'sinon';
import EventEmitter from 'eventemitter3';

import { Pool, TxBroadcast, validateTransactionForBroadcast, MAX_STANDARD_TX_SIZE } from '../dist/index.js';
import { PeerStatus } from '../dist/Peer.js';
import { Transaction } from 'dash-core-sdk';

const should = chai.should();
const { expect } = chai;

// A minimal valid Dash tx (type 0, 1 input from a known prevout, 1 output).
// Built so .bytes()/.hash() succeed; no signature verification happens here.
function makeTxFromHex(hex) {
  return Transaction.fromHex(hex);
}

// Hex of a real-shaped Dash tx (1 input, 1 output, version=1, type=0).
// Generated offline so the test does not require an SDK transaction builder.
const SAMPLE_TX_HEX =
  '0100000001' + // version + type as 32-bit LE (v=1)
  // input
  '0000000000000000000000000000000000000000000000000000000000000001' + // prev txid (LE, all zeros except last=1)
  '00000000' + // prev vout = 0
  '00' +       // scriptSig length 0
  'ffffffff' + // sequence
  // output count
  '01' +
  // output: 1 sat, scriptPubKey = OP_RETURN
  '0100000000000000' + '016a';
// nLockTime is missing — add it
const SAMPLE_TX_HEX_FULL = SAMPLE_TX_HEX + '00000000';

function fakePeer({ host = '1.2.3.4', port = 9999, status = PeerStatus.READY } = {}) {
  const ee = new EventEmitter();
  ee.host = host;
  ee.port = port;
  ee.status = status;
  ee.sendMessage = sinon.spy();
  ee.disconnect = sinon.spy(() => { ee.status = PeerStatus.DISCONNECTED; });
  return ee;
}

function attachPeer(pool, peer) {
  pool._connectedPeers[`${peer.host}:${peer.port}`] = peer;
}

describe('validateTransactionForBroadcast', function () {
  it('throws on non-Transaction', function () {
    expect(() => validateTransactionForBroadcast({})).to.throw(/Transaction/);
  });

  it('throws on tx with no inputs', function () {
    const tx = makeTxFromHex(SAMPLE_TX_HEX_FULL);
    tx.inputs = [];
    expect(() => validateTransactionForBroadcast(tx)).to.throw(/no inputs/);
  });

  it('throws on tx with no outputs', function () {
    const tx = makeTxFromHex(SAMPLE_TX_HEX_FULL);
    tx.outputs = [];
    expect(() => validateTransactionForBroadcast(tx)).to.throw(/no outputs/);
  });

  it('throws when serialized tx exceeds max size', function () {
    const tx = makeTxFromHex(SAMPLE_TX_HEX_FULL);
    expect(() => validateTransactionForBroadcast(tx, { maxTxSize: 10 })).to.throw(/standard relay limit/);
  });

  it('passes a well-formed tx', function () {
    const tx = makeTxFromHex(SAMPLE_TX_HEX_FULL);
    expect(() => validateTransactionForBroadcast(tx)).to.not.throw();
  });

  it('exports MAX_STANDARD_TX_SIZE', function () {
    MAX_STANDARD_TX_SIZE.should.equal(100_000);
  });
});

describe('TxBroadcast', function () {
  let pool;
  let tx;

  beforeEach(function () {
    pool = new Pool({ network: 'mainnet', dnsSeed: false, listenAddr: false });
    tx = makeTxFromHex(SAMPLE_TX_HEX_FULL);
  });

  it('computes wire-order txid from display-order hash', function () {
    const b = new TxBroadcast(pool, tx);
    b.txid.should.equal(tx.hash());
    b.txidWire.length.should.equal(32);
    // wire order is the byte-reverse of the display hex.
    const expected = Buffer.from(tx.hash(), 'hex').reverse();
    Buffer.from(b.txidWire).equals(expected).should.equal(true);
    b.close();
  });

  it('announce() sends inv only to ready peers, idempotent per peer', function () {
    const p1 = fakePeer({ host: 'a', port: 1 });
    const p2 = fakePeer({ host: 'b', port: 2 });
    const p3 = fakePeer({ host: 'c', port: 3, status: PeerStatus.CONNECTING });
    attachPeer(pool, p1);
    attachPeer(pool, p2);
    attachPeer(pool, p3);

    const b = new TxBroadcast(pool, tx);
    const sent1 = b.announce();
    sent1.length.should.equal(2);
    p1.sendMessage.calledOnce.should.equal(true);
    p2.sendMessage.calledOnce.should.equal(true);
    p3.sendMessage.called.should.equal(false);

    // Second call is a no-op for already-invited peers.
    const sent2 = b.announce();
    sent2.length.should.equal(0);
    p1.sendMessage.calledOnce.should.equal(true);

    b.close();
  });

  it('serves the tx in response to a matching getdata and records the ack', function () {
    const peer = fakePeer();
    attachPeer(pool, peer);

    const b = new TxBroadcast(pool, tx);
    const requestSpy = sinon.spy();
    b.on('request', requestSpy);
    b.announce();

    // Pool re-emits peer events as `peer<command>` with (peer, message).
    pool.emit('peergetdata', peer, {
      inventory: [{ type: 1 /* TX */, hash: b.txidWire }],
    });

    requestSpy.calledOnceWith(peer).should.equal(true);
    b.requestedBy.has(peer).should.equal(true);
    // sendMessage: once for inv, once for tx.
    peer.sendMessage.callCount.should.equal(2);

    b.close();
  });

  it('ignores getdata for a different txid', function () {
    const peer = fakePeer();
    attachPeer(pool, peer);
    const b = new TxBroadcast(pool, tx);
    const requestSpy = sinon.spy();
    b.on('request', requestSpy);

    const wrong = new Uint8Array(32);
    wrong[0] = 0xff;
    pool.emit('peergetdata', peer, {
      inventory: [{ type: 1, hash: wrong }],
    });

    requestSpy.called.should.equal(false);
    b.requestedBy.size.should.equal(0);
    b.close();
  });

  it('records propagation echoes via inv from other peers', function () {
    const peer = fakePeer({ host: 'echo' });
    attachPeer(pool, peer);
    const b = new TxBroadcast(pool, tx);
    const propSpy = sinon.spy();
    b.on('propagated', propSpy);

    pool.emit('peerinv', peer, {
      inventory: [{ type: 1, hash: b.txidWire }],
    });

    propSpy.calledOnceWith(peer).should.equal(true);
    b.propagatedFrom.has(peer).should.equal(true);
    b.close();
  });

  it('fires islock when txid matches (wire-hex semantics)', function () {
    const peer = fakePeer();
    attachPeer(pool, peer);
    const b = new TxBroadcast(pool, tx);
    const lockSpy = sinon.spy();
    b.on('islock', lockSpy);

    // ISLockMessage stores the txid as hex of WIRE bytes.
    const wireHex = Buffer.from(b.txidWire).toString('hex');
    pool.emit('peerislock', peer, { txid: wireHex, inputs: [], sig: new Uint8Array(96) });

    lockSpy.calledOnce.should.equal(true);
    b.instantLocked.should.equal(true);

    // Second islock should not re-fire.
    pool.emit('peerislock', peer, { txid: wireHex, inputs: [], sig: new Uint8Array(96) });
    lockSpy.calledOnce.should.equal(true);

    b.close();
  });

  it('ignores islock for a different txid', function () {
    const peer = fakePeer();
    attachPeer(pool, peer);
    const b = new TxBroadcast(pool, tx);
    const lockSpy = sinon.spy();
    b.on('islock', lockSpy);
    pool.emit('peerislock', peer, { txid: 'ff'.repeat(32), inputs: [], sig: new Uint8Array(96) });
    lockSpy.called.should.equal(false);
    b.close();
  });

  it('fires reject when message="tx" and data txid matches', function () {
    const peer = fakePeer();
    attachPeer(pool, peer);
    const b = new TxBroadcast(pool, tx);
    const rejSpy = sinon.spy();
    b.on('reject', rejSpy);

    pool.emit('peerreject', peer, {
      message: 'tx',
      ccode: 0x42,
      reason: 'insufficient fee',
      data: b.txidWire,
    });

    rejSpy.calledOnce.should.equal(true);
    const info = rejSpy.firstCall.args[0];
    info.peer.should.equal(peer);
    info.ccode.should.equal(0x42);
    info.reason.should.equal('insufficient fee');
    b.rejections.length.should.equal(1);
    b.close();
  });

  it('ignores reject for a different message type or txid', function () {
    const peer = fakePeer();
    attachPeer(pool, peer);
    const b = new TxBroadcast(pool, tx);
    const rejSpy = sinon.spy();
    b.on('reject', rejSpy);

    // wrong command
    pool.emit('peerreject', peer, { message: 'block', data: b.txidWire });
    // wrong data
    pool.emit('peerreject', peer, { message: 'tx', data: new Uint8Array(32) });
    rejSpy.called.should.equal(false);
    b.close();
  });

  it('close() detaches all listeners and is idempotent', function () {
    const peer = fakePeer();
    attachPeer(pool, peer);
    const b = new TxBroadcast(pool, tx);
    const requestSpy = sinon.spy();
    b.on('request', requestSpy);

    b.close();
    b.closed.should.equal(true);
    pool.emit('peergetdata', peer, {
      inventory: [{ type: 1, hash: b.txidWire }],
    });
    requestSpy.called.should.equal(false);

    // Idempotent.
    b.close();
    b.closed.should.equal(true);
  });

  it('announce()/push() throw after close()', function () {
    const b = new TxBroadcast(pool, tx);
    b.close();
    expect(() => b.announce()).to.throw(/closed/);
    expect(() => b.push(fakePeer())).to.throw(/closed/);
  });

  it('push() is idempotent per peer and skips non-ready peers', function () {
    const ready = fakePeer({ host: 'ready' });
    const notReady = fakePeer({ host: 'nr', status: PeerStatus.CONNECTING });
    attachPeer(pool, ready);
    attachPeer(pool, notReady);

    const b = new TxBroadcast(pool, tx);
    b.push(ready).should.equal(true);
    b.push(ready).should.equal(false);
    b.push(notReady).should.equal(false);

    ready.sendMessage.calledOnce.should.equal(true);
    notReady.sendMessage.called.should.equal(false);
    b.close();
  });

  it('validates by default; skipValidation=true bypasses validation', function () {
    const bad = makeTxFromHex(SAMPLE_TX_HEX_FULL);
    bad.outputs = [];
    expect(() => new TxBroadcast(pool, bad)).to.throw(/no outputs/);
    expect(() => new TxBroadcast(pool, bad, { skipValidation: true })).to.not.throw();
  });
});