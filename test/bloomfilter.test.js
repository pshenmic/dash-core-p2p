import chai from 'chai';
import assert from 'assert';
import { createRequire } from 'module';
import { PrivateKey, utils as sdkUtils } from 'dash-core-sdk';
import { BloomFilter } from '../dist/BloomFilter.js';
import { hexToBytes } from '../dist/utils/binary.js';

const { SHA256RIPEMD160 } = sdkUtils;

const require = createRequire(import.meta.url);
const Data = require('./data/messages.json');

const should = chai.should();

function getPayloadBuffer(messageBuffer) {
  return hexToBytes(messageBuffer.slice(48));
}

describe('BloomFilter', function () {
  it('#fromBytes and #toBytes round trip', function () {
    const testPayloadBuffer = getPayloadBuffer(Data.filterload.message);
    const filter = BloomFilter.fromBytes(testPayloadBuffer);
    filter.toBytes().should.deep.equal(testPayloadBuffer);
  });

  it('serialize filter with public keys added', function () {
    const privateKey = PrivateKey.fromWIF('7sQb6QHALg4XyHsJHsSNXnEHGhZfzTTUPJXJqaqK7CavQkiL9Ms');
    const publicKey = privateKey.getPublicKey();

    const filter = BloomFilter.create(2, 0.001, 0, BloomFilter.BLOOM_UPDATE_ALL);
    filter.insert(publicKey.bytes());
    filter.insert(SHA256RIPEMD160(publicKey.bytes()));

    const expectedFilter = BloomFilter.fromBytes(hexToBytes('038fc16b080000000000000001'));
    filter.toBytes().should.deep.equal(expectedFilter.toBytes());
  });

  it('serialize to a buffer', function () {
    const filter = BloomFilter.create(3, 0.01, 0, BloomFilter.BLOOM_UPDATE_ALL);

    filter.insert(hexToBytes('99108ad8ed9bb6274d3980bab5a85c048f0950c8'));
    assert(filter.contains(hexToBytes('99108ad8ed9bb6274d3980bab5a85c048f0950c8')));
    assert(!filter.contains(hexToBytes('19108ad8ed9bb6274d3980bab5a85c048f0950c8')));
    filter.insert(hexToBytes('b5a2c786d9ef4658287ced5914b37a1b4aa32eee'));
    assert(filter.contains(hexToBytes('b5a2c786d9ef4658287ced5914b37a1b4aa32eee')));
    filter.insert(hexToBytes('b9300670b4c5366e95b2699e8b18bc75e5f729c5'));
    assert(filter.contains(hexToBytes('b9300670b4c5366e95b2699e8b18bc75e5f729c5')));

    const actual = filter.toBytes();
    const expected = hexToBytes('03614e9b050000000000000001');
    actual.should.deep.equal(expected);
  });

  it('deserialize a buffer', function () {
    const buffer = hexToBytes('03614e9b050000000000000001');
    const filter = BloomFilter.fromBytes(buffer);

    assert(filter.contains(hexToBytes('99108ad8ed9bb6274d3980bab5a85c048f0950c8')));
    assert(!filter.contains(hexToBytes('19108ad8ed9bb6274d3980bab5a85c048f0950c8')));
    assert(filter.contains(hexToBytes('b5a2c786d9ef4658287ced5914b37a1b4aa32eee')));
    assert(filter.contains(hexToBytes('b9300670b4c5366e95b2699e8b18bc75e5f729c5')));
  });

  it('#toBytes and #fromBytes round trip, with a large filter', function () {
    const filter = BloomFilter.create(10000, 0.001);
    const buffer = filter.toBytes();
    BloomFilter.fromBytes(buffer).should.deep.equal(filter);
  });
});
