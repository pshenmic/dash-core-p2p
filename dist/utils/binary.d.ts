/**
 * Native cross-platform binary utilities using Uint8Array, DataView,
 * TextEncoder, and TextDecoder instead of Node.js Buffer.
 */
export declare function hexToBytes(hex: string): Uint8Array;
export declare function bytesToHex(bytes: Uint8Array): string;
export declare function strToBytes(str: string): Uint8Array;
export declare function bytesToStr(bytes: Uint8Array, trimNulls?: boolean): string;
export declare function bytesEqual(a: Uint8Array, b: Uint8Array): boolean;
export declare function reverseBytes(bytes: Uint8Array): Uint8Array;
