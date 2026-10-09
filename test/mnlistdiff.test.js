import chai from 'chai';
import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import {
  MnListDiff,
  Messages,
  ProTxVersion,
  MnType,
  NetInfoPurpose,
  NetInfoType,
} from '../dist/index.js';
import { hexToBytes, bytesToHex } from '../dist/utils/binary.js';

const should = chai.should();
const require = createRequire(import.meta.url);
const Data = require('./data/messages.json');
const __dirname = dirname(fileURLToPath(import.meta.url));

// Full list (base = zero hash) at mainnet block 2552448, fetched from a Dash Core 23.1.2 node.
const mainnetFull = new Uint8Array(gunzipSync(readFileSync(join(__dirname, 'data/mnlistdiff-mainnet-2552448.bin.gz'))));
// 100-block testnet diff (quorums only), Dash Core 24.0.0.
const testnetSmall = hexToBytes(Data.mnlistdiff.message.slice(48));

function sha256d(bytes) {
  const once = createHash('sha256').update(bytes).digest();
  return new Uint8Array(createHash('sha256').update(once).digest());
}

function concat(...hexParts) {
  return hexToBytes(hexParts.join(''));
}

describe('MnListDiff', function () {
  describe('mainnet full list', function () {
    const diff = MnListDiff.fromBytes(mainnetFull);

    it('parses the header and coinbase', function () {
      diff.nVersion.should.equal(1);
      diff.baseBlockHash.should.equal('0'.repeat(64));
      diff.blockHash.should.equal('00000000000000019fc90c36b57bdf6a0d3d175c8d81cf11eece224c65602c53');
      diff.cbTx.extraPayload.height.should.equal(2552448);
    });

    it('parses every section', function () {
      diff.mnList.length.should.equal(2962);
      diff.deletedMNs.length.should.equal(0);
      diff.deletedQuorums.length.should.equal(0);
      diff.newQuorums.length.should.equal(88);
      diff.quorumsCLSigs.length.should.equal(29);
      for (const sig of diff.quorumsCLSigs) {
        for (const i of sig.indexSet) i.should.be.below(diff.newQuorums.length);
      }
    });

    it('parses legacy, BLS-basic and indexed (rotated) commitments', function () {
      new Set(diff.newQuorums.map((q) => q.nVersion)).should.deep.equal(new Set([1, 3, 4]));
      for (const q of diff.newQuorums) {
        if (q.nVersion === 4) q.quorumIndex.should.be.a('number');
        else should.not.exist(q.quorumIndex);
        q.validMembers.length.should.equal(q.signers.length);
      }
    });

    it('contains legacy, basic and evo entries', function () {
      const kinds = new Set(diff.mnList.map((e) => `${e.nVersion}/${e.nType}`));
      kinds.should.include('1/0');
      kinds.should.include('2/0');
      kinds.should.include('2/1');
      for (const e of diff.mnList.filter((x) => x.nVersion === ProTxVersion.LegacyBLS)) {
        e.nType.should.equal(MnType.Regular);
        should.not.exist(e.platformNodeID);
      }
    });

    it('exposes evo node fields', function () {
      const evo = diff.mnList.find((e) => e.proRegTxHash === '3e596421618da23ec6700771c2f4cf819fd9ddec753f7889c96f7d1ecb6f9c40');
      evo.nVersion.should.equal(ProTxVersion.BasicBLS);
      evo.nType.should.equal(MnType.Evo);
      evo.isValid.should.equal(true);
      evo.address.host.should.equal('149.28.241.190');
      evo.address.port.should.equal(9999);
      evo.service.length.should.equal(18);
      evo.platformHTTPPort.should.equal(443);
      evo.platformNodeID.should.equal('ee9ab93559e6e931d7dbcf269e1ea8446e7068e5');
      should.not.exist(evo.netInfo);
    });

    it('round-trips byte for byte', function () {
      bytesToHex(diff.toBytes()).should.equal(bytesToHex(mainnetFull));
    });

    it('computes merkleRootMNList matching the coinbase', function () {
      diff.merkleRootMNList.should.equal('1c03ba9d5b46d9b4354a41dfa881cbaecf9396b8fc02f0abe9f274ff7c348aaa');
      MnListDiff.calcMerkleRootMNList(diff.mnList).should.equal(diff.merkleRootMNList);
    });

    it('merkleRootMNList detects a modified entry', function () {
      const list = diff.mnList.map((e) => ({ ...e }));
      list[5].isValid = !list[5].isValid;
      MnListDiff.calcMerkleRootMNList(list).should.not.equal(diff.merkleRootMNList);
    });
  });

  describe('testnet quorum diff', function () {
    it('parses a quorum-only diff and round-trips', function () {
      const diff = MnListDiff.fromBytes(testnetSmall);
      diff.mnList.length.should.equal(0);
      diff.newQuorums.length.should.equal(14);
      diff.deletedQuorums.length.should.equal(14);
      diff.quorumsCLSigs.length.should.equal(5);
      bytesToHex(diff.toBytes()).should.equal(bytesToHex(testnetSmall));
    });
  });

  describe('ExtAddr (nVersion 3) entry', function () {
    // Hand-assembled from Dash Core src/evo/simplifiedmns.h / src/evo/netinfo.h
    const cbTxHex = bytesToHex(MnListDiff.fromBytes(testnetSmall).cbTxBytes);
    const entryHex = [
      '0300',                                     // nVersion = ExtAddr
      '11'.repeat(32),                            // proRegTxHash (wire)
      '22'.repeat(32),                            // confirmedHash (wire)
      '01',                                       // ExtNetInfo version
      '03',                                       // 3 purposes
      '00', '01', '01', '01', '04', 'c0a80001', '270f',      // CORE_P2P: Service IPv4 192.168.0.1:9999
      '01', '01', '01', '02', '10', '20010db8000000000000000000000001', '6820', // PLATFORM_P2P: [2001:db8::1]:26656
      '02', '02',                                 // PLATFORM_HTTPS: 2 entries
      '02', '0f', bytesToHex(new TextEncoder().encode('evo.example.org')), '01bb', // Domain evo.example.org:443
      'ff',                                       // Invalid
      '33'.repeat(48),                            // pubKeyOperator
      '44'.repeat(20),                            // keyIDVoting
      '01',                                       // isValid
      '0100',                                     // nType = Evo
      '000102030405060708090a0b0c0d0e0f10111213', // platformNodeID (wire)
    ].join('');
    const payload = concat(
      '0100', '00'.repeat(32), 'ab'.repeat(32), '01000000', '00', '00',
      cbTxHex,
      '00',             // deletedMNs
      '01', entryHex,   // mnList
      '00', '00', '00', // deletedQuorums, newQuorums, quorumsCLSigs
    );

    it('parses netInfo entries grouped by purpose', function () {
      const diff = MnListDiff.fromBytes(payload);
      diff.mnList.length.should.equal(1);
      const e = diff.mnList[0];
      e.nVersion.should.equal(ProTxVersion.ExtAddr);
      e.nType.should.equal(MnType.Evo);
      e.proRegTxHash.should.equal('11'.repeat(32));
      should.not.exist(e.service);
      e.address.host.should.equal('192.168.0.1');
      e.address.port.should.equal(9999);

      const p2p = e.netInfo.entries[NetInfoPurpose.PLATFORM_P2P];
      p2p[0].type.should.equal(NetInfoType.Service);
      p2p[0].service.host.should.equal('2001:db8::1');
      p2p[0].service.port.should.equal(26656);

      const https = e.netInfo.entries[NetInfoPurpose.PLATFORM_HTTPS];
      https.length.should.equal(2);
      https[0].should.deep.equal({ type: NetInfoType.Domain, domain: 'evo.example.org', port: 443 });
      https[1].should.deep.equal({ type: NetInfoType.Invalid });

      e.platformHTTPPort.should.equal(443);
      e.platformNodeID.should.equal('131211100f0e0d0c0b0a09080706050403020100');
    });

    it('round-trips and hashes without the leading nVersion', function () {
      const diff = MnListDiff.fromBytes(payload);
      bytesToHex(diff.toBytes()).should.equal(bytesToHex(payload));
      const expected = sha256d(hexToBytes(entryHex.slice(4)));
      bytesToHex(MnListDiff.calcEntryHash(diff.mnList[0])).should.equal(bytesToHex(expected));
      // single-leaf tree: root is the leaf hash
      MnListDiff.calcMerkleRootMNList(diff.mnList).should.equal(bytesToHex(expected.slice().reverse()));
    });
  });

  describe('errors', function () {
    it('throws on truncated data', function () {
      (() => MnListDiff.fromBytes(mainnetFull.subarray(0, mainnetFull.length - 1))).should.throw(/unexpected end of data|exceeds remaining data/);
    });

    it('does not read past the end of a view into a larger buffer', function () {
      const bigger = new Uint8Array(testnetSmall.length + 64);
      bigger.set(testnetSmall);
      (() => MnListDiff.fromBytes(bigger.subarray(0, testnetSmall.length - 10))).should.throw(/unexpected end of data/);
    });

    it('throws on trailing bytes', function () {
      const extra = new Uint8Array(testnetSmall.length + 1);
      extra.set(testnetSmall);
      (() => MnListDiff.fromBytes(extra)).should.throw(/trailing/);
    });

    it('rejects protocol versions with a different layout', function () {
      (() => MnListDiff.fromBytes(testnetSmall, 70229)).should.throw(/not supported/);
    });
  });

  describe('MnListDiffMessage', function () {
    it('parses through Messages.parseBytes', function () {
      const messages = new Messages();
      const result = messages.parseBytes(hexToBytes(Data.mnlistdiff.message));
      should.not.exist(result.error);
      result.message.command.should.equal('mnlistdiff');
      result.message.mnlistdiff.newQuorums.length.should.equal(14);
    });
  });
});
