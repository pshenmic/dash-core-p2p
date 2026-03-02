/**
 * Native cross-platform binary utilities using Uint8Array, DataView,
 * TextEncoder, and TextDecoder instead of Node.js Buffer.
 */

export function hexToBytes(hex: string): Uint8Array {
  const len = hex.length >>> 1;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

export function strToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function bytesToStr(bytes: Uint8Array, trimNulls?: boolean): string {
  const s = new TextDecoder().decode(bytes);
  return trimNulls ? s.replace(/\0+$/, '') : s;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function reverseBytes(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[bytes.length - 1 - i]!;
  }
  return result;
}
