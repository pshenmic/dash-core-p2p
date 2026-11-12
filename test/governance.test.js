import chai from 'chai';
import EventEmitter from 'eventemitter3';
import { createRequire } from 'module';
import { Transaction } from 'dash-core-sdk';
import {
  BloomFilter,
  GovernanceObject,
  GovernanceVote,
  GovernanceObjectType,
  GovSyncMessage,
  GovObjMessage,
  GovObjVoteMessage,
  Inventory,
  InventoryType,
  Messages,
  Peer,
  PeerStatus,
  Pool,
} from '../dist/index.js';
import { hexToBytes, bytesToHex, reverseBytes } from '../dist/utils/binary.js';

const should = chai.should();
const { expect } = chai;
const require = createRequire(import.meta.url);
const Gov = require('./data/governance.json');

const ZERO = '0'.repeat(64);
const messages = new Messages({ network: 'testnet' });
const wire = (displayHex) => reverseBytes(hexToBytes(displayHex));
const display = (wireBytes) => bytesToHex(reverseBytes(wireBytes));

/** Two in-memory sockets wired to each other. */
function socketPair() {
  const make = () => {
    const s = new EventEmitter();
    s.remoteAddress = '127.0.0.1';
    s.remotePort = 19999;
    s.destroy = () => {};
    return s;
  };
  const a = make();
  const b = make();
  a.write = (data) => setImmediate(() => b.emit('data', data));
  b.write = (data) => setImmediate(() => a.emit('data', data));
  a.connect = () => setImmediate(() => a.emit('connect'));
  return [a, b];
}

/** A connected client/remote peer pair after the version handshake. */
async function connectedPeers() {
  const [a, b] = socketPair();
  const client = new Peer({ network: 'testnet', socketFactory: () => a });
  const remote = new Peer({ network: 'testnet', socket: b });
  const ready = (p) => new Promise((resolve) => p.once('ready', resolve));
  const both = Promise.all([ready(client), ready(remote)]);
  await client.connect();
  await both;
  return { client, remote };
}

async function rejects(promise, pattern) {
  let error;
  try { await promise; } catch (e) { error = e; }
  should.exist(error, 'expected rejection');
  error.message.should.match(pattern);
}

function roundTrip(message) {
  const result = messages.parseBytes(message.toBytes());
  should.not.exist(result.error);
  return result.message;
}

describe('Governance', function () {
  describe('GovernanceObject', function () {
    for (const fixture of Gov.objects) {
      it(`parses recorded object ${fixture.hash.slice(0, 8)} and hashes to the announced inv hash`, function () {
        const obj = GovernanceObject.fromBytes(hexToBytes(fixture.payload));
        obj.hash().should.equal(fixture.hash);
        obj.type.should.equal(GovernanceObjectType.PROPOSAL);
        obj.parentHash.should.equal(ZERO);
        obj.collateralHash.should.not.equal(ZERO);
        obj.proposal().should.have.property('payment_address');
        obj.hex().should.equal(fixture.payload);
      });
    }

    it('GovObj/GovObjVote reject truncated and trailing payloads', function () {
      for (const [factory, payload] of [[messages.GovObj, Gov.objects[0].payload], [messages.GovObjVote, Gov.votes[0].payload]]) {
        const bytes = hexToBytes(payload);
        expect(() => factory().setPayload(bytes.subarray(0, bytes.length - 1))).to.throw();
        const extra = new Uint8Array(bytes.length + 1);
        extra.set(bytes);
        expect(() => factory().setPayload(extra)).to.throw(/trailing/);
      }
    });

    it('hash changes with signed fields', function () {
      const obj = GovernanceObject.fromBytes(hexToBytes(Gov.objects[0].payload));
      obj.time += 1;
      obj.hash().should.not.equal(Gov.objects[0].hash);
    });
  });

  describe('GovernanceVote', function () {
    for (const fixture of Gov.votes) {
      it(`parses recorded vote ${fixture.hash.slice(0, 8)} and hashes to the announced inv hash`, function () {
        const vote = GovernanceVote.fromBytes(hexToBytes(fixture.payload));
        vote.hash().should.equal(fixture.hash);
        vote.parentHash.should.equal(fixture.parentHash);
        vote.signature.length.should.be.above(0);
        vote.hex().should.equal(fixture.payload);
        should.exist(vote.recoverSigner('testnet'));
      });
    }

    it('signature is not part of the hash', function () {
      const vote = GovernanceVote.fromBytes(hexToBytes(Gov.votes[0].payload));
      vote.signature = '00'.repeat(96);
      vote.hash().should.equal(Gov.votes[0].hash);
    });
  });

  describe('Inventory', function () {
    it('has governance types', function () {
      Inventory.TYPE.GOVERNANCE_OBJECT.should.equal(17);
      Inventory.TYPE.GOVERNANCE_OBJECT_VOTE.should.equal(18);
      Inventory.forGovernanceObject(Gov.objects[0].hash).type.should.equal(17);
      const inv = Inventory.forGovernanceVote(Gov.votes[0].hash);
      inv.type.should.equal(18);
      display(inv.hash).should.equal(Gov.votes[0].hash);
    });
  });

  describe('GovSync', function () {
    it('defaults to an object-list request with Core\'s empty filter', function () {
      const msg = messages.GovSync();
      msg.should.be.instanceof(GovSyncMessage);
      msg.isObjectListRequest.should.equal(true);
      bytesToHex(msg.getPayload()).should.equal(ZERO + '00' + '00000000' + '00000000' + '00');
    });

    it('serializes parentHash in wire order with a non-degenerate default filter', function () {
      const msg = messages.GovSync({ parentHash: Gov.objects[0].hash });
      msg.isObjectListRequest.should.equal(false);
      const payload = msg.getPayload();
      display(payload.subarray(0, 32)).should.equal(Gov.objects[0].hash);
      // vData [0], nHashFuncs 1: contains nothing, so the peer sends every vote
      bytesToHex(payload.subarray(32)).should.equal('0100' + '01000000' + '00000000' + '00');
      msg.filter.contains(wire(Gov.votes[0].hash)).should.equal(false);
    });

    it('carries a caller filter and round-trips through parseBytes', function () {
      const filter = BloomFilter.create(10, 0.001, 42, BloomFilter.BLOOM_UPDATE_NONE);
      filter.insert(wire(Gov.votes[0].hash));
      const parsed = roundTrip(messages.GovSync({ parentHash: Gov.objects[0].hash, filter }));
      parsed.should.be.instanceof(GovSyncMessage);
      parsed.parentHash.should.equal(Gov.objects[0].hash);
      parsed.filter.vData.should.deep.equal(filter.vData);
      parsed.filter.nHashFuncs.should.equal(filter.nHashFuncs);
      parsed.filter.nTweak.should.equal(42);
      parsed.filter.contains(wire(Gov.votes[0].hash)).should.equal(true);
    });

    it('parses the empty filter Core sends', function () {
      const parsed = roundTrip(messages.GovSync());
      parsed.isObjectListRequest.should.equal(true);
      parsed.filter.vData.should.deep.equal([]);
    });

    it('rejects bad arguments and malformed payloads', function () {
      expect(() => messages.GovSync({ parentHash: 'zz' })).to.throw(/parentHash/);
      expect(() => messages.GovSync({ filter: {} })).to.throw(/BloomFilter/);
      expect(() => messages.GovSync().setPayload(new Uint8Array(33))).to.throw(/too short/);
    });
  });

  describe('GovObj / GovObjVote messages', function () {
    it('are parsed as typed messages, not ignored', function () {
      const obj = roundTrip(messages.GovObj(GovernanceObject.fromBytes(hexToBytes(Gov.objects[0].payload))));
      obj.should.be.instanceof(GovObjMessage);
      obj.object.should.be.instanceof(GovernanceObject);
      obj.object.hash().should.equal(Gov.objects[0].hash);

      const vote = roundTrip(messages.GovObjVote(GovernanceVote.fromBytes(hexToBytes(Gov.votes[0].payload))));
      vote.should.be.instanceof(GovObjVoteMessage);
      vote.vote.hash().should.equal(Gov.votes[0].hash);
    });

    it('report a parse error for a bad payload', function () {
      const msg = messages.GovObjVote();
      msg.getPayload = () => new Uint8Array(10);
      const result = messages.parseBytes(msg.toBytes());
      result.error.command.should.equal('govobjvote');
    });

    it('type-check their argument', function () {
      expect(() => messages.GovObj({})).to.throw(/GovernanceObject/);
      expect(() => messages.GovObjVote({})).to.throw(/GovernanceVote/);
    });
  });

  describe('Pool', function () {
    it('forwards governance, getdata and notfound peer events', function () {
      for (const e of ['govobj', 'govobjvote', 'govsync', 'getdata', 'notfound', 'ssc']) {
        Pool.PeerEvents.should.include(e);
      }
    });

    it('re-emits them as peer<event>', function () {
      const pool = new Pool({ network: 'testnet', dnsSeed: false, listenAddr: false });
      const [, b] = socketPair();
      const addr = pool._addAddr({ ip: { v4: '127.0.0.1' } });
      pool._addConnectedPeer(b, addr);
      const peer = pool._connectedPeers[addr.hash];
      const seen = [];
      for (const e of ['govobj', 'govobjvote', 'getdata', 'notfound']) {
        pool.on('peer' + e, (p, m) => { p.should.equal(peer); seen.push(m.command); });
      }
      for (const m of [messages.GovObj(), messages.GovObjVote(), messages.GetData([]), messages.NotFound([])]) {
        peer.emit(m.command, m);
      }
      seen.should.deep.equal(['govobj', 'govobjvote', 'getdata', 'notfound']);
    });
  });

  describe('peer session', function () {
    it('requests the object list, receives objects and votes, and serves a vote on getdata', async function () {
      const { client, remote } = await connectedPeers();
      const objects = Gov.objects.map((o) => GovernanceObject.fromBytes(hexToBytes(o.payload)));
      const votes = Gov.votes.map((v) => GovernanceVote.fromBytes(hexToBytes(v.payload)));

      // Remote behaves like Core: govsync -> inv (+ ssc), getdata -> govobj / govobjvote.
      const remoteGotVote = new Promise((resolve) => remote.on('govobjvote', resolve));
      remote.on('govsync', (m) => {
        const items = m.isObjectListRequest
          ? objects.map((o) => Inventory.forGovernanceObject(o.hash()))
          : votes.filter((v) => v.parentHash === m.parentHash && !m.filter.contains(wire(v.hash())))
            .map((v) => Inventory.forGovernanceVote(v.hash()));
        remote.sendMessage(messages.Inventory(items));
      });
      remote.on('getdata', (m) => {
        for (const item of m.inventory) {
          const hash = display(item.hash);
          if (item.type === InventoryType.GOVERNANCE_OBJECT) {
            const o = objects.find((x) => x.hash() === hash);
            if (o) remote.sendMessage(messages.GovObj(o));
          }
          if (item.type === InventoryType.GOVERNANCE_OBJECT_VOTE) {
            const v = votes.find((x) => x.hash() === hash);
            if (v) remote.sendMessage(messages.GovObjVote(v));
          }
        }
      });

      // Client: fetch whatever governance items get announced.
      client.on('inv', (m) => {
        const want = m.inventory.filter((i) =>
          i.type === InventoryType.GOVERNANCE_OBJECT || i.type === InventoryType.GOVERNANCE_OBJECT_VOTE);
        if (want.length) client.sendMessage(messages.GetData(want));
      });

      const receivedObjects = [];
      const gotObjects = new Promise((resolve) => client.on('govobj', (m) => {
        receivedObjects.push(m.object);
        if (receivedObjects.length === objects.length) resolve();
      }));
      client.sendMessage(messages.GovSync());
      await gotObjects;
      receivedObjects.forEach((o) => o.should.be.instanceof(GovernanceObject));
      receivedObjects.map((o) => o.hash()).sort().should.deep.equal(Gov.objects.map((o) => o.hash).sort());

      // Ask for the first object's votes, skipping one we already have.
      const have = BloomFilter.create(10, 0.0001, 7, BloomFilter.BLOOM_UPDATE_NONE);
      have.insert(wire(Gov.votes[0].hash));
      const receivedVotes = [];
      const gotVotes = new Promise((resolve) => client.on('govobjvote', (m) => {
        receivedVotes.push(m.vote);
        if (receivedVotes.length === votes.length - 1) resolve();
      }));
      client.sendMessage(messages.GovSync({ parentHash: Gov.objects[0].hash, filter: have }));
      await gotVotes;
      receivedVotes.map((v) => v.hash()).sort().should.deep.equal(Gov.votes.slice(1).map((v) => v.hash).sort());

      // Serve our own vote: announce it, answer the remote's getdata.
      const ours = votes[0];
      client.on('getdata', (m) => {
        for (const item of m.inventory) {
          if (item.type === InventoryType.GOVERNANCE_OBJECT_VOTE && display(item.hash) === ours.hash()) {
            client.sendMessage(messages.GovObjVote(ours));
          }
        }
      });
      remote.on('inv', (m) => remote.sendMessage(messages.GetData(m.inventory)));
      client.sendMessage(messages.Inventory([Inventory.forGovernanceVote(ours.hash())]));
      const served = await remoteGotVote;
      served.vote.hash().should.equal(Gov.votes[0].hash);
      served.vote.hex().should.equal(Gov.votes[0].payload);
    });
  });
});

describe('Peer#queryTransaction', function () {
  const tx = new Transaction();
  tx.version = 2;
  const txid = tx.hash();

  async function withRemote(handler) {
    const { client, remote } = await connectedPeers();
    remote.on('getdata', (m) => handler(remote, m));
    return client;
  }

  it('sends getdata(MSG_TX) and resolves found with the tx', async function () {
    const client = await withRemote((remote, m) => {
      m.inventory[0].type.should.equal(InventoryType.TX);
      display(m.inventory[0].hash).should.equal(txid);
      remote.sendMessage(messages.Transaction(new Transaction()));          // unrelated tx: ignored
      remote.sendMessage(messages.Transaction(tx));
    });
    const result = await client.queryTransaction(txid);
    result.status.should.equal('found');
    result.tx.hash().should.equal(txid);
  });

  it('resolves notfound from a matching notfound', async function () {
    const client = await withRemote((remote, m) => {
      remote.sendMessage(messages.NotFound([{ type: InventoryType.TX, hash: new Uint8Array(32).fill(1) }]));
      remote.sendMessage(messages.NotFound(m.inventory));
    });
    (await client.queryTransaction(txid)).should.deep.equal({ status: 'notfound' });
    client.listeners('notfound').length.should.equal(0);
    client.listeners('tx').length.should.equal(0);
  });

  it('rejects on timeout and on disconnect', async function () {
    const client = await withRemote(() => {});
    await rejects(client.queryTransaction(txid, { timeout: 30 }), /no answer/);
    const pending = client.queryTransaction(txid);
    client.disconnect();
    await rejects(pending, /disconnected/);
    client.status.should.equal(PeerStatus.DISCONNECTED);
    client.listeners('disconnect').length.should.equal(0);
  });

  it('rejects an invalid txid', async function () {
    const client = await withRemote(() => {});
    await rejects(client.queryTransaction('abc'), /txid/);
  });
});

describe('BloomFilter (degenerate)', function () {
  it('accepts an empty filter and matches everything, like Core', function () {
    const f = BloomFilter.empty();
    f.contains(new Uint8Array(32)).should.equal(true);
    f.insert(new Uint8Array(32));
    f.vData.should.deep.equal([]);
    bytesToHex(f.toBytes()).should.equal('00' + '00000000' + '00000000' + '00');
  });
});
