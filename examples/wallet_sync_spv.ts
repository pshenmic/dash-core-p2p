/**
 * Wallet sync — proper SPV with outpoint-aware bloom filter.
 *
 * SPV invariant
 * ─────────────
 * Every block whose contents touch wallet state has been PoW-verified by
 * us first. The only trust root is INITIAL_TIP_HASH — a recent, finalised
 * chain tip pinned below. From that anchor the header race validates
 * forward per header: prev-hash chains, timestamp below now+2h, nBits
 * matches DGWv3's expectation (once we have 24 blocks of history) and
 * within the global PoW limit, and x11(header) ≤ target(nBits). Every
 * accepted header's hash is recorded in `hashToHeight`.
 *
 * The birthday scan does not invent its view of the chain from peer data.
 * When a paging peer answers `getblocks` with `inv(BLOCK)`, each hash must
 * already be present in `hashToHeight` at the next expected height; an
 * unknown hash is treated as hostile (or from a peer briefly ahead of our
 * own header sync) and the batch is truncated at that point. We never
 * issue `getdata(FILTERED_BLOCK)` for a hash we haven't PoW-verified
 * ourselves, which closes the SPV hole in earlier revisions where paging
 * hashes were written into `hashToHeight` without validation.
 *
 * Every `peertx` — birthday and live — is gated on `peerMerkleCtx`: we
 * only apply a transaction after the same peer has just delivered a
 * merkleblock whose merkle root we verified, and whose matches include
 * that txid. A live tx arriving before its merkleblock is parked in
 * `pendingTxs` and drained once the merkleblock lands.
 *
 * BIP37 fix
 * ──────────────
 * Naïve BIP37 SPV undercounts spends because filter state is per-peer:
 * when peer A serves a merkleblock matching one of our outputs,
 * BLOOM_UPDATE_ALL adds that outpoint to A's filter only. If peer B later
 * serves the spend, B's filter drops it and the running balance inflates.
 * converges every peer's filter onto the same outpoint set:
 *   1. FilterAdd-broadcast every new UTXO's outpoint to every peer the
 *      moment we observe it.
 *   2. After primary paging drains, run a reconciliation pass from the
 *      earliest UTXO's height to the tip. By then every peer's filter
 *      holds every outpoint, so spends missed on pass 1 are picked up.
 *   3. On peerready, replay every current UTXO via FilterAdd right after
 *      FilterLoad so fresh peers start with the full outpoint set.
 *
 * DGWv3 difficulty retargeting
 * ────────────────────────────
 * Dash retargets every block via Dark Gravity Wave v3: a weighted
 * running average of the last 24 targets, rescaled by the observed
 * timespan clamped to [1/3x, 3x] of the ideal. We keep a rolling
 * 24-tuple of `{time, nBits}` in memory and on disk; once it's full,
 * every new header must carry the nBits DGWv3 would have produced.
 *
 * Deliberately not included
 * ─────────────────────────
 *   - Reorg handling. A reorg inside the scanned range requires manual
 *     state reset.
 *
 */

import fs from 'fs';
import {
  BloomFilter,
  type CLSigArgs,
  Inventory,
  type ISLockArgs,
  type Message,
  Messages,
  type Peer,
  Pool,
} from '../src';
import {MerkleBlock, Transaction} from 'dash-core-sdk';
import {hexToBytes} from 'dash-core-sdk/src/utils';
import {Base58Check} from 'dash-core-sdk/src/base58check';
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

// DGWv3 parameters — must match Dash Core's consensus values.
const DGW_PAST_BLOCKS = 24;
const DGW_TARGET_SPACING = 150;
const DGW_TARGET_TIMESPAN = DGW_PAST_BLOCKS * DGW_TARGET_SPACING;

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

// Inverse of bitsToTarget: pack a target into Bitcoin-style compact nBits.
// Mirrors arith_uint256::GetCompact — the 0x00800000 bit is reserved as a
// sign flag, so when the top byte of the 3-byte mantissa would set it we
// shift right by one byte and bump the exponent.
function targetToCompact(target: bigint): number {
  if (target <= 0n) return 0;
  let bits = 0;
  for (let t = target; t > 0n; t >>= 1n) bits++;
  let size = (bits + 7) >> 3;
  let compact: number;
  if (size <= 3) {
    compact = Number(target << BigInt(8 * (3 - size)));
  } else {
    compact = Number(target >> BigInt(8 * (size - 3)));
  }
  if (compact & 0x00800000) {
    compact >>>= 8;
    size++;
  }
  return ((size << 24) | (compact & 0x007fffff)) >>> 0;
}

// Dash's DarkGravityWave v3: compute the nBits the next block should
// carry given the last 24 blocks. `history` is oldest-to-newest of
// length DGW_PAST_BLOCKS. Matches src/pow.cpp::DarkGravityWave.
function dgwv3ExpectedBits(history: Array<{ time: number; nBits: number }>): number {
  const n = history.length;
  let bnPastTargetAvg = 0n;
  for (let i = 1; i <= n; i++) {
    const bnTarget = bitsToTarget(history[n - i]!.nBits);
    if (i === 1) {
      bnPastTargetAvg = bnTarget;
    } else {
      bnPastTargetAvg = (bnPastTargetAvg * BigInt(i) + bnTarget) / BigInt(i + 1);
    }
  }
  let bnNew = bnPastTargetAvg;
  const newest = history[n - 1]!;
  const oldest = history[0]!;
  let nActualTimespan = newest.time - oldest.time;
  const lo = Math.floor(DGW_TARGET_TIMESPAN / 3);
  const hi = DGW_TARGET_TIMESPAN * 3;
  if (nActualTimespan < lo) nActualTimespan = lo;
  if (nActualTimespan > hi) nActualTimespan = hi;
  bnNew = (bnNew * BigInt(nActualTimespan)) / BigInt(DGW_TARGET_TIMESPAN);
  if (bnNew > POW_LIMIT_TARGET) bnNew = POW_LIMIT_TARGET;
  return targetToCompact(bnNew);
}

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
  dgwvHistory?: Array<{ time: number; nBits: number }>;
}

const batchHashes = new Map<number, string>();
const hashToHeight = new Map<string, number>();
const dgwvHistory: Array<{ time: number; nBits: number }> = [];

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

  if (Array.isArray(state.dgwvHistory)) {
    for (const entry of state.dgwvHistory.slice(-DGW_PAST_BLOCKS)) {
      if (typeof entry?.time === 'number' && typeof entry?.nBits === 'number') {
        dgwvHistory.push({ time: entry.time, nBits: entry.nBits });
      }
    }
  }
  return state;
}

function saveSyncState(): void {
  try {
    fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify({
      tipHash: chainTipHash, tipHeight: chainTipHeight,
      batchHashes: Object.fromEntries(batchHashes),
      birthdayScanned, scanLocatorHash, scanLocatorHeight,
      dgwvHistory,
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
  // Scratch copy of dgwvHistory: DGW validation needs it to advance as
  // we walk the batch, but we only commit back to the live buffer after
  // every header in the batch has passed. A mid-batch failure leaves the
  // persisted state untouched.
  const historyScratch = dgwvHistory.slice();

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
    if (historyScratch.length >= DGW_PAST_BLOCKS) {
      const expected = dgwv3ExpectedBits(historyScratch.slice(-DGW_PAST_BLOCKS));
      if (nBits !== expected) {
        console.warn(`[spv] header rejected at ~${h + 1}: DGWv3 mismatch nBits=0x${nBits.toString(16)} expected=0x${expected.toString(16)}`);
        return false;
      }
    }
    const hashHex = hashHeaderRaw(raw);
    if (BigInt('0x' + hashHex) > target) {
      console.warn(`[spv] header rejected at ~${h + 1}: PoW fail hash ${hashHex.slice(0, 16)}…`);
      return false;
    }

    h++;
    prevHash = hashHex;
    added.push({ height: h, hash: hashHex });
    historyScratch.push({ time, nBits });
    if (historyScratch.length > DGW_PAST_BLOCKS) historyScratch.shift();
  }

  const prevHeight = chainTipHeight;
  chainTipHeight = h;
  chainTipHash = prevHash;
  for (const a of added) hashToHeight.set(a.hash, a.height);
  batchHashes.set(chainTipHeight, chainTipHash);
  dgwvHistory.length = 0;
  for (const e of historyScratch) dgwvHistory.push(e);

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

// Single source of truth for in-flight filtered-block requests. Keyed by
// display-hex hash. peerOutstandingCount is a derived O(1) counter kept
// in lockstep; every mutation must go through addInFlight / removeInFlight
// so the two never drift.
interface InFlightRequest { peer: Peer; hashBytes: Uint8Array; sentAtMs: number }
const inFlightRequests = new Map<string, InFlightRequest>();
const peerOutstandingCount = new Map<Peer, number>();

function addInFlight(peer: Peer, hashBytes: Uint8Array): void {
  const hashHex = bytesToHexReversed(hashBytes);
  inFlightRequests.set(hashHex, { peer, hashBytes, sentAtMs: Date.now() });
  peerOutstandingCount.set(peer, (peerOutstandingCount.get(peer) ?? 0) + 1);
}

// Removes the entry and returns it. Returns null if the hash is no longer
// tracked (late arrival, or already requeued by the watchdog).
function removeInFlight(hashHex: string): InFlightRequest | null {
  const req = inFlightRequests.get(hashHex);
  if (!req) return null;
  inFlightRequests.delete(hashHex);
  const n = peerOutstandingCount.get(req.peer) ?? 0;
  if (n > 0) peerOutstandingCount.set(req.peer, n - 1);
  return req;
}

function outstanding(peer: Peer): number {
  return peerOutstandingCount.get(peer) ?? 0;
}

// Per-peer backoff. A peer that stalls STALL_STRIKES times is put on
// cooldown: excluded from dispatch / paging-leader candidacy until
// peerCooldownUntilMs, at which point we let it probe once more.
const peerStallCount = new Map<Peer, number>();
const peerCooldownUntilMs = new Map<Peer, number>();
const STALL_TIMEOUT_MS = 45_000;
const STALL_STRIKES = 3;
const COOLDOWN_MS = 120_000;
const WATCHDOG_INTERVAL_MS = 15_000;

function peerOnCooldown(peer: Peer): boolean {
  const until = peerCooldownUntilMs.get(peer);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    peerCooldownUntilMs.delete(peer);
    return false;
  }
  return true;
}

let pagingDone = false;
let blocksScanned = 0;
let lastSaveAtBlock = 0;
let primaryPassBlocks = 0;
let pagingPeer: Peer | null = null;
let awaitingPageFrom: Peer | null = null;
let inReconcile = false;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

function phaseLabel(): string { return inReconcile ? '[reconcile]' : '[scan]'; }

function pickPagingPeer(): Peer | null {
  if (pagingPeer && readyPeers.has(pagingPeer) && !peerOnCooldown(pagingPeer)) return pagingPeer;
  pagingPeer = null;
  for (const p of readyPeers) {
    if (!peerOnCooldown(p)) { pagingPeer = p; break; }
  }
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
  startScanWatchdog();
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
  if (peerOnCooldown(peer)) return;
  const have = outstanding(peer);
  const room = FILTERED_BLOCK_BATCH - have;
  if (room <= 0) return;

  const take = Math.min(room, pendingBlocks.length);
  const hashes = pendingBlocks.splice(0, take);
  for (const h of hashes) addInFlight(peer, h);

  const items = hashes.map(hash => ({ type: Inventory.TYPE.FILTERED_BLOCK, hash }));
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
  if (inFlightRequests.size > 0) return;
  if (!inReconcile && startReconciliationPass()) return;

  stopScanWatchdog();
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

// Watchdog: requeue in-flight requests whose peer has gone silent past
// STALL_TIMEOUT_MS. Timeout is per-request (sentAtMs), so a peer making
// steady progress is unaffected — only individual stalled hashes move.
// Late arrivals from the original peer are handled in peermerkleblock by
// the removeInFlight(null) branch: they're still merkle-verified and
// applied idempotently, but the scheduler bookkeeping is skipped.
function sweepStalledRequests(): void {
  if (phase !== 'birthday-scan' || inFlightRequests.size === 0) return;

  const now = Date.now();
  const cap = Math.max(4, Math.floor(inFlightRequests.size * 0.1));
  const stalledHashes: string[] = [];
  const stalledPeers = new Set<Peer>();

  for (const [hashHex, req] of inFlightRequests) {
    if (now - req.sentAtMs <= STALL_TIMEOUT_MS) continue;
    stalledHashes.push(hashHex);
    stalledPeers.add(req.peer);
    if (stalledHashes.length >= cap) break;
  }

  if (stalledHashes.length === 0) return;

  for (const hashHex of stalledHashes) {
    const req = removeInFlight(hashHex);
    if (req) pendingBlocks.push(req.hashBytes);
  }

  for (const peer of stalledPeers) {
    const strikes = (peerStallCount.get(peer) ?? 0) + 1;
    if (strikes >= STALL_STRIKES) {
      peerCooldownUntilMs.set(peer, now + COOLDOWN_MS);
      peerStallCount.set(peer, 0);
      if (pagingPeer === peer) pagingPeer = null;
      console.warn(`[watchdog] ${peer.host} on cooldown for ${COOLDOWN_MS / 1000}s after ${STALL_STRIKES} stalls`);
    } else {
      peerStallCount.set(peer, strikes);
      console.warn(`[watchdog] ${peer.host} stalled on ${stalledHashes.length} block(s) (strike ${strikes}/${STALL_STRIKES})`);
    }
  }

  drainToIdlePeers();
  checkScanDone();
}

function startScanWatchdog(): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(sweepStalledRequests, WATCHDOG_INTERVAL_MS);
  watchdogTimer.unref?.();
}

function stopScanWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
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

// Live-phase stash for txs that arrive ahead of their merkleblock. A
// peer that ships `tx` before `merkleblock` leaves us without a verified
// merkle proof; we park the tx here keyed by txid and drain it once the
// merkleblock lands and the txid appears in the verified matches set.
const pendingTxs = new Map<string, { tx: Transaction; firstSeenMs: number }>();
const PENDING_TX_TTL_MS = 10 * 60 * 1000;

function sweepPendingTxs(): void {
  if (pendingTxs.size === 0) return;
  const now = Date.now();
  for (const [txid, entry] of pendingTxs) {
    if (now - entry.firstSeenMs > PENDING_TX_TTL_MS) pendingTxs.delete(txid);
  }
}

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

// SPV gate for getblocks paging. Every inv hash must already be in
// hashToHeight (populated only by PoW-verified processHeaders) and sit at
// the next expected height; on the first mismatch we stop so the scan only
// ever touches blocks we validated ourselves. scanLocatorHash/Height
// advance over the validated prefix, so the next getblocks resumes from
// the last good position rather than stalling on one bad entry.
function queuePagingBlocks(blockItems: Array<{ type: number; hash: Uint8Array }>): number {
  let expected = scanLocatorHeight + 1;
  let lastHash: string | null = null;
  let queued = 0;

  for (const item of blockItems) {
    const hash = bytesToHexReversed(item.hash);
    const known = hashToHeight.get(hash);
    if (known === undefined) {
      console.warn(`[spv] paging peer returned unverified block ${hash.slice(0, 16)}… near height=${expected} — truncating`);
      break;
    }
    if (known !== expected) {
      console.warn(`[spv] paging out-of-order: expected height=${expected} got=${known} (${hash.slice(0, 16)}…) — truncating`);
      break;
    }
    pendingBlocks.push(item.hash);
    lastHash = hash;
    expected++;
    queued++;
  }

  if (queued > 0) {
    scanLocatorHeight = expected - 1;
    scanLocatorHash = lastHash;
  }
  return queued;
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

function continuePaging(peer: Peer, queued: number): void {
  awaitingPageFrom = null;

  if (scanLocatorHeight >= chainTipHeight) {
    pagingDone = true;
    console.log(`${phaseLabel()} all blocks queued  pending=${pendingBlocks.length}  at-height=${scanLocatorHeight}`);
    checkScanDone();
    return;
  }

  // Nothing usable came back — empty inv, or every hash failed the SPV
  // gate. Try another peer from the same locator; if this is our only
  // peer, wait for peerready/peerdisconnect to re-drive the scan.
  if (queued === 0) {
    console.warn(`[scan] peer ${peer.host} returned no usable paging data at height=${scanLocatorHeight}, retrying`);
    const fallback = [...readyPeers].find(p => p !== peer);
    if (fallback) requestBlockBatch(fallback, scanLocatorHash!);
    return;
  }

  // queuePagingBlocks advanced scanLocatorHash to the last validated hash.
  const leader = pickPagingPeer() ?? peer;
  requestBlockBatch(leader, scanLocatorHash!);
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
    if (processHeaders(rawHeaders) && chainTipHash !== chainTipHash) {
      // Ask this peer for filtered blocks so merkleblocks flow, which
      // populates peerMerkleCtx and drains pendingTxs.
      const items = rawHeaders.map(raw => ({
        type: Inventory.TYPE.FILTERED_BLOCK,
        hash: hexToBytes(hashHeaderRaw(raw)).reverse(),
      }));
      if (items.length > 0) peer.sendMessage(M.GetData(items));
    }
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
  if (isPaging) continuePaging(peer, queued);
});

pool.on('peermerkleblock', (peer: Peer, message: Message & { merkleBlock: MerkleBlock }) => {
  const mb = message.merkleBlock;
  const blockHash = mb.blockHeader.hash();

  // Consume the scheduler slot (if any). `req` is null for late arrivals
  // — i.e. we already requeued this hash because the original peer
  // stalled, and some peer (possibly this one, possibly not) has just
  // responded. We still do the merkle verification and apply matches,
  // but we skip bookkeeping so we don't under-count outstanding or
  // double-credit blocksScanned.
  const req = removeInFlight(blockHash);
  const late = req === null;

  const height = hashToHeight.get(blockHash);
  if (height === undefined) {
    console.warn(`[spv] merkleblock for unknown block ${blockHash.slice(0, 16)}… from ${peer.host} — rejecting`);
    if (!late) {
      maybeRefill(peer);
      checkScanDone();
    }
    return;
  }

  const matches: string[] = [];
  const indexes: number[] = [];
  try {
    mb.merkleTree.extractMatches(matches, indexes);
  } catch (e) {
    console.warn(`[spv] merkleRoot mismatch at height=${height}: ${(e as Error).message}`);
    if (!late) checkScanDone();
    return;
  }

  const matchSet = new Set(matches.map(m => bytesToHexReversed(hexToBytes(m)).toLowerCase()));
  peerMerkleCtx.set(peer, { blockHash, height, matches: matchSet });

  if (pendingTxs.size > 0 && matchSet.size > 0) {
    for (const txid of matchSet) {
      const stashed = pendingTxs.get(txid);
      if (!stashed) continue;
      pendingTxs.delete(txid);
      applyTransaction(stashed.tx, height);
    }
    sweepPendingTxs();
  }

  if (matches.length > 0) {
    console.log(`${phaseLabel()} block ${blockHash.slice(0, 16)}… (h=${height})  matched ${matches.length} tx(s)`);
  }

  if (late) return;  // tx application was idempotent; skip the scheduler book-keeping.

  // Successful response resets the peer's stall strikes.
  if (peerStallCount.get(peer)) peerStallCount.set(peer, 0);

  blocksScanned++;
  if (blocksScanned % 100 === 0) {
    console.log(`${phaseLabel()} ${blocksScanned} blocks verified  pending=${pendingBlocks.length}  in-flight=${inFlightRequests.size}  peers=${readyPeers.size}`);
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
  const ctx = peerMerkleCtx.get(peer);

  if (ctx && ctx.matches.has(txid)) {
    applyTransaction(tx, ctx.height);
    return;
  }

  if (phase === 'birthday-scan') {
    console.warn(`[spv] tx ${txid.slice(0, 16)}… from ${peer.host} not in merkleblock matches — rejecting`);
    return;
  }

  // Live phase: a tx may arrive before its merkleblock. Park it keyed by
  // txid and drain when a merkleblock whose verified matches include
  // this txid lands. Unverified floating txs are never applied.
  if (!pendingTxs.has(txid)) {
    pendingTxs.set(txid, { tx, firstSeenMs: Date.now() });
  }
  sweepPendingTxs();
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
  peerMerkleCtx.delete(peer);
  peerStallCount.delete(peer);
  peerCooldownUntilMs.delete(peer);

  // Requeue every in-flight request owned by this peer.
  const orphanedHashes: string[] = [];
  for (const [hashHex, req] of inFlightRequests) {
    if (req.peer === peer) orphanedHashes.push(hashHex);
  }
  for (const hashHex of orphanedHashes) {
    const req = removeInFlight(hashHex);
    if (req) pendingBlocks.push(req.hashBytes);
  }
  peerOutstandingCount.delete(peer);

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

console.log(`Connecting to Dash ${NETWORK} (SPV-verified, outpoint-aware filter)…`);
pool.connect();

process.on('SIGINT', () => {
  console.log('\nDisconnecting…');
  saveSyncState();
  pool.disconnect();
  process.exit(0);
});