// SipHash-2-4, the keyed PRF used by BIP 158 to hash filter elements.
// Inputs: two 64-bit key halves and a byte string. Output is a 64-bit BigInt.

const MASK64 = (1n << 64n) - 1n;

function rotl(x: bigint, b: bigint): bigint {
  return ((x << b) | (x >> (64n - b))) & MASK64;
}

function sipRound(v: bigint[]): void {
  v[0] = (v[0]! + v[1]!) & MASK64;
  v[1] = rotl(v[1]!, 13n);
  v[1] = (v[1]! ^ v[0]!);
  v[0] = rotl(v[0]!, 32n);
  v[2] = (v[2]! + v[3]!) & MASK64;
  v[3] = rotl(v[3]!, 16n);
  v[3] = (v[3]! ^ v[2]!);
  v[0] = (v[0]! + v[3]!) & MASK64;
  v[3] = rotl(v[3]!, 21n);
  v[3] = (v[3]! ^ v[0]!);
  v[2] = (v[2]! + v[1]!) & MASK64;
  v[1] = rotl(v[1]!, 17n);
  v[1] = (v[1]! ^ v[2]!);
  v[2] = rotl(v[2]!, 32n);
}

export function siphash24(k0: bigint, k1: bigint, data: Uint8Array): bigint {
  const v: bigint[] = [
    (k0 ^ 0x736f6d6570736575n) & MASK64,
    (k1 ^ 0x646f72616e646f6dn) & MASK64,
    (k0 ^ 0x6c7967656e657261n) & MASK64,
    (k1 ^ 0x7465646279746573n) & MASK64,
  ];

  const len = data.length;
  const blockEnd = len & ~7;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let i = 0; i < blockEnd; i += 8) {
    const m = dv.getBigUint64(i, true);
    v[3] = (v[3]! ^ m) & MASK64;
    sipRound(v);
    sipRound(v);
    v[0] = (v[0]! ^ m) & MASK64;
  }

  let last = (BigInt(len & 0xff) << 56n) & MASK64;
  for (let i = blockEnd; i < len; i++) {
    last |= BigInt(data[i]!) << BigInt((i - blockEnd) * 8);
  }
  v[3] = (v[3]! ^ last) & MASK64;
  sipRound(v); sipRound(v);
  v[0] = (v[0]! ^ last) & MASK64;

  v[2] = (v[2]! ^ 0xffn) & MASK64;
  sipRound(v); sipRound(v); sipRound(v); sipRound(v);

  return (v[0]! ^ v[1]! ^ v[2]! ^ v[3]!) & MASK64;
}