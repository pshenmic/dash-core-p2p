/**
 * Wallet sync — SPV with outpoint-aware bloom filter (rev2).
 *
 * Fix for BIP37 per-connection filter state: when peer A's filter learns an
 * outpoint from a matched receive, peer B's filter doesn't — so a spend
 * served by B is dropped and inflows accumulate without matching spends.
 *   1. FilterAdd-broadcast every new UTXO's outpoint to every peer.
 *   2. After the primary pass, re-scan from the earliest UTXO to tip so
 *      peers that hadn't yet learned an outpoint catch the missed spend.
 *   3. On peerready, replay every known outpoint after FilterLoad so fresh
 *      peers start with the full outpoint set.
 *
 * Run: npx tsx examples/wallet_sync_spv_rev2.ts
 */

import fs from 'fs';
import {
  Pool, BloomFilter, Inventory, Messages,
  type ISLockArgs, type CLSigArgs, type Peer, type Message,
} from '../src';
import { MerkleBlock, Transaction } from 'dash-core-sdk';
import { hexToBytes } from 'dash-core-sdk/src/utils';
import { Base58Check } from 'dash-core-sdk/src/base58check';
// @ts-expect-error — no bundled types for @dashevo/x11-hash-js
import x11 from '@dashevo/x11-hash-js';

const NETWORK: 'mainnet' | 'testnet' = 'mainnet';
const WATCH_ADDRESSES: string[] = ['XwqUZ6iLoMyZEBFSyji59krNu3Kb6sXrZj'];
const WALLET_BIRTHDAY_HEIGHT = 2155068;

// Checkpoint: trust this hash at this height. Headers validated forward.
const INITIAL_TIP_HASH = '0000000000000000b33d806afc043fe04272f1b67c700b743e73a5faeed9b53c';
const INITIAL_TIP_HEIGHT = 2155068;

const SYNC_STATE_FILE = '.dash-sync-state-spv.json';
const FILTERED_BLOCK_BATCH = 200;
const FILTERED_BLOCK_REFILL_AT = 50;
const SCAN_SAVE_EVERY_BLOCKS = 10_000;
const HEADER_SYNC_TIMEOUT_MS = 30_000;
const HEADER_RACE_PEERS = 6;

const POW_LIMIT_BITS = 0x1e0fffff;
const MAX_FUTURE_BLOCK_TIME = 2 * 60 * 60;

if (!INITIAL_TIP_HASH || !Number.isFinite(INITIAL_TIP_HEIGHT)) {
  throw new Error('INITIAL_TIP_HASH and INITIAL_TIP_HEIGHT must be set.');
}

// --- PoW / hash helpers ---

function bitsToTarget(bits: number): bigint {
  const exponent = bits >>> 24;
  const mantissa = BigInt(bits & 0x007fffff);
  return exponent <= 3 ? mantissa >> BigInt(8 * (3 - exponent)) : mantissa << BigInt(8 * (exponent - 3));
}

const POW_LIMIT_TARGET = bitsToTarget(POW_LIMIT_BITS);

function bytesToHexReversed(bytes: Uint8Array): string {
  let out = '';
  for (let i = bytes.length - 1; i >= 0; i--) out += bytes[i]!.toString(16).padStart(2, '0');
  return out;
}

function rawPrevHash(raw: Uint8Array): string {
  let out = '';
  for (let i = 35; i >= 4; i--) out += raw[i]!.toString(16).padStart(2, '0');
  return out;
}

function hashHeaderRaw(raw: Uint8Array): string {
  const buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  const digest = (x11 as any).digest(buf, 1, 1) as number[];
  let hex = '';
  for (let i = digest.length - 1; i >= 0; i--) hex += digest[i]!.toString(16).padStart(2, '0');
  return hex;
}

// --- Bloom filter ---

function buildBloomFilter(addresses: string[]): BloomFilter {
  const nTweak = Math.floor(Math.random() * 0xffffffff);
  const f = BloomFilter.create(10_000, 0.0001, nTweak, BloomFilter.BLOOM_UPDATE_ALL);
  for (const a of addresses) f.insert(Base58Check.decode(a).slice(1, 21));
  return f;
}

// BIP37 outpoint: 32-byte txid wire-LE + 4-byte vout LE.
function serializeOutpoint(displayTxid: string, vout: number): Uint8Array {
  const out = new Uint8Array(36);
  out.set(hexToBytes(displayTxid).reverse(), 0);
  new DataView(out.buffer).setUint32(32, vout, true);
  return out;
}

function broadcastOutpoint(txid: string, vout: number): void {
  const msg = filterAddOutpointMsg(txid, vout);
  for (const peer of readyPeers) peer.sendMessage(msg);
}

// --- Persisted sync state ---

interface SyncState {
  tipHash: string | null;
  tipHeight: number;
  batchHashes: Record<string, string>;
  birthdayScanned: boolean;
  scanLocatorHash: string | null;
  scanLocatorHeight?: number;
}

const batchHashes = new Map<number, string>();
const hashToHeight = new Map<string, number>();

function loadSyncState(): SyncState {
  let state: SyncState = {
    tipHash: INITIAL_TIP_HASH, tipHeight: INITIAL_TIP_HEIGHT,
    batchHashes: {}, birthdayScanned: false, scanLocatorHash: null,
  };
  try {
    const saved = JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf8')) as SyncState;
    if (saved.tipHash && saved.tipHeight >= 0) {
      console.log(`[state] resuming from height=${saved.tipHeight}  hash=${saved.tipHash.slice(0, 16)}…`);
      state = saved;
    }
  } catch {}

  for (const [h, hash] of Object.entries(state.batchHashes ?? {})) {
    batchHashes.set(Number(h), hash);
    hashToHeight.set(hash, Number(h));
  }
  batchHashes.set(INITIAL_TIP_HEIGHT, INITIAL_TIP_HASH);
  hashToHeight.set(INITIAL_TIP_HASH, INITIAL_TIP_HEIGHT);
  return state;
}

function saveSyncState(): void {
  try {
    fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify({
      tipHash: chainTipHash, tipHeight: chainTipHeight,
      batchHashes: Object.fromEntries(batchHashes),
      birthdayScanned, scanLocatorHash, scanLocatorHeight,
    }));
  } catch (e) {
    console.warn('[state] could not save:', (e as Error).message);
  }
}

function findBatchHashAtOrBelow(target: number): { height: number; hash: string } | null {
  let best: { height: number; hash: string } | null = null;
  for (const [h, hash] of batchHashes) {
    if (h <= target && (!best || h > best.height)) best = { height: h, hash };
  }
  return best;
}

// --- Chain tip ---

const initialState = loadSyncState();
let chainTipHash: string = initialState.tipHash ?? INITIAL_TIP_HASH;
let chainTipHeight = initialState.tipHeight;
let birthdayScanned = initialState.birthdayScanned;
let scanLocatorHash: string | null = initialState.scanLocatorHash ?? null;
let scanLocatorHeight: number = initialState.scanLocatorHeight ?? -1;

// --- Header verification ---

function processHeaders(rawHeaders: Uint8Array[]): boolean {
  if (rawHeaders.length === 0) return false;

  const futureLimit = Math.floor(Date.now() / 1000) + MAX_FUTURE_BLOCK_TIME;
  let prevHash = chainTipHash;
  let h = chainTipHeight;
  const added: Array<{ height: number; hash: string }> = [];

  for (const raw of rawHeaders) {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const time = dv.getUint32(68, true);
    const nBits = dv.getUint32(72, true);
    const incomingPrev = rawPrevHash(raw);

    if (incomingPrev !== prevHash) {
      console.warn(`[spv] header rejected at ~${h + 1}: discontinuity: prev=${incomingPrev.slice(0, 16)}… expected=${prevHash.slice(0, 16)}…`);
      return false;
    }
    if (time > futureLimit) {
      console.warn(`[spv] header rejected at ~${h + 1}: timestamp too far in future: ${time}`);
      return false;
    }
    const target = bitsToTarget(nBits);
    if (target <= 0n || target > POW_LIMIT_TARGET) {
      console.warn(`[spv] header rejected at ~${h + 1}: invalid nBits=0x${nBits.toString(16)}`);
      return false;
    }
    const hashHex = hashHeaderRaw(raw);
    if (BigInt('0x' + hashHex) > target) {
      console.warn(`[spv] header rejected at ~${h + 1}: PoW fail hash ${hashHex.slice(0, 16)}…`);
      return false;
    }

    h++;
    prevHash = hashHex;
    added.push({ height: h, hash: hashHex });
  }

  const prevHeight = chainTipHeight;
  chainTipHeight = h;
  chainTipHash = prevHash;
  for (const a of added) hashToHeight.set(a.hash, a.height);
  batchHashes.set(chainTipHeight, chainTipHash);

  const milestone = Math.ceil((prevHeight + 1) / 10_000) * 10_000;
  if (chainTipHeight >= milestone) {
    console.log(`[headers] verified height=${chainTipHeight}  tip=${chainTipHash.slice(0, 16)}…`);
  }
  return true;
}

// --- Header race ---

const readyPeers = new Set<Peer>();

interface HeaderRace {
  locator: string;
  racers: Set<Peer>;
  zeroResponses: number;
  timer: ReturnType<typeof setTimeout> | null;
}
let currentRace: HeaderRace | null = null;

function endRace(race: HeaderRace): void {
  if (race.timer) { clearTimeout(race.timer); race.timer = null; }
  if (currentRace === race) currentRace = null;
}

function startHeaderRace(): void {
  if (readyPeers.size === 0 || currentRace) return;

  const picks: Peer[] = [];
  for (const p of readyPeers) {
    picks.push(p);
    if (picks.length >= HEADER_RACE_PEERS) break;
  }
  if (picks.length === 0) return;

  const locator = chainTipHash;
  const race: HeaderRace = { locator, racers: new Set(picks), zeroResponses: 0, timer: null };
  currentRace = race;

  const msg = getHeadersMsg(locator);
  for (const p of picks) p.sendMessage(msg);

  race.timer = setTimeout(() => {
    if (currentRace !== race) return;
    console.warn(`[headers] race at ${locator.slice(0, 16)}… timed out (${race.racers.size}/${picks.length} unresponsive)`);
    endRace(race);
    startHeaderRace();
  }, HEADER_SYNC_TIMEOUT_MS);
}

function finishHeaderSync(): void {
  if (currentRace) endRace(currentRace);
  console.log(`[headers] sync complete  height=${chainTipHeight}  tip=${chainTipHash.slice(0, 16)}…`);
  saveSyncState();
  if (!birthdayScanned && WALLET_BIRTHDAY_HEIGHT <= chainTipHeight) startBirthdayScan();
  else phase = 'live';
}

// --- Birthday scan ---

type Phase = 'syncing-headers' | 'birthday-scan' | 'live';
let phase: Phase = birthdayScanned ? 'live' : 'syncing-headers';

const pendingBlocks: Uint8Array[] = [];
const peerOutstanding = new Map<Peer, number>();
const peerInFlight = new Map<Peer, Uint8Array[]>();
let pagingDone = false;
let blocksScanned = 0;
let lastSaveAtBlock = 0;
let primaryPassBlocks = 0;
let pagingPeer: Peer | null = null;
let awaitingPageFrom: Peer | null = null;
let inReconcile = false;

function outstanding(p: Peer): number { return peerOutstanding.get(p) ?? 0; }

function decOutstanding(p: Peer): void {
  const n = outstanding(p);
  if (n > 0) peerOutstanding.set(p, n - 1);
}

function phaseLabel(): string { return inReconcile ? '[reconcile]' : '[scan]'; }

function pickPagingPeer(): Peer | null {
  if (pagingPeer && readyPeers.has(pagingPeer)) return pagingPeer;
  pagingPeer = [...readyPeers][0] ?? null;
  return pagingPeer;
}

function startBirthdayScan(): void {
  phase = 'birthday-scan';

  let startHash = scanLocatorHash;
  let startHeight = scanLocatorHeight;
  if (!startHash) {
    const found = findBatchHashAtOrBelow(WALLET_BIRTHDAY_HEIGHT);
    if (found) { startHash = found.hash; startHeight = found.height; }
  }

  console.log(
    `[scan] birthday scan started  from=${startHeight >= 0 ? startHeight : '(resume)'}  ` +
    `birthday=${WALLET_BIRTHDAY_HEIGHT}  tip=${chainTipHeight}  ` +
    `startHash=${startHash ? startHash.slice(0, 16) + '…' : 'genesis'}`,
  );

  if (!startHash || startHeight < 0) {
    console.warn('[scan] no start hash/height — aborting. Set INITIAL_TIP_HASH/HEIGHT.');
    phase = 'live';
    return;
  }

  scanLocatorHeight = startHeight;
  const leader = pickPagingPeer();
  if (leader) requestBlockBatch(leader, startHash);
}

function requestBlockBatch(peer: Peer, fromHash: string): void {
  scanLocatorHash = fromHash;
  awaitingPageFrom = peer;
  peer.sendMessage(getBlocksMsg(fromHash));
}

function dispatchBatch(peer: Peer): void {
  if (pendingBlocks.length === 0) return;
  const have = outstanding(peer);
  const room = FILTERED_BLOCK_BATCH - have;
  if (room <= 0) return;

  const take = Math.min(room, pendingBlocks.length);
  const hashes = pendingBlocks.splice(0, take);
  const items = hashes.map(hash => ({ type: Inventory.TYPE.FILTERED_BLOCK, hash }));

  peerOutstanding.set(peer, have + items.length);
  const list = peerInFlight.get(peer) ?? [];
  peerInFlight.set(peer, list.concat(hashes));

  peer.sendMessage(M.GetData(items));
}

function maybeRefill(peer: Peer): void {
  if (outstanding(peer) <= FILTERED_BLOCK_REFILL_AT && pendingBlocks.length > 0) dispatchBatch(peer);
}

function drainToIdlePeers(): void {
  for (const peer of readyPeers) maybeRefill(peer);
}

function startReconciliationPass(): boolean {
  if (utxos.size === 0) return false;

  let minHeight = Number.MAX_SAFE_INTEGER;
  for (const u of utxos.values()) if (u.height < minHeight) minHeight = u.height;
  if (!Number.isFinite(minHeight) || minHeight > chainTipHeight) return false;

  const fromHeight = Math.max(INITIAL_TIP_HEIGHT, minHeight - 1);
  const found = findBatchHashAtOrBelow(fromHeight);
  if (!found) return false;

  inReconcile = true;
  pagingDone = false;
  scanLocatorHeight = found.height;
  scanLocatorHash = found.hash;
  primaryPassBlocks = blocksScanned;
  blocksScanned = 0;
  lastSaveAtBlock = 0;

  console.log(
    `[reconcile] starting pass from height=${found.height}  utxos=${utxos.size}  ` +
    `range=${found.height}..${chainTipHeight}  (~${chainTipHeight - found.height} blocks)`,
  );

  const leader = pickPagingPeer();
  if (leader) requestBlockBatch(leader, found.hash);
  return true;
}

function checkScanDone(): void {
  if (!pagingDone || pendingBlocks.length > 0) return;
  for (const n of peerOutstanding.values()) if (n > 0) return;
  if (!inReconcile && startReconciliationPass()) return;

  birthdayScanned = true;
  scanLocatorHash = null;
  saveSyncState();
  phase = 'live';

  const balance = [...utxos.values()].reduce((s, u) => s + u.satoshis, 0n);
  const primary = inReconcile ? primaryPassBlocks : blocksScanned;
  const reconcile = inReconcile ? blocksScanned : 0;
  console.log(
    `\n[scan] complete  primary=${primary}  reconcile=${reconcile}  ` +
    `utxos=${utxos.size}  balance=${Number(balance) / 1e8} DASH`,
  );
  for (const u of utxos.values()) {
    const conf = chainTipHeight - u.height + 1;
    console.log(`  ${u.txid.slice(0, 16)}…:${u.vout}  ${Number(u.satoshis) / 1e8} DASH  conf=${conf}  (${u.address})`);
  }
}

// --- UTXO set ---

interface Utxo { txid: string; vout: number; satoshis: bigint; address: string; height: number }

const utxos = new Map<string, Utxo>();

// Every outpoint we've ever accepted. Keeps reconcile idempotent: if a
// receive is re-observed after the spend deleted the UTXO, a naive
// `utxos.has` would be false and we'd re-add a phantom UTXO; if peers
// race and re-observe the spend before the re-receive, the spend is a
// no-op on the empty slot and the UTXO sticks.
const seenOwnOutpoints = new Set<string>();

function applyTransaction(tx: Transaction, height: number): void {
  const txid = tx.hash();

  for (const input of tx.inputs) {
    const key = `${input.txId}:${input.vOut}`;
    const spent = utxos.get(key);
    if (spent) {
      console.log(`[utxo] spent    ${spent.txid.slice(0, 16)}…:${spent.vout}  -${Number(spent.satoshis) / 1e8} DASH  at height=${height}`);
      utxos.delete(key);
    }
  }

  for (let vout = 0; vout < tx.outputs.length; vout++) {
    const output = tx.outputs[vout]!;
    const address = output.getAddress(NETWORK === 'mainnet' ? 'Mainnet' : 'Testnet');
    if (!address || !WATCH_ADDRESSES.includes(address)) continue;
    const key = `${txid}:${vout}`;
    if (seenOwnOutpoints.has(key)) continue;
    seenOwnOutpoints.add(key);
    utxos.set(key, { txid, vout, satoshis: output.satoshis, address, height });
    console.log(`[utxo] received ${txid.slice(0, 16)}…:${vout}  +${Number(output.satoshis) / 1e8} DASH  at height=${height}`);
    broadcastOutpoint(txid, vout);
  }
}

// --- Merkleblock context (peer's latest verified block, for peertx lookup) ---

interface PeerMerkleCtx { blockHash: string; height: number; matches: Set<string> }
const peerMerkleCtx = new Map<Peer, PeerMerkleCtx>();

// --- Pool + typed message builders ---

const messages = new Messages({ network: NETWORK } as any);
const M = messages as any;
const pool = new Pool({ network: NETWORK, maxSize: 32, relay: false, messages });
const filter = buildBloomFilter(WATCH_ADDRESSES);

function getHeadersMsg(locator: string) {
  return M.GetHeaders({ starts: [hexToBytes(locator).reverse()], stop: new Uint8Array(32) });
}

function getBlocksMsg(locator: string) {
  return M.GetBlocks({ starts: [hexToBytes(locator).reverse()], stop: new Uint8Array(32) });
}

function filterAddOutpointMsg(txid: string, vout: number) {
  return M.FilterAdd(serializeOutpoint(txid, vout));
}

// --- peerinv sub-steps ---

function isPagingReply(peer: Peer, blockCount: number): boolean {
  const nearTip = scanLocatorHeight + 500 >= chainTipHeight;
  return peer === awaitingPageFrom && (blockCount >= 2 || nearTip);
}

function queuePagingBlocks(blockItems: Array<{ type: number; hash: Uint8Array }>): number {
  let h = scanLocatorHeight;
  for (const item of blockItems) {
    h++;
    hashToHeight.set(bytesToHexReversed(item.hash), h);
    pendingBlocks.push(item.hash);
  }
  scanLocatorHeight = h;
  return blockItems.length;
}

function queueAnnouncedBlocks(blockItems: Array<{ type: number; hash: Uint8Array }>): number {
  let queued = 0;
  for (const item of blockItems) {
    if (hashToHeight.has(bytesToHexReversed(item.hash))) {
      pendingBlocks.push(item.hash);
      queued++;
    }
  }
  return queued;
}

function continuePaging(peer: Peer, blockItems: Array<{ type: number; hash: Uint8Array }>): void {
  awaitingPageFrom = null;
  if (scanLocatorHeight < chainTipHeight) {
    if (blockItems.length === 0) {
      console.warn(`[scan] peer ${peer.host} returned 0 blocks at height=${scanLocatorHeight}, retrying with another peer`);
      const fallback = [...readyPeers].find(p => p !== peer) ?? peer;
      if (fallback !== peer) requestBlockBatch(fallback, scanLocatorHash!);
      return;
    }
    const nextLocator = bytesToHexReversed(blockItems[blockItems.length - 1]!.hash);
    const leader = pickPagingPeer() ?? peer;
    requestBlockBatch(leader, nextLocator);
  } else {
    pagingDone = true;
    console.log(`${phaseLabel()} all blocks queued  pending=${pendingBlocks.length}  at-height=${scanLocatorHeight}`);
    checkScanDone();
  }
}

// --- Event handlers ---

pool.on('peerready', (peer: Peer) => {
  console.log(`[pool] peer ready  ${peer.host}:${peer.port}  v${peer.version}  height=${peer.bestHeight}`);
  readyPeers.add(peer);
  peer.sendMessage(M.SendHeaders());
  peer.sendMessage(M.FilterLoad({ filter }));
  for (const u of utxos.values()) peer.sendMessage(filterAddOutpointMsg(u.txid, u.vout));

  if (phase === 'syncing-headers') {
    if (!currentRace) {
      startHeaderRace();
    } else if (currentRace.racers.size < HEADER_RACE_PEERS) {
      currentRace.racers.add(peer);
      peer.sendMessage(getHeadersMsg(currentRace.locator));
    }
  } else if (phase === 'birthday-scan') {
    if (!pagingPeer) {
      const leader = pickPagingPeer();
      if (leader && scanLocatorHash) requestBlockBatch(leader, scanLocatorHash);
    }
    dispatchBatch(peer);
  }
});

pool.on('peerheaders', (peer: Peer, message: Message & { headers: Uint8Array[] }) => {
  const rawHeaders = message.headers ?? [];

  if (phase !== 'syncing-headers') {
    if (rawHeaders.length > 0) {
      if (rawHeaders[0]!.length < 80) return;
      if (rawPrevHash(rawHeaders[0]!) !== chainTipHash) return;
    }
    processHeaders(rawHeaders);
    return;
  }

  const race = currentRace;
  if (!race || !race.racers.has(peer)) return;

  if (rawHeaders.length > 0) {
    if (rawHeaders[0]!.length < 80) {
      console.warn(`[headers] malformed header from ${peer.host}: truncated`);
      race.racers.delete(peer);
      return;
    }
    if (rawPrevHash(rawHeaders[0]!) !== race.locator) return;
  }

  race.racers.delete(peer);

  if (rawHeaders.length === 0) {
    race.zeroResponses++;
    const agreeThreshold = Math.min(2, Math.max(1, readyPeers.size));
    if (race.zeroResponses >= agreeThreshold) {
      finishHeaderSync();
    } else if (race.racers.size === 0) {
      endRace(race);
      startHeaderRace();
    }
    return;
  }

  const prevTip = chainTipHash;
  processHeaders(rawHeaders);

  if (chainTipHash === prevTip) {
    if (race.racers.size === 0 && race.zeroResponses === 0) {
      endRace(race);
      console.warn(`[headers] all racers invalid at ${race.locator.slice(0, 16)}…, retrying`);
      startHeaderRace();
    }
    return;
  }

  endRace(race);
  if (rawHeaders.length >= 2000) saveSyncState();
  startHeaderRace();
});

pool.on('peerinv', (peer: Peer, message: Message & { inventory: Array<{ type: number; hash: Uint8Array }> }) => {
  const inv = message.inventory ?? [];

  const want = inv.filter(i => i.type === Inventory.TYPE.ISLOCK || i.type === Inventory.TYPE.CLSIG);
  if (want.length) peer.sendMessage(M.GetData(want));

  if (phase !== 'birthday-scan') return;

  const blockItems = inv.filter(i => i.type === Inventory.TYPE.BLOCK);
  if (blockItems.length === 0) return;

  const isPaging = isPagingReply(peer, blockItems.length);
  const queued = isPaging ? queuePagingBlocks(blockItems) : queueAnnouncedBlocks(blockItems);
  if (queued > 0) drainToIdlePeers();
  if (isPaging) continuePaging(peer, blockItems);
});

pool.on('peermerkleblock', (peer: Peer, message: Message & { merkleBlock: MerkleBlock }) => {
  const mb = message.merkleBlock;
  const blockHash = mb.blockHeader.hash();

  const height = hashToHeight.get(blockHash);
  if (height === undefined) {
    console.warn(`[spv] merkleblock for unknown block ${blockHash.slice(0, 16)}… from ${peer.host} — rejecting`);
    decOutstanding(peer);
    maybeRefill(peer);
    return;
  }

  const matches: string[] = [];
  const indexes: number[] = [];
  try {
    mb.merkleTree.extractMatches(matches, indexes);
  } catch (e) {
    console.warn(`[spv] merkleRoot mismatch at height=${height}: ${(e as Error).message}`);
    decOutstanding(peer);
    return;
  }

  peerMerkleCtx.set(peer, {
    blockHash, height,
    matches: new Set(matches.map(m => bytesToHexReversed(hexToBytes(m)).toLowerCase())),
  });

  blocksScanned++;
  if (blocksScanned % 100 === 0) {
    let total = 0;
    for (const n of peerOutstanding.values()) total += n;
    console.log(`${phaseLabel()} ${blocksScanned} blocks verified  pending=${pendingBlocks.length}  in-flight=${total}  peers=${readyPeers.size}`);
  }

  if (matches.length > 0) {
    console.log(`${phaseLabel()} block ${blockHash.slice(0, 16)}… (h=${height})  matched ${matches.length} tx(s)`);
  }

  decOutstanding(peer);
  const list = peerInFlight.get(peer);
  if (list && list.length) {
    const idx = list.findIndex(h => bytesToHexReversed(h) === blockHash);
    if (idx >= 0) list.splice(idx, 1);
  }

  maybeRefill(peer);

  if (blocksScanned - lastSaveAtBlock >= SCAN_SAVE_EVERY_BLOCKS) {
    lastSaveAtBlock = blocksScanned;
    saveSyncState();
  }

  if (outstanding(peer) === 0 && pendingBlocks.length === 0) checkScanDone();
});

pool.on('peertx', (peer: Peer, message: Message & { transaction: Transaction }) => {
  const tx = message.transaction;
  const txid = tx.hash().toLowerCase();

  if (phase === 'birthday-scan') {
    const ctx = peerMerkleCtx.get(peer);
    if (!ctx || !ctx.matches.has(txid)) {
      console.warn(`[spv] tx ${txid.slice(0, 16)}… from ${peer.host} not in merkleblock matches — rejecting`);
      return;
    }
    applyTransaction(tx, ctx.height);
    return;
  }
  applyTransaction(tx, chainTipHeight + 1);
});

const seenISLocks = new Set<string>();
const seenCLSigs = new Set<string>();

pool.on('peerislock', (_peer: Peer, message: Message & ISLockArgs) => {
  const msg = message as any;
  const txid: string = msg.txid ?? '';
  if (!txid || seenISLocks.has(txid)) return;
  seenISLocks.add(txid);
  console.log(`[islock] txid=${txid.slice(0, 16)}…  inputs=${msg.inputs?.length ?? 0}`);
});

pool.on('peerclsig', (_peer: Peer, message: Message & CLSigArgs) => {
  const msg = message as any;
  const key = `${msg.height}:${msg.blockHash ?? ''}`;
  if (seenCLSigs.has(key)) return;
  seenCLSigs.add(key);
  console.log(`[clsig] height=${msg.height}  block=${msg.blockHash?.slice(0, 16) ?? '?'}…`);
});

pool.on('seederror', (err: Error) => console.error('[pool] seed error:', err.message));

pool.on('peerdisconnect', (peer: Peer) => {
  readyPeers.delete(peer);
  peerOutstanding.delete(peer);
  peerMerkleCtx.delete(peer);

  const list = peerInFlight.get(peer);
  if (list && list.length) for (const h of list) pendingBlocks.push(h);
  peerInFlight.delete(peer);

  const wasLeader = pagingPeer === peer;
  if (wasLeader) pagingPeer = null;

  if (currentRace && currentRace.racers.has(peer)) {
    currentRace.racers.delete(peer);
    if (currentRace.racers.size === 0) {
      endRace(currentRace);
      if (phase === 'syncing-headers') startHeaderRace();
    }
  }

  if (phase === 'birthday-scan') {
    const newLeader = pickPagingPeer();
    const wasAwaitingPage = awaitingPageFrom === peer;
    if (wasAwaitingPage) awaitingPageFrom = null;
    if ((wasLeader || wasAwaitingPage) && newLeader && scanLocatorHash) {
      requestBlockBatch(newLeader, scanLocatorHash);
    }
    drainToIdlePeers();
    checkScanDone();
  }

  console.log(`[pool] peer disconnected  ${peer.host}:${peer.port}`);
});

// --- Connect ---

console.log(`Connecting to Dash ${NETWORK} (SPV-verified, rev2 outpoint-aware filter)…`);
pool.connect();

process.on('SIGINT', () => {
  console.log('\nDisconnecting…');
  saveSyncState();
  pool.disconnect();
  process.exit(0);
});