import { hexToBytes } from './utils/binary.js';
const livenet = {
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
const testnet = {
    name: 'testnet',
    port: 19999,
    networkMagic: hexToBytes('cee2caff'),
    dnsSeeds: [
        'testnet-seed.darkcoin.io',
        'testnet-seed.dashdot.io',
        'test.dnsseed.masternode.io',
    ],
};
const networksByName = {
    livenet,
    mainnet: livenet,
    testnet,
};
export const Networks = {
    livenet,
    mainnet: livenet,
    testnet,
    defaultNetwork: livenet,
    get(network) {
        if (network == null)
            return null;
        if (typeof network === 'object')
            return network;
        return networksByName[network] ?? null;
    },
};
//# sourceMappingURL=Network.js.map