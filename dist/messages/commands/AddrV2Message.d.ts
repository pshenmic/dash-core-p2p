import { Message, MessageOptions } from '../Message.js';
export declare const NetworkID: {
    readonly IPV4: 1;
    readonly IPV6: 2;
    readonly TORV2: 3;
    readonly TORV3: 4;
    readonly I2P: 5;
    readonly CJDNS: 6;
    readonly YGGDRASIL: 7;
};
export type NetworkIDType = (typeof NetworkID)[keyof typeof NetworkID];
export interface AddrV2Entry {
    time: Date;
    services: bigint;
    networkID: number;
    addr: Uint8Array;
    port: number;
}
/**
 * Extended address message supporting Tor v3, I2P, CJDNS and other network types (BIP155).
 */
export declare class AddrV2Message extends Message {
    addresses: AddrV2Entry[] | undefined;
    constructor(arg: AddrV2Entry[] | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
