import chai from 'chai';
import sinon from 'sinon';
import EventEmitter from 'eventemitter3';
import { Buffer } from 'buffer';

import { Pool, ChainLockTracker } from '../dist/index.js';

const { expect } = chai;

function fakePeer({ host = '1.2.3.4', port = 9999 } = {}) {
  const ee = new EventEmitter();
  ee.host = host;
  ee.port = port;
  ee.status = 'ready';
  return ee;
}

/** Build a fake `clsig` event payload. `displayHash` is RPC byte order. */
function clsig(height, displayHash, sig = new Uint8Array(96)) {
  // CLSigMessage stores blockHash as hex of WIRE bytes (reversed).
  const wireHex = Buffer.from(displayHash, 'hex').reverse().toString('hex');
  return { height, blockHash: wireHex, sig };
}

const HASH_A = 'aa'.repeat(32);
const HASH_B = 'bb'.repeat(32);
const HASH_C = 'cc'.repeat(32);

describe('ChainLockTracker', function () {
  let pool;

  beforeEach(function () {
    pool = new Pool({ dnsSeed: false, listenAddr: false });
  });

  it('starts with no best lock', function () {
    const t = new ChainLockTracker(pool);
    expect(t.best).to.equal(null);
    t.isHeightCovered(100).should.equal(false);
    t.close();
  });

  it('accepts the first clsig with minPeerConfirmations=1', function () {
    const t = new ChainLockTracker(pool);
    const updates = sinon.spy();
    t.on('update', updates);

    pool.emit('peerclsig', fakePeer(), clsig(100, HASH_A));

    updates.calledOnce.should.equal(true);
    t.best.height.should.equal(100);
    t.best.blockHash.should.equal(HASH_A);
    t.best.sig.length.should.equal(96);
    t.isHeightCovered(99).should.equal(true);
    t.isHeightCovered(100).should.equal(true);
    t.isHeightCovered(101).should.equal(false);
    t.isExactLockedTip(HASH_A, 100).should.equal(true);
    t.isExactLockedTip(HASH_A, 99).should.equal(false);
    t.isExactLockedTip(HASH_B, 100).should.equal(false);
    t.close();
  });

  it('promotes only after minPeerConfirmations distinct peers report', function () {
    const t = new ChainLockTracker(pool, { minPeerConfirmations: 2 });
    const updates = sinon.spy();
    t.on('update', updates);

    const p1 = fakePeer({ host: 'p1' });
    const p2 = fakePeer({ host: 'p2' });

    pool.emit('peerclsig', p1, clsig(50, HASH_A));
    expect(t.best).to.equal(null);
    updates.called.should.equal(false);
    t.pending.size.should.equal(1);

    // Same peer again — still no corroboration.
    pool.emit('peerclsig', p1, clsig(50, HASH_A));
    expect(t.best).to.equal(null);
    updates.called.should.equal(false);

    // Different peer corroborates.
    pool.emit('peerclsig', p2, clsig(50, HASH_A));
    updates.calledOnce.should.equal(true);
    t.best.height.should.equal(50);
    t.best.reportedBy.size.should.equal(2);
    t.pending.size.should.equal(0);
    t.close();
  });

  it('advances strictly monotonically by height', function () {
    const t = new ChainLockTracker(pool);
    pool.emit('peerclsig', fakePeer(), clsig(100, HASH_A));
    const updates = sinon.spy();
    t.on('update', updates);
    const stale = sinon.spy();
    t.on('stale', stale);

    // Lower height ignored as stale.
    pool.emit('peerclsig', fakePeer({ host: 'older' }), clsig(99, HASH_B));
    updates.called.should.equal(false);
    stale.calledOnce.should.equal(true);
    t.best.height.should.equal(100);

    // Same height same hash: stale-but-corroborating.
    pool.emit('peerclsig', fakePeer({ host: 'echo' }), clsig(100, HASH_A));
    updates.called.should.equal(false);
    stale.callCount.should.equal(2);
    t.best.reportedBy.size.should.equal(2);

    // Higher height: advances.
    pool.emit('peerclsig', fakePeer({ host: 'higher' }), clsig(101, HASH_C));
    updates.calledOnce.should.equal(true);
    t.best.height.should.equal(101);
    t.best.blockHash.should.equal(HASH_C);
    t.close();
  });

  it('records and emits conflict when same height brings different hash', function () {
    const t = new ChainLockTracker(pool);
    pool.emit('peerclsig', fakePeer({ host: 'p1' }), clsig(200, HASH_A));

    const conflicts = sinon.spy();
    t.on('conflict', conflicts);

    pool.emit('peerclsig', fakePeer({ host: 'attacker' }), clsig(200, HASH_B));

    conflicts.calledOnce.should.equal(true);
    t.conflicts.length.should.equal(1);
    const c = t.conflicts[0];
    c.atHeight.should.equal(200);
    c.existingHash.should.equal(HASH_A);
    c.incomingHash.should.equal(HASH_B);
    // Best lock unchanged.
    t.best.blockHash.should.equal(HASH_A);
    t.close();
  });

  it('detects conflicting hashes among PENDING entries', function () {
    const t = new ChainLockTracker(pool, { minPeerConfirmations: 2 });
    const conflicts = sinon.spy();
    t.on('conflict', conflicts);

    pool.emit('peerclsig', fakePeer({ host: 'p1' }), clsig(300, HASH_A));
    pool.emit('peerclsig', fakePeer({ host: 'p2' }), clsig(300, HASH_B));

    conflicts.calledOnce.should.equal(true);
    expect(t.best).to.equal(null);
    t.close();
  });

  it('emits error on malformed clsig payload', function () {
    const t = new ChainLockTracker(pool);
    const errors = sinon.spy();
    t.on('error', errors);

    pool.emit('peerclsig', fakePeer(), { height: -1, blockHash: HASH_A, sig: new Uint8Array(96) });
    pool.emit('peerclsig', fakePeer(), { height: 1, blockHash: 'not-hex', sig: new Uint8Array(96) });
    pool.emit('peerclsig', fakePeer(), { height: 1, blockHash: HASH_A, sig: new Uint8Array(95) });

    errors.callCount.should.equal(3);
    expect(t.best).to.equal(null);
    t.close();
  });

  it('caps conflict history at maxConflictHistory', function () {
    const t = new ChainLockTracker(pool, { maxConflictHistory: 3 });
    pool.emit('peerclsig', fakePeer({ host: 'p1' }), clsig(400, HASH_A));

    for (let i = 0; i < 10; i++) {
      pool.emit('peerclsig', fakePeer({ host: `att-${i}` }), clsig(400, HASH_B));
    }
    t.conflicts.length.should.equal(3);
    t.close();
  });

  it('close() detaches listeners and is idempotent', function () {
    const t = new ChainLockTracker(pool);
    const updates = sinon.spy();
    t.on('update', updates);

    t.close();
    t.closed.should.equal(true);

    pool.emit('peerclsig', fakePeer(), clsig(500, HASH_A));
    updates.called.should.equal(false);
    expect(t.best).to.equal(null);

    // Idempotent.
    t.close();
    t.closed.should.equal(true);
  });

  it('flips wire-hex from CLSigMessage into display order for callers', function () {
    const t = new ChainLockTracker(pool);
    // CLSigMessage.blockHash is hex of WIRE bytes; tracker must expose
    // display-order so users can compare with BlockHeader.hash().
    const displayHash = '0123456789abcdef'.repeat(4); // 64 chars
    pool.emit('peerclsig', fakePeer(), clsig(600, displayHash));
    t.best.blockHash.should.equal(displayHash);
    t.close();
  });

  it('throws on null pool', function () {
    expect(() => new ChainLockTracker(null)).to.throw(/pool is required/);
  });
});