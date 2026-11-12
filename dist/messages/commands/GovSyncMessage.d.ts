import { Message, MessageOptions } from '../Message.js';
import { BloomFilter } from '../../BloomFilter.js';
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
export declare class GovSyncMessage extends Message {
    parentHash: string;
    filter: BloomFilter;
    constructor(arg: GovSyncArgs | undefined, options: MessageOptions);
    /** True when this requests the object list rather than one object's votes. */
    get isObjectListRequest(): boolean;
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
