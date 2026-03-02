import chai from 'chai';
import { Transaction, Block } from 'dash-core-sdk';
import { Messages } from '../../../dist/messages/Messages.js';
import { hexToBytes } from '../../../dist/utils/binary.js';

const should = chai.should();
const { expect } = chai;

describe('Command Messages', function () {
  const messages = new Messages();

  describe('Addr', function () {
    it('should error if arg is not an array of addrs', function () {
      (function () {
        messages.Addresses(['not an addr']);
      }).should.throw('First argument is expected to be an array of addrs');
    });

    it('should instantiate with an array of addrs', function () {
      const message = messages.Addresses([
        {
          ip: { v4: 'localhost', v6: '0000:0000:0000:0000:0000:0000:0000:0001' },
          services: 1n,
          port: 1234,
        },
      ]);
      should.exist(message);
    });
  });

  describe('Alert', function () {
    it('should accept payload and signature buffers', function () {
      const message = messages.Alert({
        payload: hexToBytes('abcdef'),
        signature: hexToBytes('123456'),
      });
      message.payload.should.deep.equal(hexToBytes('abcdef'));
      message.signature.should.deep.equal(hexToBytes('123456'));
    });
  });

  describe('Transaction', function () {
    it('should accept a transaction instance as an argument', function () {
      const tx = new Transaction();
      const message = messages.Transaction(tx);
      message.transaction.should.be.instanceof(Transaction);
    });

    it('should create a transaction instance', function () {
      const message = messages.Transaction();
      message.transaction.should.be.instanceof(Transaction);
    });

    it('version should remain the same', function () {
      const tx = new Transaction();
      const version = Number(tx.version);
      const message = messages.Transaction(tx);
      message.transaction.version.should.equal(version);
    });
  });

  describe('TXLockRequest', function () {
    it('should accept a transaction instance as an argument', function () {
      const tx = new Transaction();
      const message = messages.TXLockRequest(tx);
      message.transaction.should.be.instanceof(Transaction);
    });

    it('should create a transaction instance', function () {
      const message = messages.TXLockRequest();
      message.transaction.should.be.instanceof(Transaction);
    });

    it('version should remain the same', function () {
      const tx = new Transaction();
      const version = Number(tx.version);
      const message = messages.TXLockRequest(tx);
      message.transaction.version.should.equal(version);
    });
  });

  describe('Block', function () {
    it('should accept a block instance as an argument', function () {
      const block = new Block();
      const message = messages.Block(block);
      message.block.should.be.instanceof(Block);
    });
  });

  describe('Pong', function () {
    it('should error if nonce is not a buffer', function () {
      (function () {
        messages.Pong('not a buffer');
      }).should.throw('First argument is expected to be an 8 byte buffer');
    });

    it('should error if nonce buffer has invalid length', function () {
      (function () {
        messages.Pong(new Uint8Array(9));
      }).should.throw('First argument is expected to be an 8 byte buffer');
    });

    it('should set a nonce if not included', function () {
      const message = messages.Pong();
      should.exist(message.nonce);
      message.nonce.length.should.equal(8);
    });
  });

  describe('Ping', function () {
    it('should error if nonce is not a buffer', function () {
      (function () {
        messages.Ping('not a buffer');
      }).should.throw('First argument is expected to be an 8 byte buffer');
    });

    it('should error if nonce buffer has invalid length', function () {
      (function () {
        messages.Ping(new Uint8Array(9));
      }).should.throw('First argument is expected to be an 8 byte buffer');
    });

    it('should set a nonce if not included', function () {
      const message = messages.Ping();
      should.exist(message.nonce);
      message.nonce.length.should.equal(8);
    });
  });

  describe('FilterAdd', function () {
    it('should error if arg is not a buffer', function () {
      (function () {
        messages.FilterAdd('not a buffer');
      }).should.throw('First argument is expected to be a Uint8Array or undefined');
    });
  });

  describe('FilterLoad', function () {
    it('should return an empty payload when no filter', function () {
      const message = messages.FilterLoad();
      const payload = message.getPayload();
      payload.length.should.equal(0);
    });

    it('should error if filter is not a bloom filter', function () {
      (function () {
        messages.FilterLoad({ filter: 'not a bloom filter' });
      }).should.throw('An instance of BloomFilter');
    });
  });

  describe('Inventory', function () {
    it('should error if arg is not an array', function () {
      (function () {
        messages.Inventory({});
      }).should.throw('Argument is expected to be an array of inventory objects');
    });

    it('should not error if arg is an empty array', function () {
      const message = messages.Inventory([]);
      should.exist(message);
    });

    it('should error if inventory items are missing type', function () {
      (function () {
        messages.Inventory([{ hash: new Uint8Array(32) }]);
      }).should.throw('Argument is expected to be an array of inventory objects');
    });
  });

  describe('GetData', function () {
    it('should error if arg is not an array', function () {
      (function () {
        messages.GetData({});
      }).should.throw('Argument is expected to be an array of inventory objects');
    });
  });

  describe('NotFound', function () {
    it('should error if arg is not an array', function () {
      (function () {
        messages.NotFound({});
      }).should.throw('Argument is expected to be an array of inventory objects');
    });
  });

  describe('GetBlocks', function () {
    it('should create message with starts and stop', function () {
      const message = messages.GetBlocks({
        starts: [new Uint8Array(32)],
        stop: new Uint8Array(32),
      });
      should.exist(message);
      message.starts.length.should.equal(1);
    });
  });

  describe('GetHeaders', function () {
    it('should create message with starts and stop', function () {
      const message = messages.GetHeaders({
        starts: [new Uint8Array(32)],
        stop: new Uint8Array(32),
      });
      should.exist(message);
    });
  });

  describe('Reject', function () {
    it('should create a reject message', function () {
      const message = messages.Reject({
        message: 'tx',
        ccode: 0x12,
        reason: 'duplicate',
        data: new Uint8Array(0),
      });
      should.exist(message);
      message.command.should.equal('reject');
    });
  });

  describe('GetMnListDiff', function () {
    it('should create with hash arguments', function () {
      const baseHash = '0'.repeat(64);
      const blockHash = '1'.repeat(64);
      const message = messages.GetMnListDiff({ baseBlockHash: baseHash, blockHash });
      should.exist(message);
      message.baseBlockHash.should.equal(baseHash);
      message.blockHash.should.equal(blockHash);
    });
  });

  describe('VerAck', function () {
    it('should have empty payload', function () {
      const message = messages.VerAck();
      message.getPayload().length.should.equal(0);
    });
  });

  describe('MemPool', function () {
    it('should have empty payload', function () {
      const message = messages.MemPool();
      message.getPayload().length.should.equal(0);
    });
  });

  describe('GetAddr', function () {
    it('should have empty payload', function () {
      const message = messages.GetAddr();
      message.getPayload().length.should.equal(0);
    });
  });

  describe('FilterClear', function () {
    it('should have empty payload', function () {
      const message = messages.FilterClear();
      message.getPayload().length.should.equal(0);
    });
  });
});
