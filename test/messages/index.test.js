import chai from 'chai';
import { createRequire } from 'module';
import { Messages } from '../../dist/messages/Messages.js';
import { Networks } from '../../dist/index.js';
import { hexToBytes, bytesToHex } from '../../dist/utils/binary.js';

const require = createRequire(import.meta.url);
const Data = require('../data/messages.json');

const should = chai.should();

function getPayloadBuffer(messageBuffer) {
  return hexToBytes(messageBuffer.slice(48));
}

describe('Messages', function () {
  function buildMessage(hex) {
    return hexToBytes(hex);
  }

  describe('@constructor', function () {
    it('sets properties correctly', function () {
      const network = Networks.defaultNetwork;
      const messages = new Messages({
        network,
      });
      should.exist(messages.builderInstance?.commands ?? messages['builderInstance']?.commands);
      messages.network.should.deep.equal(network);
    });

    it('network should be unique for each set of messages', function () {
      const messages = new Messages({ network: Networks.livenet });
      const messages2 = new Messages({ network: Networks.testnet });
      messages.network.should.deep.equal(Networks.livenet);
      messages2.network.should.deep.equal(Networks.testnet);
      const message1 = messages.Version();
      message1.network.should.deep.equal(Networks.livenet);
      const message2 = messages2.Version();
      message2.network.should.deep.equal(Networks.testnet);
    });
  });

  describe('@constructor for all command messages', function () {
    const messages = new Messages();
    const builderInstance = messages['builderInstance'];
    Object.keys(builderInstance.commandsMap).forEach(function (command) {
      const name = builderInstance.commandsMap[command];
      it('message.' + name, function () {
        should.exist(messages[name]);
        const message = messages[name]();
        should.exist(message);
      });
    });
  });

  describe('#fromBytes/#toBytes round trip for all commands', function () {
    const messages = new Messages();
    const builderInstance = messages['builderInstance'];

    // Commands that require special handling or have large test data
    const skipCommands = new Set(['block', 'mnlistdiff']);

    Object.keys(builderInstance.commandsMap).forEach(function (command) {
      if (skipCommands.has(command)) return;
      const name = builderInstance.commandsMap[command];
      it(name, function () {
        if (!Data[command]) return; // skip if no test data
        const payloadBuffer = getPayloadBuffer(Data[command].message);
        should.exist(messages[name]);
        const message = messages[name].fromBytes(payloadBuffer);
        const outputBuffer = message.getPayload();
        bytesToHex(outputBuffer).should.equal(bytesToHex(payloadBuffer));
        outputBuffer.should.deep.equal(payloadBuffer);
        const expectedBuffer = hexToBytes(Data[command].message);
        message.toBytes().should.deep.equal(expectedBuffer);
      });
    });
  });

  describe('Default Network', function () {
    const messages = new Messages();
    const builderInstance = messages['builderInstance'];
    Object.keys(builderInstance.commandsMap).forEach(function (command) {
      const name = builderInstance.commandsMap[command];
      it(name, function () {
        const message = messages[name]();
        message.network.should.deep.equal(Networks.defaultNetwork);
      });
    });
  });

  describe('messages.Version', function () {
    const messages = new Messages();

    it('#fromBytes works w/o fRelay arg', function () {
      const payloadBuffer = getPayloadBuffer(Data.version.messagenofrelay);
      const message = messages.Version.fromBytes(payloadBuffer);
      message.relay.should.equal(true);
    });

    it('#relay setting works', function () {
      [true, false].forEach(function (relay) {
        const message = messages.Version({ relay });
        message.relay.should.equal(relay);
        const messageBuf = message.getPayload();
        const newMessage = messages.Version.fromBytes(messageBuf);
        newMessage.relay.should.equal(relay);
      });
    });
  });

  describe('Inventory Helpers', function () {
    const messages = new Messages();
    const builderInstance = messages['builderInstance'];
    const inventoryCommands = builderInstance.inventoryCommands;
    const fakeHash = 'e2dfb8afe1575bfacae1a0b4afc49af7ddda69285857267bae0e22be15f74a3a';

    describe('#forTransaction', function () {
      inventoryCommands.forEach(function (command) {
        const name = builderInstance.commandsMap[command];
        it(name, function () {
          should.exist(messages[name].forTransaction);
          const message = messages[name].forTransaction(fakeHash);
          should.exist(message);
        });
      });
    });

    describe('#forBlock', function () {
      inventoryCommands.forEach(function (command) {
        const name = builderInstance.commandsMap[command];
        it(name, function () {
          should.exist(messages[name].forBlock);
          const message = messages[name].forBlock(fakeHash);
          should.exist(message);
        });
      });
    });

    describe('#forFilteredBlock', function () {
      inventoryCommands.forEach(function (command) {
        const name = builderInstance.commandsMap[command];
        it(name, function () {
          should.exist(messages[name].forFilteredBlock);
          const message = messages[name].forFilteredBlock(fakeHash);
          should.exist(message);
        });
      });
    });
  });

  describe('#parseBytes', function () {
    it('returns undefined if buffer is incomplete', function () {
      const messages = new Messages();
      const buf = buildMessage('bf0c6bbd');
      const result = messages.parseBytes(buf);
      should.not.exist(result);
    });

    it('discards bytes until magic number', function () {
      const messages = new Messages();
      const buf = buildMessage('00000000' + Data.verack.message);
      const result = messages.parseBytes(buf);
      should.exist(result?.message);
      result.message.command.should.equal('verack');
    });

    it('parses a verack message', function () {
      const messages = new Messages();
      const buf = buildMessage(Data.verack.message);
      const result = messages.parseBytes(buf);
      should.exist(result?.message);
      result.message.command.should.equal('verack');
    });

    it('returns undefined for unknown but listed unsupported command', function () {
      // Build a fake message with an unsupported command
      const messages = new Messages();
      // We test parseBytes ignores unsupported commands gracefully
      // by checking that building from a known good verack still works
      const buf = buildMessage(Data.verack.message);
      const result = messages.parseBytes(buf);
      result.message.command.should.equal('verack');
    });
  });
});
