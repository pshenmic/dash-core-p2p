// BIP 158 Golomb-coded set, decoder + matcher.
//
// Filter type 0 (basic): contains the scriptPubKeys of every output created
// in the block plus the scriptPubKeys of every output spent. To check
// whether a block is interesting, hash each watched scriptPubKey under
// the filter's SipHash key and test for membership.
//
// Wire layout of the filter payload (`cfilter` message body, after the
// command-level prefix):
//
//   varint  N         number of items
//   bits    GR(N)     Golomb-Rice coded ascending differences
//
// Each item is mapped to the range [0, N*M) by:
//   item64  = siphash24(item, k0, k1)
//   scaled  = (item64 * F) >> 64,  F = N * M
// then sorted; the encoder writes (scaled[i] - scaled[i-1]) using the
// Golomb-Rice code with parameter P (unary quotient by 2^P, then P-bit
// remainder, MSB first).
//
// The SipHash key is the first 16 bytes of the block hash in **internal
// (wire) byte order** — i.e. the bytes as they appear on the wire, NOT
// the reversed display hex you see in block explorers.

import { BufferReader } from './encoding/BufferReader.js';
import { siphash24 } from './SipHash.js';
import { utils as sdkUtils } from 'dash-core-sdk';

const { doubleSHA256 } = sdkUtils;

// Basic filter (type 0) parameters from BIP 158.
export const BASIC_FILTER_TYPE = 0;
export const GCS_P = 19;
export const GCS_M = 784931n;

// Service bit advertising compact-filter support (BIP 157).
export const NODE_COMPACT_FILTERS = 1 << 6;

class BitReader {
  private buf: Uint8Array;
  private bitPos = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  readBit(): number {
    const i = this.bitPos >> 3;
    if (i >= this.buf.length) throw new Error('GCS bit reader past end of payload');
    const bit = (this.buf[i]! >> (7 - (this.bitPos & 7))) & 1;
    this.bitPos++;
    return bit;
  }

  readBitsBig(n: number): bigint {
    let r = 0n;
    for (let i = 0; i < n; i++) r = (r << 1n) | BigInt(this.readBit());
    return r;
  }
}

// Decode a BIP 158 GCS filter payload to its sorted list of scaled hashes.
export function decodeGCS(filter: Uint8Array, P = GCS_P): { N: number; values: bigint[] } {
  const reader = new BufferReader(filter);
  const N = reader.readVarintNum();
  const tail = reader.readAll();
  const values: bigint[] = new Array(N);
  if (N === 0) return { N, values: [] };

  const bits = new BitReader(tail);
  let last = 0n;
  for (let i = 0; i < N; i++) {
    let q = 0;
    while (bits.readBit() === 1) {
      q++;
      if (q > 1 << 20) throw new Error('GCS quotient runaway');
    }
    const r = bits.readBitsBig(P);
    last += (BigInt(q) << BigInt(P)) | r;
    values[i] = last;
  }
  return { N, values };
}

// Derive the SipHash key from a 32-byte block hash in internal byte order.
export function deriveFilterKey(blockHashWire: Uint8Array): { k0: bigint; k1: bigint } {
  if (blockHashWire.length !== 32) throw new Error('blockHash must be 32 bytes (internal byte order)');
  const dv = new DataView(blockHashWire.buffer, blockHashWire.byteOffset, 32);
  return { k0: dv.getBigUint64(0, true), k1: dv.getBigUint64(8, true) };
}

// BIP 157 filter-header chain step:
//   filter_header_n = dSHA256( dSHA256(filter_n) || filter_header_{n-1} )
export function nextFilterHeader(filterBytes: Uint8Array, prevHeader: Uint8Array): Uint8Array {
  if (prevHeader.length !== 32) throw new Error('prevHeader must be 32 bytes');
  const filterHash = doubleSHA256(filterBytes);
  const concat = new Uint8Array(64);
  concat.set(filterHash, 0);
  concat.set(prevHeader, 32);
  return doubleSHA256(concat);
}

export class CompactFilter {
  readonly N: number;
  readonly values: bigint[];
  readonly k0: bigint;
  readonly k1: bigint;
  readonly F: bigint;

  constructor(filter: Uint8Array, blockHashWire: Uint8Array, P = GCS_P, M = GCS_M) {
    const { k0, k1 } = deriveFilterKey(blockHashWire);
    this.k0 = k0;
    this.k1 = k1;
    const { N, values } = decodeGCS(filter, P);
    this.N = N;
    this.values = values;
    this.F = BigInt(N) * M;
  }

  private hashItem(item: Uint8Array): bigint {
    if (this.N === 0) return 0n;
    return (siphash24(this.k0, this.k1, item) * this.F) >> 64n;
  }

  // O(log N). Use matchAny for batches.
  match(item: Uint8Array): boolean {
    if (this.N === 0) return false;
    const target = this.hashItem(item);
    let lo = 0;
    let hi = this.values.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const v = this.values[mid]!;
      if (v === target) return true;
      if (v < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  }

  // O(N + K) merge of two sorted streams. Cheaper than K binary searches
  // once K is more than a handful of items, and the typical wallet query
  // is a list of watched scripts/outpoints, so this is the common path.
  matchAny(items: Uint8Array[]): boolean {
    if (this.N === 0 || items.length === 0) return false;
    const hashed = items.map(it => this.hashItem(it));
    hashed.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    let i = 0;
    let j = 0;
    while (i < hashed.length && j < this.values.length) {
      const a = hashed[i]!;
      const b = this.values[j]!;
      if (a === b) return true;
      if (a < b) i++;
      else j++;
    }
    return false;
  }
}