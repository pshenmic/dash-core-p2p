import { should as chaiShould } from 'chai';
import { Inventory } from '../dist/Inventory.js';
import { hexToBytes, bytesToHex, reverseBytes } from '../dist/utils/binary.js';
import { BufferWriter } from '../dist/encoding/BufferWriter.js';

const should = chaiShould();

describe('Inventory', function () {
  const hash = hexToBytes('eb951630aba498b9a0d10f72b5ea9e39d5ff04b03dc2231e662f52057f948aa1');
  const hashedStr = bytesToHex(reverseBytes(hash));
  const inventoryBuffer = hexToBytes(
    '01000000eb951630aba498b9a0d10f72b5ea9e39d5ff04b03dc2231e662f52057f948aa1',
  );

  describe('@constructor', function () {
    it('create inventory', function () {
      const inventory = new Inventory({ type: Inventory.TYPE.TX, hash });
      should.exist(inventory);
    });

    it('error with string hash', function () {
      (function () {
        const inventory = new Inventory({ type: Inventory.TYPE.TX, hash: hashedStr });
        should.not.exist(inventory);
      }).should.throw('Unexpected hash');
    });
  });

  describe('#forItem', function () {
    it('handle a string hash (reversed)', function () {
      const inventory = Inventory.forItem(Inventory.TYPE.TX, hashedStr);
      should.exist(inventory);
      inventory.hash.should.deep.equal(hash);
    });
  });

  describe('#forBlock', function () {
    it('use correct block type', function () {
      const inventory = Inventory.forBlock(hash);
      should.exist(inventory);
      inventory.type.should.equal(Inventory.TYPE.BLOCK);
    });
  });

  describe('#forFilteredBlock', function () {
    it('use correct filtered block type', function () {
      const inventory = Inventory.forFilteredBlock(hash);
      should.exist(inventory);
      inventory.type.should.equal(Inventory.TYPE.FILTERED_BLOCK);
    });
  });

  describe('#forTransaction', function () {
    it('use correct filtered tx type', function () {
      const inventory = Inventory.forTransaction(hash);
      should.exist(inventory);
      inventory.type.should.equal(Inventory.TYPE.TX);
    });
  });

  describe('#toBytes', function () {
    it('serialize correctly', function () {
      const inventory = Inventory.forTransaction(hash);
      const buffer = inventory.toBytes();
      buffer.should.deep.equal(inventoryBuffer);
    });
  });

  describe('#toBufferWriter', function () {
    it('write to a buffer writer', function () {
      const bw = new BufferWriter();
      const inventory = Inventory.forTransaction(hash);
      inventory.toBufferWriter(bw);
      bw.concat().should.deep.equal(inventoryBuffer);
    });
  });

  describe('#fromBytes', function () {
    it('deserialize a buffer', function () {
      const inventory = Inventory.fromBytes(inventoryBuffer);
      should.exist(inventory);
      inventory.type.should.equal(Inventory.TYPE.TX);
      inventory.hash.should.deep.equal(hash);
    });
  });

});
