import { Transaction } from 'dash-core-sdk';
import { BufferReader } from './encoding/BufferReader.js';
import { BufferWriter } from './encoding/BufferWriter.js';
import { bytesToHex, hexToBytes } from './utils/binary.js';
const SML_ENTRY_SIZE = 151;
/**
 * Represents the payload of a mnlistdiff message.
 * Encodes the diff of a simplified masternode list between two blocks.
 */
export class MnListDiff {
    baseBlockHash = '';
    blockHash = '';
    totalTransactions = 0;
    merkleHashes = [];
    merkleFlags = [];
    cbTx = new Transaction();
    deletedMNs = [];
    mnList = [];
    deletedQuorums = [];
    newQuorums = [];
    static fromBytes(payload) {
        const diff = new MnListDiff();
        const reader = new BufferReader(payload);
        diff.baseBlockHash = bytesToHex(reader.read(32).slice().reverse());
        diff.blockHash = bytesToHex(reader.read(32).slice().reverse());
        diff.totalTransactions = reader.readUInt32LE();
        const merkleHashesCount = reader.readVarintNum();
        diff.merkleHashes = [];
        for (let i = 0; i < merkleHashesCount; i++) {
            diff.merkleHashes.push(bytesToHex(reader.read(32).slice().reverse()));
        }
        const merkleFlagsCount = reader.readVarintNum();
        diff.merkleFlags = [];
        for (let i = 0; i < merkleFlagsCount; i++) {
            diff.merkleFlags.push(reader.readUInt8());
        }
        // cbTx is a self-delimiting transaction.
        // payload.slice() produces a fresh copy with byteOffset=0, required by Transaction.fromBytes.
        const cbTxStart = reader.pos;
        diff.cbTx = Transaction.fromBytes(payload.slice(cbTxStart));
        reader.pos += diff.cbTx.bytes().length;
        const deletedMNsCount = reader.readVarintNum();
        diff.deletedMNs = [];
        for (let i = 0; i < deletedMNsCount; i++) {
            diff.deletedMNs.push(bytesToHex(reader.read(32).slice().reverse()));
        }
        const mnListSize = reader.readVarintNum();
        diff.mnList = [];
        for (let i = 0; i < mnListSize; i++) {
            const entryBytes = reader.read(SML_ENTRY_SIZE);
            const er = new BufferReader(entryBytes);
            diff.mnList.push({
                proRegTxHash: bytesToHex(er.read(32).slice().reverse()),
                confirmedHash: bytesToHex(er.read(32).slice().reverse()),
                service: er.read(18),
                pubKeyOperator: bytesToHex(er.read(48)),
                keyIDVoting: bytesToHex(er.read(20)),
                isValid: er.readUInt8() !== 0,
            });
        }
        const deletedQuorumsCount = reader.readVarintNum();
        diff.deletedQuorums = [];
        for (let i = 0; i < deletedQuorumsCount; i++) {
            diff.deletedQuorums.push({
                llmqType: reader.readUInt8(),
                quorumHash: bytesToHex(reader.read(32).slice().reverse()),
            });
        }
        const newQuorumsCount = reader.readVarintNum();
        diff.newQuorums = [];
        for (let i = 0; i < newQuorumsCount; i++) {
            const entrySize = reader.readVarintNum();
            diff.newQuorums.push(reader.read(entrySize));
        }
        return diff;
    }
    toBytes() {
        const bw = new BufferWriter();
        bw.write(hexToBytes(this.baseBlockHash).slice().reverse());
        bw.write(hexToBytes(this.blockHash).slice().reverse());
        bw.writeUInt32LE(this.totalTransactions);
        bw.writeVarintNum(this.merkleHashes.length);
        for (const hash of this.merkleHashes) {
            bw.write(hexToBytes(hash).slice().reverse());
        }
        bw.writeVarintNum(this.merkleFlags.length);
        for (const flag of this.merkleFlags) {
            bw.writeUInt8(flag);
        }
        bw.write(this.cbTx.bytes());
        bw.writeVarintNum(this.deletedMNs.length);
        for (const hash of this.deletedMNs) {
            bw.write(hexToBytes(hash).slice().reverse());
        }
        bw.writeVarintNum(this.mnList.length);
        for (const entry of this.mnList) {
            bw.write(hexToBytes(entry.proRegTxHash).slice().reverse());
            bw.write(hexToBytes(entry.confirmedHash).slice().reverse());
            bw.write(entry.service);
            bw.write(hexToBytes(entry.pubKeyOperator));
            bw.write(hexToBytes(entry.keyIDVoting));
            bw.writeUInt8(entry.isValid ? 1 : 0);
        }
        bw.writeVarintNum(this.deletedQuorums.length);
        for (const q of this.deletedQuorums) {
            bw.writeUInt8(q.llmqType);
            bw.write(hexToBytes(q.quorumHash).slice().reverse());
        }
        bw.writeVarintNum(this.newQuorums.length);
        for (const entry of this.newQuorums) {
            bw.writeVarintNum(entry.length);
            bw.write(entry);
        }
        return bw.concat();
    }
}
//# sourceMappingURL=MnListDiff.js.map