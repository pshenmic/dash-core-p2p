export interface Network {
    name: string;
    port: number;
    networkMagic: Uint8Array;
    dnsSeeds: string[];
}
export declare const Networks: {
    livenet: Network;
    mainnet: Network;
    testnet: Network;
    defaultNetwork: Network;
    get(network: string | Network | null | undefined): Network | null;
};
