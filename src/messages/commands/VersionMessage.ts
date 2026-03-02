import { Message, MessageOptions } from '../Message.js';
import { hexToBytes, bytesToHex, bytesToStr, strToBytes } from '../../utils/binary.js';
import { utils, type PeerAddr } from '../utils.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';

// Package version for subversion string
const PACKAGE_VERSION = '1.0.0';

export interface VersionMessageArgs {
  version?: number;
  nonce?: Uint8Array;
  services?: bigint;
  timestamp?: Date;
  subversion?: string;
  startHeight?: number;
  relay?: boolean;
  mnAuthChallenge?: string | null;
  addrMe?: PeerAddr;
  addrYou?: PeerAddr;
}

/**
 * The version message is used on connection creation to advertise the type of node.
 */
export class VersionMessage extends Message {
  version: number;
  nonce: Uint8Array;
  services: bigint;
  timestamp: Date;
  subversion: string;
  startHeight: number;
  relay: boolean;
  mnAuthChallenge: string | null;
  addrMe?: PeerAddr;
  addrYou?: PeerAddr;

  constructor(arg: VersionMessageArgs | undefined, options: MessageOptions) {
    super({ ...options, command: 'version' });
    const a = arg ?? {};
    this.version = a.version ?? (options.protocolVersion as number);
    this.nonce = a.nonce ?? utils.getNonce();
    this.services = a.services ?? 1n;
    this.timestamp = a.timestamp ?? new Date();
    this.subversion = a.subversion ?? '/dash-p2p:' + PACKAGE_VERSION + '/';
    this.startHeight = a.startHeight ?? 0;
    this.relay = a.relay !== false;
    this.mnAuthChallenge = a.mnAuthChallenge ?? null;
    this.addrMe = a.addrMe;
    this.addrYou = a.addrYou;
  }

  setPayload(payload: Uint8Array): void {
    const parser = new BufferReader(payload);
    this.version = parser.readUInt32LE();
    this.services = parser.readUInt64LE();
    this.timestamp = new Date(Number(parser.readUInt64LE()) * 1000);

    this.addrMe = {
      services: parser.readUInt64LE(),
      ip: utils.parseIP(parser),
      port: parser.readUInt16BE(),
    };
    this.addrYou = {
      services: parser.readUInt64LE(),
      ip: utils.parseIP(parser),
      port: parser.readUInt16BE(),
    };

    this.nonce = parser.read(8);
    this.subversion = bytesToStr(parser.readVarLengthBuffer());
    this.startHeight = parser.readUInt32LE();

    if (parser.finished()) {
      this.relay = true;
    } else {
      this.relay = !!parser.readUInt8();
    }

    if (parser.finished()) {
      this.mnAuthChallenge = null;
    } else if (this.version >= 70214) {
      this.mnAuthChallenge = bytesToHex(parser.read(32));
    }
  }

  getPayload(): Uint8Array {
    const bw = new BufferWriter();
    bw.writeUInt32LE(this.version);
    bw.writeUInt64LE(this.services);

    // Write 8-byte timestamp (LE, only lower 4 bytes used)
    const timestampBytes = new Uint8Array(8);
    new DataView(timestampBytes.buffer).setUint32(0, Math.round(this.timestamp.getTime() / 1000), true);
    bw.write(timestampBytes);

    utils.writeAddr(this.addrMe, bw);
    utils.writeAddr(this.addrYou, bw);
    bw.write(this.nonce);

    const subversionBytes = strToBytes(this.subversion);
    bw.writeVarintNum(subversionBytes.length);
    bw.write(subversionBytes);

    bw.writeUInt32LE(this.startHeight);
    bw.writeUInt8(this.relay ? 1 : 0);

    if (this.mnAuthChallenge) {
      bw.write(hexToBytes(this.mnAuthChallenge));
    }

    return bw.concat();
  }
}
