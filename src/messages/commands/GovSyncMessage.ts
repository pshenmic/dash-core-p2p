import { Message, MessageOptions } from '../Message.js';
import { BloomFilter } from '../../BloomFilter.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';
import { bytesToHex, hexToBytes, reverseBytes } from '../../utils/binary.js';

export interface GovSyncArgs {
  /**
   * Governance object hash (display order) whose votes to sync. Omit (or
   * pass the zero hash) to request the object list.
   */
  parentHash?: string;
  /**
   * Bloom filter of vote hashes the requester already has; the peer skips
   * matching votes. Ignored by Core for object-list requests.
   *
   * Defaults to Core's empty filter for the object list, and to a one-byte
   * zeroed filter for vote requests: a filter with no data matches every
   * hash, so Core would skip every vote.
   */
  filter?: BloomFilter;
}

const ZERO_HASH = '0'.repeat(64);

/**
 * Governance sync request (`govsync`).
 *
 * With a zero parentHash the peer answers with `inv`s of every governance
 * object (MSG_GOVERNANCE_OBJECT) followed by `ssc`; with an object hash it
 * announces that object's votes (MSG_GOVERNANCE_OBJECT_VOTE). The items are
 * then fetched with `getdata`. Core rate-limits object-list requests per peer.
 *
 * Wire format: uint256 parentHash, CBloomFilter (vData, nHashFuncs, nTweak, nFlags).
 */
export class GovSyncMessage extends Message {
  parentHash: string;
  filter: BloomFilter;

  constructor(arg: GovSyncArgs | undefined, options: MessageOptions) {
    super({ ...options, command: 'govsync' });
    const a = arg ?? {};
    if (a.filter != null && !(a.filter instanceof BloomFilter)) {
      throw new Error('An instance of BloomFilter is expected');
    }
    if (a.parentHash != null && !/^[0-9a-fA-F]{64}$/.test(a.parentHash)) {
      throw new Error('parentHash must be a 32-byte hex string');
    }
    this.parentHash = (a.parentHash ?? ZERO_HASH).toLowerCase();
    this.filter = a.filter ?? (this.isObjectListRequest
      ? BloomFilter.empty()
      : new BloomFilter(1, 0, BloomFilter.BLOOM_UPDATE_NONE, [0]));
  }

  /** True when this requests the object list rather than one object's votes. */
  get isObjectListRequest(): boolean {
    return this.parentHash === ZERO_HASH;
  }

  setPayload(payload: Uint8Array): void {
    if (payload.length < 32 + 1 + 4 + 4 + 1) {
      throw new Error('govsync: payload too short');
    }
    const r = new BufferReader(payload);
    this.parentHash = bytesToHex(reverseBytes(r.read(32)));
    const rest = r.readAll();
    this.filter = BloomFilter.fromBytes(rest);
    if (this.filter.toBytes().length !== rest.length) {
      throw new Error('govsync: malformed bloom filter');
    }
  }

  getPayload(): Uint8Array {
    const bw = new BufferWriter();
    bw.write(reverseBytes(hexToBytes(this.parentHash)));
    bw.write(this.filter.toBytes());
    return bw.concat();
  }
}
