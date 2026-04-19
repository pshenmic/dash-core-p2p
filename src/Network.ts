import { hexToBytes } from './utils/binary.js';

export interface NetworkSeed {
  ip: { v4?: string; v6?: string };
  port?: number;
}

export interface Network {
  name: string;
  port: number;
  networkMagic: Uint8Array;
  dnsSeeds: string[];
  seeds?: NetworkSeed[];
}

const livenet: Network = {
  name: 'livenet',
  port: 9999,
  networkMagic: hexToBytes('bf0c6bbd'),
  dnsSeeds: [
    'dnsseed.dash.org'
    // 'dnsseed.darkcoin.io',
    // 'dnsseed.dashdot.io',
    // 'dnsseed.masternode.io',
    // 'dnsseed.dashpay.io',
  ],
};

const testnet: Network = {
  name: 'testnet',
  port: 19999,
  networkMagic: hexToBytes('cee2caff'),
  dnsSeeds: [
    'testnet-seed.darkcoin.io',
    'testnet-seed.dashdot.io',
    'test.dnsseed.masternode.io',
  ],
};

const networksByName: Record<string, Network> = {
  livenet,
  mainnet: livenet,
  testnet,
};

export const Networks = {
  livenet,
  mainnet: livenet,
  testnet,
  defaultNetwork: livenet as Network,
  get(network: string | Network | null | undefined): Network | null {
    if (network == null) return null;
    if (typeof network === 'object') return network;
    return networksByName[network] ?? null;
  },
};
