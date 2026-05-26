import { Networks } from '../Network.js';
import { Inventory } from '../Inventory.js';
// Import all command classes
import { VersionMessage } from './commands/VersionMessage.js';
import { VerAckMessage } from './commands/VerAckMessage.js';
import { PingMessage } from './commands/PingMessage.js';
import { PongMessage } from './commands/PongMessage.js';
import { BlockMessage } from './commands/BlockMessage.js';
import { TransactionMessage } from './commands/TransactionMessage.js';
import { GetDataMessage } from './commands/GetDataMessage.js';
import { GetMnListDiffMessage } from './commands/GetMnListDiffMessage.js';
import { HeadersMessage } from './commands/HeadersMessage.js';
import { NotFoundMessage } from './commands/NotFoundMessage.js';
import { InvMessage } from './commands/InvMessage.js';
import { AddrMessage } from './commands/AddrMessage.js';
import { AlertMessage } from './commands/AlertMessage.js';
import { RejectMessage } from './commands/RejectMessage.js';
import { MerkleBlockMessage } from './commands/MerkleBlockMessage.js';
import { MnListDiffMessage } from './commands/MnListDiffMessage.js';
import { FilterLoadMessage } from './commands/FilterLoadMessage.js';
import { FilterAddMessage } from './commands/FilterAddMessage.js';
import { FilterClearMessage } from './commands/FilterClearMessage.js';
import { GetBlocksMessage } from './commands/GetBlocksMessage.js';
import { GetHeadersMessage } from './commands/GetHeadersMessage.js';
import { MemPoolMessage } from './commands/MemPoolMessage.js';
import { GetAddrMessage } from './commands/GetAddrMessage.js';
import { DSQueueMessage } from './commands/DSQueueMessage.js';
import { SyncStatusCountMessage } from './commands/SyncStatusCountMessage.js';
import { TXLockRequestMessage } from './commands/TXLockRequestMessage.js';
import { SendAddrV2Message } from './commands/SendAddrV2Message.js';
import { AddrV2Message } from './commands/AddrV2Message.js';
import { SendHeadersMessage } from './commands/SendHeadersMessage.js';
import { ISLockMessage } from './commands/ISLockMessage.js';
import { CLSigMessage } from './commands/CLSigMessage.js';
import { GetCFiltersMessage } from './commands/GetCFiltersMessage.js';
import { CFilterMessage } from './commands/CFilterMessage.js';
import { GetCFHeadersMessage } from './commands/GetCFHeadersMessage.js';
import { CFHeadersMessage } from './commands/CFHeadersMessage.js';
import { GetCFCheckptMessage } from './commands/GetCFCheckptMessage.js';
import { CFCheckptMessage } from './commands/CFCheckptMessage.js';
const COMMAND_MAP = {
    version: VersionMessage,
    verack: VerAckMessage,
    ping: PingMessage,
    pong: PongMessage,
    block: BlockMessage,
    tx: TransactionMessage,
    getdata: GetDataMessage,
    getmnlistdiff: GetMnListDiffMessage,
    headers: HeadersMessage,
    notfound: NotFoundMessage,
    inv: InvMessage,
    addr: AddrMessage,
    alert: AlertMessage,
    reject: RejectMessage,
    merkleblock: MerkleBlockMessage,
    mnlistdiff: MnListDiffMessage,
    filterload: FilterLoadMessage,
    filteradd: FilterAddMessage,
    filterclear: FilterClearMessage,
    getblocks: GetBlocksMessage,
    getheaders: GetHeadersMessage,
    mempool: MemPoolMessage,
    getaddr: GetAddrMessage,
    dsq: DSQueueMessage,
    ssc: SyncStatusCountMessage,
    ix: TXLockRequestMessage,
    sendaddrv2: SendAddrV2Message,
    addrv2: AddrV2Message,
    sendheaders: SendHeadersMessage,
    islock: ISLockMessage,
    clsig: CLSigMessage,
    getcfilters: GetCFiltersMessage,
    cfilter: CFilterMessage,
    getcfheaders: GetCFHeadersMessage,
    cfheaders: CFHeadersMessage,
    getcfcheckpt: GetCFCheckptMessage,
    cfcheckpt: CFCheckptMessage,
};
export function builder(options) {
    const opts = options ?? {};
    if (!opts.network) {
        opts.network = Networks.defaultNetwork;
    }
    else if (typeof opts.network === 'string') {
        opts.network = Networks.get(opts.network) ?? Networks.defaultNetwork;
    }
    opts.protocolVersion = opts.protocolVersion ?? 70238;
    const exported = {
        defaults: {
            protocolVersion: opts.protocolVersion,
            network: opts.network,
        },
        inventoryCommands: ['getdata', 'inv', 'notfound'],
        commandsMap: {
            version: 'Version',
            verack: 'VerAck',
            ping: 'Ping',
            pong: 'Pong',
            block: 'Block',
            tx: 'Transaction',
            getdata: 'GetData',
            getmnlistdiff: 'GetMnListDiff',
            headers: 'Headers',
            notfound: 'NotFound',
            inv: 'Inventory',
            addr: 'Addresses',
            alert: 'Alert',
            reject: 'Reject',
            merkleblock: 'MerkleBlock',
            mnlistdiff: 'MnListDiff',
            filterload: 'FilterLoad',
            filteradd: 'FilterAdd',
            filterclear: 'FilterClear',
            getblocks: 'GetBlocks',
            getheaders: 'GetHeaders',
            mempool: 'MemPool',
            getaddr: 'GetAddr',
            dsq: 'DSQueue',
            ssc: 'SyncStatusCount',
            ix: 'TXLockRequest',
            sendaddrv2: 'SendAddrV2',
            addrv2: 'AddrV2',
            sendheaders: 'SendHeaders',
            islock: 'ISLock',
            clsig: 'CLSig',
            getcfilters: 'GetCFilters',
            cfilter: 'CFilter',
            getcfheaders: 'GetCFHeaders',
            cfheaders: 'CFHeaders',
            getcfcheckpt: 'GetCFCheckpt',
            cfcheckpt: 'CFCheckpt',
        },
        unsupportedCommands: [
            'qsendrecsigs',
            'senddsq',
            'sendcmpct',
            'txlvote',
            'spork',
            'getsporks',
            'mnw',
            'mnget',
            'mn scan error',
            'mnvs',
            'mvote',
            'mprop',
            'fbs',
            'fbvote',
            'mn quorum',
            'mnb',
            'mnp',
            'dsa',
            'dsi',
            'dsf',
            'dss',
            'dsc',
            'dssu',
            'dstx',
            'dseg',
            'govsync',
            'govobj',
            'govobjvote',
            // DIP-24 deterministic InstantSend lock; payload shape differs from
            // classic islock and we don't parse it yet. Ignore instead of crashing.
            'isdlock',
            // Masternode/quorum DKG and auth commands — safe to ignore in an SPV
            // client that only cares about txs, blocks, and filter matches.
            'mnauth',
            'qfcommit',
            'qcontrib',
            'qcomplaint',
            'qjustify',
            'qpcommit',
            'qwatch',
            'qsigshare',
            'qsigrec',
            'qsigsinv',
            'qgetsigs',
            'qbsigs',
            'qgetdata',
            'qdata',
        ],
        commands: {},
        add(key, Command) {
            const factory = function (arg) {
                return new Command(arg, opts);
            };
            factory.fromBytes = function (bytes) {
                const message = factory();
                message.setPayload(bytes);
                return message;
            };
            exported.commands[key] = factory;
        },
    };
    for (const key of Object.keys(COMMAND_MAP)) {
        exported.add(key, COMMAND_MAP[key]);
    }
    for (const command of exported.inventoryCommands) {
        const cmd = exported.commands[command];
        cmd.forTransaction = function forTransaction(hash) {
            return new (COMMAND_MAP[command])([Inventory.forTransaction(hash)], opts);
        };
        cmd.forBlock = function forBlock(hash) {
            return new (COMMAND_MAP[command])([Inventory.forBlock(hash)], opts);
        };
        cmd.forFilteredBlock = function forFilteredBlock(hash) {
            return new (COMMAND_MAP[command])([Inventory.forFilteredBlock(hash)], opts);
        };
    }
    return exported;
}
//# sourceMappingURL=Builder.js.map