import { Transaction, utils as sdkUtils } from 'dash-core-sdk';
import { BufferReader } from './encoding/BufferReader.js';
import { BufferWriter } from './encoding/BufferWriter.js';
import { bytesToHex, hexToBytes, reverseBytes } from './utils/binary.js';

const { doubleSHA256 } = sdkUtils;

/**
 * Lowest protocol version whose mnlistdiff layout this module implements:
 * versioned SML entries (70228), leading diff nVersion (70229) and
 * quorumsCLSigs (70230). See Dash Core src/evo/smldiff.h, src/evo/simplifiedmns.h.
 */
export const MNLISTDIFF_MIN_PROTOCOL_VERSION = 70230;

const DEFAULT_PROTOCOL_VERSION = 70238;

export const ProTxVersion = {
  LegacyBLS: 1,
  BasicBLS: 2,
  ExtAddr: 3,
} as const;

export const MnType = {
  Regular: 0,
  Evo: 1,
} as const;

export const NetInfoPurpose = {
  CORE_P2P: 0,
  PLATFORM_P2P: 1,
  PLATFORM_HTTPS: 2,
} as const;

export const NetInfoType = {
  Service: 0x01,
  Domain: 0x02,
  Invalid: 0xff,
} as const;

/** BIP155 network ids used by addrv2-encoded services. */
const NET_IPV4 = 0x01;
const NET_IPV6 = 0x02;
const NET_CJDNS = 0x06;

/** Only ExtNetInfo version 1 has a known body; Core stops reading for anything else. */
const EXT_NETINFO_VERSION = 1;

/**
 * A network service address.
 * `host` is a printable IPv4/IPv6 address, or null for network types
 * that aren't decoded here (Tor, I2P, ...); `addr` always has the raw bytes.
 */
export interface NetAddress {
  networkId: number; // BIP155 network id (1 = IPv4, 2 = IPv6, ...)
  addr: Uint8Array;
  host: string | null;
  port: number;
}

export type NetInfoEntry =
  | { type: typeof NetInfoType.Service; service: NetAddress }
  | { type: typeof NetInfoType.Domain; domain: string; port: number }
  | { type: typeof NetInfoType.Invalid };

/** Extended network info (ProTx nVersion >= 3), entries grouped by NetInfoPurpose. */
export interface ExtNetInfo {
  version: number;
  entries: Partial<Record<number, NetInfoEntry[]>>;
}

export interface SimplifiedMNListEntry {
  nVersion: number;      // ProTxVersion
  proRegTxHash: string;  // 32-byte hash, hex, display order
  confirmedHash: string; // 32-byte hash, hex, display order
  /** Raw legacy CService, 16-byte IPv6 (v4-mapped) address + 2-byte big-endian port. Only for nVersion < 3. */
  service?: Uint8Array;
  /** Extended network info. Only for nVersion >= 3. */
  netInfo?: ExtNetInfo;
  /**
   * Core P2P address: the legacy `service` for nVersion < 3, otherwise the
   * first CORE_P2P Service entry of `netInfo`. Null if there is none.
   */
  address: NetAddress | null;
  pubKeyOperator: string; // 48-byte BLS public key, hex
  keyIDVoting: string;    // 20-byte key id, hex, wire order
  isValid: boolean;
  nType: number;          // MnType; always Regular for nVersion 1
  /**
   * Evo nodes only. Read from the entry for nVersion < 3; for nVersion >= 3
   * it is the port of the first PLATFORM_HTTPS entry of `netInfo` (not serialized).
   */
  platformHTTPPort?: number;
  platformNodeID?: string; // Evo nodes only. 20 bytes, hex, display order (as in `protx info`)
}

export interface DeletedQuorum {
  llmqType: number;
  quorumHash: string; // 32-byte hash, hex, display order
}

/** CFinalCommitment, see Dash Core src/llmq/commitment.h. */
export interface FinalCommitment {
  nVersion: number;
  llmqType: number;
  quorumHash: string; // display order
  quorumIndex?: number; // only for indexed versions (2 and 4)
  signers: boolean[];
  validMembers: boolean[];
  quorumPublicKey: string; // 48 bytes, hex
  quorumVvecHash: string;  // display order
  quorumSig: string;       // 96 bytes, hex
  membersSig: string;      // 96 bytes, hex
}

export interface QuorumCLSig {
  signature: string; // 96-byte BLS signature, hex
  indexSet: number[]; // indexes into newQuorums
}

const INDEXED_QUORUM_VERSIONS = new Set([2, 4]);

/**
 * BufferReader that throws instead of silently reading past the end.
 * Payloads are usually views into a larger receive buffer, so an overrun
 * would otherwise read the next message's bytes.
 */
class StrictReader extends BufferReader {
  private readonly length: number;

  constructor(buf: Uint8Array) {
    super(buf);
    this.length = buf.length;
  }

  private need(n: number): void {
    if (this.pos + n > this.length) {
      throw new Error(`mnlistdiff: unexpected end of data (need ${n} bytes at offset ${this.pos}, have ${this.length - this.pos})`);
    }
  }

  remaining(): number {
    return this.length - this.pos;
  }

  override read(len: number): Uint8Array { this.need(len); return super.read(len); }
  override readUInt8(): number { this.need(1); return super.readUInt8(); }
  override readUInt16LE(): number { this.need(2); return super.readUInt16LE(); }
  override readUInt16BE(): number { this.need(2); return super.readUInt16BE(); }
  override readInt16LE(): number { this.need(2); return super.readInt16LE(); }
  override readUInt32LE(): number { this.need(4); return super.readUInt32LE(); }
  override readInt32LE(): number { this.need(4); return super.readInt32LE(); }
  override readUInt64LE(): bigint { this.need(8); return super.readUInt64LE(); }

  /** Read a vector length and sanity-check it against the bytes left. */
  readCount(minItemSize: number): number {
    const n = this.readVarintNum();
    if (n * minItemSize > this.remaining()) {
      throw new Error(`mnlistdiff: vector size ${n} exceeds remaining data`);
    }
    return n;
  }

  readHashDisplay(): string {
    return bytesToHex(reverseBytes(this.read(32)));
  }
}

function writeHashDisplay(bw: BufferWriter, hash: string): void {
  bw.write(reverseBytes(hexToBytes(hash)));
}

function formatIPv6(addr: Uint8Array): string {
  const isV4Mapped = addr.subarray(0, 10).every((b) => b === 0) && addr[10] === 0xff && addr[11] === 0xff;
  if (isV4Mapped) {
    return Array.from(addr.subarray(12, 16)).join('.');
  }
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((addr[i]! << 8) | addr[i + 1]!).toString(16));
  }
  // Compress the longest run of zero groups (RFC 5952)
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== '0') { i++; continue; }
    let j = i;
    while (j < 8 && groups[j] === '0') j++;
    if (j - i > bestLen && j - i > 1) { bestStart = i; bestLen = j - i; }
    i = j;
  }
  if (bestStart === -1) return groups.join(':');
  return groups.slice(0, bestStart).join(':') + '::' + groups.slice(bestStart + bestLen).join(':');
}

function formatHost(networkId: number, addr: Uint8Array): string | null {
  if (networkId === NET_IPV4 && addr.length === 4) return Array.from(addr).join('.');
  if ((networkId === NET_IPV6 || networkId === NET_CJDNS) && addr.length === 16) return formatIPv6(addr);
  return null;
}

/** Legacy CService: 16-byte IPv6 (v4-mapped) address + uint16 big-endian port. */
function parseLegacyService(service: Uint8Array): NetAddress | null {
  const addr = service.subarray(0, 16);
  const port = (service[16]! << 8) | service[17]!;
  if (addr.every((b) => b === 0) && port === 0) return null;
  const isV4Mapped = addr.subarray(0, 10).every((b) => b === 0) && addr[10] === 0xff && addr[11] === 0xff;
  return isV4Mapped
    ? { networkId: NET_IPV4, addr: addr.slice(12, 16), host: formatIPv6(addr), port }
    : { networkId: NET_IPV6, addr: addr.slice(), host: formatIPv6(addr), port };
}

function readNetInfoEntry(r: StrictReader): NetInfoEntry {
  const type = r.readUInt8();
  switch (type) {
    case NetInfoType.Service: {
      const networkId = r.readUInt8();
      const addr = r.read(r.readCount(1)).slice();
      const port = r.readUInt16BE();
      return { type, service: { networkId, addr, host: formatHost(networkId, addr), port } };
    }
    case NetInfoType.Domain: {
      const domain = new TextDecoder().decode(r.read(r.readCount(1)));
      const port = r.readUInt16BE();
      return { type, domain, port };
    }
    case NetInfoType.Invalid:
      return { type };
    default:
      throw new Error(`mnlistdiff: unknown NetInfoEntry type 0x${type.toString(16)}`);
  }
}

function writeNetInfoEntry(bw: BufferWriter, entry: NetInfoEntry): void {
  bw.writeUInt8(entry.type);
  if (entry.type === NetInfoType.Service) {
    bw.writeUInt8(entry.service.networkId);
    bw.writeVarintNum(entry.service.addr.length);
    bw.write(entry.service.addr);
    bw.writeUInt16BE(entry.service.port);
  } else if (entry.type === NetInfoType.Domain) {
    const domain = new TextEncoder().encode(entry.domain);
    bw.writeVarintNum(domain.length);
    bw.write(domain);
    bw.writeUInt16BE(entry.port);
  }
}

function readExtNetInfo(r: StrictReader): ExtNetInfo {
  const version = r.readUInt8();
  const netInfo: ExtNetInfo = { version, entries: {} };
  if (version !== EXT_NETINFO_VERSION) {
    return netInfo; // Core serializes nothing else for unknown versions
  }
  const purposes = r.readCount(2);
  for (let i = 0; i < purposes; i++) {
    const purpose = r.readUInt8();
    const count = r.readCount(1);
    const list: NetInfoEntry[] = [];
    for (let j = 0; j < count; j++) {
      list.push(readNetInfoEntry(r));
    }
    netInfo.entries[purpose] = list;
  }
  return netInfo;
}

function writeExtNetInfo(bw: BufferWriter, netInfo: ExtNetInfo): void {
  bw.writeUInt8(netInfo.version);
  if (netInfo.version !== EXT_NETINFO_VERSION) return;
  // std::map order: ascending purpose
  const purposes = Object.keys(netInfo.entries).map(Number).sort((a, b) => a - b);
  bw.writeVarintNum(purposes.length);
  for (const purpose of purposes) {
    const list = netInfo.entries[purpose]!;
    bw.writeUInt8(purpose);
    bw.writeVarintNum(list.length);
    for (const entry of list) writeNetInfoEntry(bw, entry);
  }
}

function firstService(netInfo: ExtNetInfo, purpose: number): NetInfoEntry | undefined {
  return netInfo.entries[purpose]?.find((e) => e.type !== NetInfoType.Invalid);
}

function readSMLEntry(r: StrictReader): SimplifiedMNListEntry {
  const nVersion = r.readUInt16LE();
  if (nVersion < ProTxVersion.LegacyBLS || nVersion > ProTxVersion.ExtAddr) {
    throw new Error(`mnlistdiff: unsupported SML entry version ${nVersion}`);
  }
  const proRegTxHash = r.readHashDisplay();
  const confirmedHash = r.readHashDisplay();

  let service: Uint8Array | undefined;
  let netInfo: ExtNetInfo | undefined;
  let address: NetAddress | null = null;
  if (nVersion >= ProTxVersion.ExtAddr) {
    netInfo = readExtNetInfo(r);
    const core = firstService(netInfo, NetInfoPurpose.CORE_P2P);
    if (core?.type === NetInfoType.Service) address = core.service;
  } else {
    service = r.read(18).slice();
    address = parseLegacyService(service);
  }

  const entry: SimplifiedMNListEntry = {
    nVersion,
    proRegTxHash,
    confirmedHash,
    ...(service ? { service } : {}),
    ...(netInfo ? { netInfo } : {}),
    address,
    pubKeyOperator: bytesToHex(r.read(48)),
    keyIDVoting: bytesToHex(r.read(20)),
    isValid: r.readUInt8() !== 0,
    nType: MnType.Regular,
  };

  if (nVersion >= ProTxVersion.BasicBLS) {
    entry.nType = r.readUInt16LE();
    if (entry.nType === MnType.Evo) {
      if (nVersion < ProTxVersion.ExtAddr) {
        entry.platformHTTPPort = r.readUInt16LE();
      } else {
        const https = firstService(netInfo!, NetInfoPurpose.PLATFORM_HTTPS);
        if (https?.type === NetInfoType.Service) entry.platformHTTPPort = https.service.port;
        else if (https?.type === NetInfoType.Domain) entry.platformHTTPPort = https.port;
      }
      entry.platformNodeID = bytesToHex(reverseBytes(r.read(20)));
    }
  }
  return entry;
}

/**
 * Serialize an SML entry. With `forHash`, the leading nVersion is omitted,
 * matching Core's SER_GETHASH serialization used for merkleRootMNList.
 */
function writeSMLEntry(bw: BufferWriter, entry: SimplifiedMNListEntry, forHash = false): void {
  if (!forHash) bw.writeUInt16LE(entry.nVersion);
  writeHashDisplay(bw, entry.proRegTxHash);
  writeHashDisplay(bw, entry.confirmedHash);
  if (entry.nVersion >= ProTxVersion.ExtAddr) {
    if (!entry.netInfo) throw new Error('mnlistdiff: netInfo is required for entry nVersion >= 3');
    writeExtNetInfo(bw, entry.netInfo);
  } else {
    bw.write(entry.service ?? new Uint8Array(18));
  }
  bw.write(hexToBytes(entry.pubKeyOperator));
  bw.write(hexToBytes(entry.keyIDVoting));
  bw.writeUInt8(entry.isValid ? 1 : 0);
  if (entry.nVersion >= ProTxVersion.BasicBLS) {
    bw.writeUInt16LE(entry.nType);
    if (entry.nType === MnType.Evo) {
      if (entry.nVersion < ProTxVersion.ExtAddr) bw.writeUInt16LE(entry.platformHTTPPort ?? 0);
      bw.write(reverseBytes(hexToBytes(entry.platformNodeID ?? '0'.repeat(40))));
    }
  }
}

/** DYNBITSET: compactSize bit count, then ceil(n / 8) bytes, LSB first. */
function readBitSet(r: StrictReader): boolean[] {
  const size = r.readVarintNum();
  const bytes = r.read(Math.ceil(size / 8));
  const bits: boolean[] = [];
  for (let i = 0; i < size; i++) {
    bits.push((bytes[i >> 3]! & (1 << (i & 7))) !== 0);
  }
  return bits;
}

function writeBitSet(bw: BufferWriter, bits: boolean[]): void {
  bw.writeVarintNum(bits.length);
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, i) => { if (bit) bytes[i >> 3]! |= 1 << (i & 7); });
  bw.write(bytes);
}

function readFinalCommitment(r: StrictReader): FinalCommitment {
  const nVersion = r.readUInt16LE();
  const llmqType = r.readUInt8();
  const quorumHash = r.readHashDisplay();
  const quorumIndex = INDEXED_QUORUM_VERSIONS.has(nVersion) ? r.readInt16LE() : undefined;
  return {
    nVersion,
    llmqType,
    quorumHash,
    ...(quorumIndex !== undefined ? { quorumIndex } : {}),
    signers: readBitSet(r),
    validMembers: readBitSet(r),
    quorumPublicKey: bytesToHex(r.read(48)),
    quorumVvecHash: r.readHashDisplay(),
    quorumSig: bytesToHex(r.read(96)),
    membersSig: bytesToHex(r.read(96)),
  };
}

function writeFinalCommitment(bw: BufferWriter, q: FinalCommitment): void {
  bw.writeUInt16LE(q.nVersion);
  bw.writeUInt8(q.llmqType);
  writeHashDisplay(bw, q.quorumHash);
  if (INDEXED_QUORUM_VERSIONS.has(q.nVersion)) bw.writeInt16LE(q.quorumIndex ?? 0);
  writeBitSet(bw, q.signers);
  writeBitSet(bw, q.validMembers);
  bw.write(hexToBytes(q.quorumPublicKey));
  writeHashDisplay(bw, q.quorumVvecHash);
  bw.write(hexToBytes(q.quorumSig));
  bw.write(hexToBytes(q.membersSig));
}

/** Length of the serialized transaction starting at the reader's position. */
function measureTransaction(r: StrictReader): number {
  const start = r.pos;
  const nVersionAndType = r.readUInt32LE();
  const version = nVersionAndType & 0xffff;
  const type = nVersionAndType >>> 16;
  const inputs = r.readCount(41);
  for (let i = 0; i < inputs; i++) {
    r.read(36);
    r.read(r.readCount(1));
    r.read(4);
  }
  const outputs = r.readCount(9);
  for (let i = 0; i < outputs; i++) {
    r.read(8);
    r.read(r.readCount(1));
  }
  r.read(4);
  if (version >= 3 && type !== 0) {
    r.read(r.readCount(1));
  }
  const length = r.pos - start;
  r.pos = start;
  return length;
}

/**
 * Represents the payload of a mnlistdiff message.
 * Encodes the diff of a simplified masternode list between two blocks.
 *
 * Hashes are hex strings in display order (as shown by RPC and explorers).
 */
export class MnListDiff {
  nVersion: number = 1;
  baseBlockHash: string = '';
  blockHash: string = '';
  totalTransactions: number = 0;
  merkleHashes: string[] = [];
  merkleFlags: number[] = [];
  cbTx: Transaction = new Transaction();
  deletedMNs: string[] = [];
  mnList: SimplifiedMNListEntry[] = [];
  deletedQuorums: DeletedQuorum[] = [];
  newQuorums: FinalCommitment[] = [];
  quorumsCLSigs: QuorumCLSig[] = [];

  /** Exact cbTx bytes as received; used by toBytes() so round-tripping is lossless. */
  cbTxBytes: Uint8Array | undefined;

  static fromBytes(payload: Uint8Array, protocolVersion: number = DEFAULT_PROTOCOL_VERSION): MnListDiff {
    if (protocolVersion < MNLISTDIFF_MIN_PROTOCOL_VERSION) {
      throw new Error(`mnlistdiff: protocol version ${protocolVersion} is not supported (need >= ${MNLISTDIFF_MIN_PROTOCOL_VERSION})`);
    }

    const diff = new MnListDiff();
    const reader = new StrictReader(payload);

    diff.nVersion = reader.readUInt16LE();
    diff.baseBlockHash = reader.readHashDisplay();
    diff.blockHash = reader.readHashDisplay();

    diff.totalTransactions = reader.readUInt32LE();

    const merkleHashesCount = reader.readCount(32);
    for (let i = 0; i < merkleHashesCount; i++) {
      diff.merkleHashes.push(reader.readHashDisplay());
    }

    const merkleFlagsCount = reader.readCount(1);
    for (let i = 0; i < merkleFlagsCount; i++) {
      diff.merkleFlags.push(reader.readUInt8());
    }

    // .slice() gives a fresh copy with byteOffset=0, as Transaction.fromBytes expects.
    const cbTxLength = measureTransaction(reader);
    diff.cbTxBytes = reader.read(cbTxLength).slice();
    diff.cbTx = Transaction.fromBytes(diff.cbTxBytes);

    const deletedMNsCount = reader.readCount(32);
    for (let i = 0; i < deletedMNsCount; i++) {
      diff.deletedMNs.push(reader.readHashDisplay());
    }

    const mnListSize = reader.readCount(2 + 64 + 18 + 48 + 20 + 1);
    for (let i = 0; i < mnListSize; i++) {
      diff.mnList.push(readSMLEntry(reader));
    }

    const deletedQuorumsCount = reader.readCount(33);
    for (let i = 0; i < deletedQuorumsCount; i++) {
      diff.deletedQuorums.push({
        llmqType: reader.readUInt8(),
        quorumHash: reader.readHashDisplay(),
      });
    }

    const newQuorumsCount = reader.readCount(2 + 1 + 32 + 1 + 1 + 48 + 32 + 96 + 96);
    for (let i = 0; i < newQuorumsCount; i++) {
      diff.newQuorums.push(readFinalCommitment(reader));
    }

    const clSigsCount = reader.readCount(97);
    for (let i = 0; i < clSigsCount; i++) {
      const signature = bytesToHex(reader.read(96));
      const indexCount = reader.readCount(2);
      const indexSet: number[] = [];
      for (let j = 0; j < indexCount; j++) {
        indexSet.push(reader.readUInt16LE());
      }
      diff.quorumsCLSigs.push({ signature, indexSet });
    }

    if (reader.remaining() !== 0) {
      throw new Error(`mnlistdiff: ${reader.remaining()} unexpected trailing bytes`);
    }

    return diff;
  }

  toBytes(): Uint8Array {
    const bw = new BufferWriter();

    bw.writeUInt16LE(this.nVersion);
    writeHashDisplay(bw, this.baseBlockHash);
    writeHashDisplay(bw, this.blockHash);

    bw.writeUInt32LE(this.totalTransactions);
    bw.writeVarintNum(this.merkleHashes.length);
    for (const hash of this.merkleHashes) {
      writeHashDisplay(bw, hash);
    }
    bw.writeVarintNum(this.merkleFlags.length);
    for (const flag of this.merkleFlags) {
      bw.writeUInt8(flag);
    }

    bw.write(this.cbTxBytes ?? this.cbTx.bytes());

    bw.writeVarintNum(this.deletedMNs.length);
    for (const hash of this.deletedMNs) {
      writeHashDisplay(bw, hash);
    }

    bw.writeVarintNum(this.mnList.length);
    for (const entry of this.mnList) {
      writeSMLEntry(bw, entry);
    }

    bw.writeVarintNum(this.deletedQuorums.length);
    for (const q of this.deletedQuorums) {
      bw.writeUInt8(q.llmqType);
      writeHashDisplay(bw, q.quorumHash);
    }

    bw.writeVarintNum(this.newQuorums.length);
    for (const q of this.newQuorums) {
      writeFinalCommitment(bw, q);
    }

    bw.writeVarintNum(this.quorumsCLSigs.length);
    for (const sig of this.quorumsCLSigs) {
      bw.write(hexToBytes(sig.signature));
      bw.writeVarintNum(sig.indexSet.length);
      for (const index of sig.indexSet) bw.writeUInt16LE(index);
    }

    return bw.concat();
  }

  /** merkleRootMNList committed in the coinbase (display order), if present. */
  get merkleRootMNList(): string | undefined {
    return (this.cbTx.extraPayload as { merkleRootMNList?: string } | undefined)?.merkleRootMNList;
  }

  /**
   * Hash of a single entry as used in merkleRootMNList: sha256d of the entry
   * serialized without its leading nVersion (Core's SER_GETHASH). Wire order.
   */
  static calcEntryHash(entry: SimplifiedMNListEntry): Uint8Array {
    const bw = new BufferWriter();
    writeSMLEntry(bw, entry, true);
    return doubleSHA256(bw.concat());
  }

  /**
   * Merkle root over a full masternode list, in display order. Entries are
   * sorted by proRegTxHash (memcmp of wire bytes) as Core does. Compare with
   * `merkleRootMNList` on a diff from the zero base hash (a full list), or on
   * a list obtained by applying diffs.
   */
  static calcMerkleRootMNList(entries: SimplifiedMNListEntry[]): string {
    const sorted = entries
      .map((entry) => ({ key: reverseBytes(hexToBytes(entry.proRegTxHash)), entry }))
      .sort((a, b) => compareBytes(a.key, b.key));
    let level = sorted.map(({ entry }) => MnListDiff.calcEntryHash(entry));
    if (level.length === 0) return '0'.repeat(64);
    while (level.length > 1) {
      const next: Uint8Array[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i]!;
        const right = level[i + 1] ?? left;
        const pair = new Uint8Array(64);
        pair.set(left);
        pair.set(right, 32);
        next.push(doubleSHA256(pair));
      }
      level = next;
    }
    return bytesToHex(reverseBytes(level[0]!));
  }
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}
