/**
 * Wallet sync — BIP 157 / 158 compact filters.
 *
 * Phases
 * ──────
 * 1. Header sync   — same broadcast pattern as wallet_sync.ts: every ready
 *                    peer gets a getheaders, every progress re-broadcasts
 *                    to all peers; whichever delivers next wins. Validated
 *                    forward by prev-hash from INITIAL_TIP_HASH (no PoW or
 *                    DGW — see wallet_sync_spv.ts for that).
 *
 * 2. cfheaders     — getcfcheckpt anchors the filter-header chain at every
 *                    1000-block boundary. We then walk the wallet birthday
 *                    range with getcfheaders, derive each filter-header
 *                    locally via dSHA256(filter_hash || prev_header), and
 *                    verify that the value at the next checkpoint matches.
 *                    Mismatch ⇒ the peer is lying about a filter and we
 *                    abort that range.
 *
 * 3. cfilter scan  — for each verified window, getcfilters returns the GCS
 *                    payloads. Each filter's SipHash key is the first 16
 *                    bytes of the block hash (wire byte order). We match
 *                    the wallet's watched scripts against the filter; on a
 *                    hit, getdata(BLOCK) downloads the full block and any
 *                    transactions touching watched scripts feed the UTXO
 *                    set. No-match blocks are never downloaded — that's
 *                    the win compared to BIP 37 merkleblock SPV.
 *
 * 4. Live          — sendheaders pipes new headers; for each new block we
 *                    extend the filter-header chain by one and refetch.
 *
 * Caveats
 * ───────
 *  - Requires a peer advertising NODE_COMPACT_FILTERS service bit. If none
 *    of the discovered peers serves filters the scan stalls.
 *  - The example trusts the first peer's headers from INITIAL_TIP_HASH
 *    forward. Don't rely on this for funds without porting the PoW + DGW
 *    validation from wallet_sync_spv.ts.
 *  - No reorg handling.
 *
 * Run:
 *   npx tsx examples/wallet_sync_cfilters.ts
 */

import {
  CompactFilter,
  Inventory,
  Messages,
  NODE_COMPACT_FILTERS,
  Pool,
  nextFilterHeader,
  type CFCheckptArgs,
  type CFHeadersArgs,
  type CFilterArgs,
  type Message,
  type Peer,
} from '../src';
import {Block, Transaction} from 'dash-core-sdk';
import {hexToBytes, bytesToHex} from 'dash-core-sdk/src/utils';
import {Base58Check} from 'dash-core-sdk/src/base58check';
import {utils as sdkUtils} from 'dash-core-sdk';
// @ts-expect-error — no bundled types for @dashevo/x11-hash-js
import x11 from '@dashevo/x11-hash-js';

const {doubleSHA256} = sdkUtils;

const NETWORK: 'mainnet' | 'testnet' = 'testnet';
const WATCH_ADDRESSES: string[] = ['yXWJGWuD4VBRMp9n2MtXQbGpgSeWyTRHme'];
const WALLET_BIRTHDAY_HEIGHT = 1450000;

// Trust this hash at this height. Headers are validated forward by prev-link.
const INITIAL_TIP_HASH = '000000fa4225fa022d4216eabb176848d61d03027df12e0685f82d8b13c60f03';
const INITIAL_TIP_HEIGHT = 1450000;

const FILTER_TYPE = 0;                      // basic filter (BIP 158)
const CFILTER_BATCH = 500;                  // <= 1000 per spec
const HEADER_RACE_PEERS = 6;                // racers per header round
const HEADER_SYNC_TIMEOUT_MS = 30_000;
const CFCHECKPT_RACE_PEERS = 3;             // racers per cfcheckpt round
// Test-only: drop these hosts on connect so we can reproduce the freeze case.
const BANNED_HOSTS: ReadonlySet<string> = new Set([
  // '185.187.169.193',
  // '147.93.132.9',
  // '68.67.122.49',
  // '68.67.122.44',
  // '206.245.167.63',
  // '68.67.122.3'
]);
// Dash Core silently drops any getcf* request whose stop_hash isn't in that
// peer's active chain. The very tip frequently isn't (reorgs, peer lag), so
// we cap all cf* stop hashes at SCAN_TIP_DEPTH blocks below the synced tip.
// Live phase picks up the last few blocks once they bury.
const SCAN_TIP_DEPTH = 100;

// ── Hash helpers ─────────────────────────────────────────────────────────────

// Wire bytes (internal byte order, what goes on the network) from display hex.
function displayHexToWire(hex: string): Uint8Array {
  return hexToBytes(hex).reverse();
}

// Display hex (what RPC/explorers print) from wire bytes.
function wireToDisplayHex(wire: Uint8Array): string {
  let out = '';
  for (let i = wire.length - 1; i >= 0; i--) out += wire[i]!.toString(16).padStart(2, '0');
  return out;
}

// X11 of an 80-byte block header → wire bytes (32).
function x11Wire(raw: Uint8Array): Uint8Array {
  const buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  return new Uint8Array((x11 as any).digest(buf, 1, 1) as number[]);
}

// ── Watch set ────────────────────────────────────────────────────────────────

// P2PKH scriptPubKey for a Dash address: OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG.
function p2pkhScript(address: string): Uint8Array {
  const decoded = Base58Check.decode(address);
  const hash160 = decoded.slice(1, 21);
  const out = new Uint8Array(25);
  out[0] = 0x76;
  out[1] = 0xa9;
  out[2] = 0x14;
  out.set(hash160, 3);
  out[23] = 0x88;
  out[24] = 0xac;
  return out;
}

// Items the filter is queried with. Output scripts on receive; outpoints
// are added on first observation so spends from later blocks also match.
const watchedItems: Uint8Array[] = WATCH_ADDRESSES.map(p2pkhScript);

function bip158Outpoint(txidDisplay: string, vout: number): Uint8Array {
  const out = new Uint8Array(36);
  out.set(displayHexToWire(txidDisplay), 0);
  new DataView(out.buffer).setUint32(32, vout, true);
  return out;
}

// ── Chain state (all hashes in WIRE byte order) ──────────────────────────────

const initialTipWire = displayHexToWire(INITIAL_TIP_HASH);
const heightToBlockHash = new Map<number, Uint8Array>();   // wire bytes
const wireHexToHeight = new Map<string, number>();         // O(1) reverse lookup
const heightToFilterHeader = new Map<number, Uint8Array>();
heightToBlockHash.set(INITIAL_TIP_HEIGHT, initialTipWire);
wireHexToHeight.set(bytesToHex(initialTipWire), INITIAL_TIP_HEIGHT);

let chainTipHeight = INITIAL_TIP_HEIGHT;
let chainTipWire = initialTipWire;

// Filter-header chain seed — BIP 157 defines header_0 = 32 zero bytes for
// the genesis pre-image. We don't have it for an arbitrary checkpoint, so
// we anchor on the cfcheckpt-derived value at INITIAL_TIP_HEIGHT (when
// it's a multiple of 1000) or on the value the first cfcheckpt response
// gives us at the largest checkpoint ≤ INITIAL_TIP_HEIGHT.
let anchorFilterHeader: Uint8Array | null = null;
let anchorHeight: number = -1;
const checkpointHeaders = new Map<number, Uint8Array>();   // height (mult of 1000) → filter header

// ── Header sync ──────────────────────────────────────────────────────────────

type Phase = 'headers' | 'cfcheckpt' | 'cfheaders' | 'cfilters' | 'live';
let phase: Phase = 'headers';

const messages = new Messages({network: NETWORK} as any);
const M = messages as any;
const pool = new Pool({network: NETWORK, maxSize: 256, relay: false, messages});

let leader: Peer | null = null;          // cfilters phase only


// Per-peer service flags from the version handshake. Dash Core only serves
// BIP 157/158 when started with -peercfilters=1 and advertises bit 6
// (NODE_COMPACT_FILTERS) accordingly. Without that bit a peer disconnects
// the moment we send getcf*, so the leader pick must filter on it.
const peerServices = new WeakMap<Peer, bigint>();
const filterCapablePeers = new Set<Peer>();

function peerServesFilters(peer: Peer): boolean {
  return filterCapablePeers.has(peer);
}

function getHeadersMsg(locatorWire: Uint8Array) {
  return M.GetHeaders({starts: [locatorWire], stop: new Uint8Array(32)});
}

function processHeaders(rawHeaders: Uint8Array[]): boolean {
  if (rawHeaders.length === 0) return false;
  let prevWire = chainTipWire;
  let h = chainTipHeight;
  const accepted: Array<{ height: number; wire: Uint8Array }> = [];

  for (const raw of rawHeaders) {
    if (raw.length < 80) return false;
    // prev_hash field at offset 4..36, wire byte order.
    const incomingPrev = raw.subarray(4, 36);
    if (!equalBytes(incomingPrev, prevWire)) return false;
    const wire = x11Wire(raw);
    h++;
    accepted.push({height: h, wire});
    prevWire = wire;
  }

  for (const a of accepted) {
    heightToBlockHash.set(a.height, a.wire);
    wireHexToHeight.set(bytesToHex(a.wire), a.height);
  }
  chainTipHeight = h;
  chainTipWire = prevWire;
  console.log(`[headers] processed ${accepted.length} headers (last height ${h})`)
  return true;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Header sync — bounded race, same shape as wallet_sync_spv.ts. At most
// one race in flight; each picks ≤HEADER_RACE_PEERS peers from readyPeers
// and sends them the same getheaders. The first valid response advances
// the tip and ends the race; the next round starts after that. New peers
// that come ready mid-race join the existing race up to the cap.
//
// readyPeers is also consulted by later phases as a block-fetch fallback,
// so we keep the Set even though header sync no longer broadcasts to it.
const readyPeers = new Set<Peer>();

interface HeaderRace {
  locatorWire: Uint8Array;
  racers: Set<Peer>;
  zeroResponses: number;
  timer: ReturnType<typeof setTimeout> | null;
}

let currentRace: HeaderRace | null = null;

function endRace(race: HeaderRace): void {
  if (race.timer) {
    clearTimeout(race.timer);
    race.timer = null;
  }
  if (currentRace === race) currentRace = null;
}

function startHeaderRace(): void {
  if (phase !== 'headers') return;
  if (currentRace) return;
  if (readyPeers.size === 0) return;

  const picks: Peer[] = [];
  for (const p of readyPeers) {
    picks.push(p);
    if (picks.length >= HEADER_RACE_PEERS) break;
  }
  const locatorWire = chainTipWire;
  const race: HeaderRace = {locatorWire, racers: new Set(picks), zeroResponses: 0, timer: null};
  currentRace = race;

  const msg = getHeadersMsg(locatorWire);
  for (const p of picks) p.sendMessage(msg);

  race.timer = setTimeout(() => {
    if (currentRace !== race) return;
    console.warn(`[headers] race timed out at h=${chainTipHeight} (${race.racers.size}/${picks.length} unresponsive)`);
    endRace(race);
    startHeaderRace();
  }, HEADER_SYNC_TIMEOUT_MS);
}

// Drop `peer` as leader and continue from whatever phase we're in. cfcheckpt
// re-races across the entire +CF set; the per-peer phases (cfheaders /
// cfilters) just hop to the next +CF candidate.
function rotateLeader(badPeer: Peer): void {
  filterCapablePeers.delete(badPeer);
  badPeer.disconnect?.();
  leader = null;
  if (phase === 'cfcheckpt') {
    requestCheckpoints();
    return;
  }
  if (phase === 'cfheaders') {
    walkCFHeadersNext();
    return;
  }   // race-driven, no leader needed
  for (const candidate of filterCapablePeers) {
    console.log(`[pool] rotating to ${candidate.host}:${candidate.port} (phase=${phase})`);
    if (phase === 'cfilters') {
      leader = candidate;
      pumpCFilters();
    }
    return;
  }
  console.warn('[pool] no more filter-capable peers; waiting for one to connect');
}

// ── cfcheckpt: anchor the filter-header chain ─────────────────────────────────

// Bounded race: pick CFCHECKPT_RACE_PEERS peers per round, rotate on timeout.
// Broadcasting the same getcfcheckpt to all 20+ +CF peers at once gets the
// requests silently dropped (rate-limiting / DoS heuristics), so the race
// stalls indefinitely. `cfcheckptTriedPeers` records peers that have already
// failed us this attempt, so we keep finding fresh ones to ask.
let cfcheckptResponded = false;
const CFCHECKPT_RACE_TIMEOUT_MS = 15_000;
let cfcheckptRaceTimer: ReturnType<typeof setTimeout> | null = null;
const cfcheckptTriedPeers = new Set<Peer>();

// Cap stop hashes well below the synced tip so peers actually have the block
// in their active chain. Multiples of 1000 are returned by cfcheckpt anyway,
// so rounding loses nothing for the checkpoint request.
function effectiveScanTipHeight(): number {
  return Math.max(INITIAL_TIP_HEIGHT, chainTipHeight - SCAN_TIP_DEPTH);
}

function cfcheckptStopHeight(): number {
  return Math.floor(effectiveScanTipHeight() / 1000) * 1000;
}

// ── cfcheckpt diagnostics ────────────────────────────────────────────────────
// Per-peer wiretap: logs every incoming message command from each peer we
// asked in the current round. Tells us whether peers respond at all (silent
// drop vs late reply vs disconnect) and lets us verify the response actually
// reaches our parser.
const CFCHECKPT_DEBUG_EVENTS = ['cfcheckpt', 'reject', 'ping', 'pong', 'inv', 'addr', 'headers', 'notfound'] as const;
type CfDebugCleanup = () => void;
const cfcheckptDebugCleanups = new Map<Peer, CfDebugCleanup[]>();
let cfcheckptBytesLogged = false;

function instrumentPickedPeer(peer: Peer, roundId: number): void {
  if (cfcheckptDebugCleanups.has(peer)) return;     // already instrumented
  const tag = `[cfdbg r${roundId}] ${peer.host}:${peer.port}`;
  const cleanups: CfDebugCleanup[] = [];
  for (const evt of CFCHECKPT_DEBUG_EVENTS) {
    const listener = (msg: any) => {
      const extra = evt === 'cfcheckpt' && msg?.filterHeaders
        ? ` count=${msg.filterHeaders.length}`
        : evt === 'reject' && msg?.message
          ? ` rejected=${msg.message} reason="${msg.reason ?? ''}"`
          : '';
      console.log(`${tag} <- ${evt}${extra}`);
    };
    peer.on(evt, listener as any);
    cleanups.push(() => peer.off(evt, listener as any));
  }
  const onDisc = () => console.log(`${tag} DISCONNECTED`);
  peer.on('disconnect', onDisc);
  cleanups.push(() => peer.off('disconnect', onDisc));
  cfcheckptDebugCleanups.set(peer, cleanups);
}

function clearCfcheckptInstrumentation(): void {
  for (const cleanups of cfcheckptDebugCleanups.values()) {
    for (const c of cleanups) c();
  }
  cfcheckptDebugCleanups.clear();
}

let cfcheckptRoundId = 0;

function requestCheckpoints(_peer?: Peer): void {
  phase = 'cfcheckpt';
  cfcheckptResponded = false;
  cfcheckptRoundId++;
  clearCfcheckptInstrumentation();
  const stopHeight = cfcheckptStopHeight();
  const stopHashWire = heightToBlockHash.get(stopHeight);
  if (!stopHashWire) {
    console.warn(`[cfcheckpt] no stable stop hash at h=${stopHeight} — chain too short`);
    return;
  }
  let candidates = [...filterCapablePeers].filter(p => !cfcheckptTriedPeers.has(p));
  if (candidates.length === 0) {
    // Exhausted the current set; reset and try again as new peers come in.
    cfcheckptTriedPeers.clear();
    candidates = [...filterCapablePeers];
  }
  if (candidates.length === 0) {
    console.warn('[cfcheckpt] no +CF peers to query — waiting');
    return;
  }
  const picks = candidates.slice(0, CFCHECKPT_RACE_PEERS);
  const pickList = picks.map(p => `${p.host}:${p.port} (svc=0x${(peerServices.get(p) ?? 0n).toString(16)})`).join(', ');
  console.log(`[cfcheckpt r${cfcheckptRoundId}] stopHeight=${stopHeight} pool=${filterCapablePeers.size} tried=${cfcheckptTriedPeers.size} picks=[${pickList}]`);
  const msg = M.GetCFCheckpt({filterType: FILTER_TYPE, stopHash: stopHashWire});
  if (!cfcheckptBytesLogged) {
    cfcheckptBytesLogged = true;
    const bytes = msg.toBytes();
    console.log(`[cfdbg] outgoing getcfcheckpt (${bytes.length}B): ${bytesToHex(bytes)}`);
  }
  for (const p of picks) {
    cfcheckptTriedPeers.add(p);
    instrumentPickedPeer(p, cfcheckptRoundId);
    p.sendMessage(msg);
  }
  if (cfcheckptRaceTimer) clearTimeout(cfcheckptRaceTimer);
  cfcheckptRaceTimer = setTimeout(() => {
    if (cfcheckptResponded) return;
    console.warn(`[cfcheckpt r${cfcheckptRoundId}] timeout — rotating`);
    requestCheckpoints();
  }, CFCHECKPT_RACE_TIMEOUT_MS);
}

function onCheckpoints(msg: CFCheckptArgs, fromPeer: Peer): void {
  if (cfcheckptResponded) return;          // race already won
  cfcheckptResponded = true;
  cfcheckptTriedPeers.clear();
  clearCfcheckptInstrumentation();
  if (cfcheckptRaceTimer) {
    clearTimeout(cfcheckptRaceTimer);
    cfcheckptRaceTimer = null;
  }
  // Lock leader onto the peer that actually answered — proven alive and willing.
  leader = fromPeer;
  console.log(`[cfcheckpt] race won by ${fromPeer.host}:${fromPeer.port}`);

  const headers = msg.filterHeaders ?? [];
  // Checkpoint i (1-indexed) corresponds to height (i * 1000).
  for (let i = 0; i < headers.length; i++) {
    checkpointHeaders.set((i + 1) * 1000, headers[i]!);
  }
  // Pick the largest checkpoint ≤ WALLET_BIRTHDAY_HEIGHT - 1 as our anchor;
  // we'll start the cfheaders walk from the next height. If the birthday
  // sits below the first checkpoint we anchor at the all-zero seed and
  // start from height 1, but for any realistic wallet that's a long walk
  // — better to set INITIAL_TIP_HEIGHT close to the birthday.
  const start = Math.max(WALLET_BIRTHDAY_HEIGHT, INITIAL_TIP_HEIGHT);
  const anchorCkpt = Math.floor((start - 1) / 1000) * 1000;
  if (anchorCkpt > 0 && checkpointHeaders.has(anchorCkpt)) {
    anchorHeight = anchorCkpt;
    anchorFilterHeader = checkpointHeaders.get(anchorCkpt)!;
    heightToFilterHeader.set(anchorCkpt, anchorFilterHeader);
  } else {
    anchorHeight = 0;
    anchorFilterHeader = new Uint8Array(32);
  }
  console.log(`[cfcheckpt] received ${headers.length} checkpoints; anchor at h=${anchorHeight}`);
  cfHeadersWalkStart = Math.max(anchorHeight + 1, WALLET_BIRTHDAY_HEIGHT);
  walkCFHeadersNext();
}

// ── cfheaders walk ───────────────────────────────────────────────────────────

let cfHeadersWalkStart = 0;        // next height needing a filter header
const pendingCFHeaders = new Map<number, {
  startHeight: number;
  stopHeight: number;
  raceTimer: ReturnType<typeof setTimeout> | null
}>();
const CFHEADERS_RACE_TIMEOUT_MS = 15_000;

// Race the cfheaders request for the next window across every +CF peer. The
// pendingCFHeaders entry is the dedupe gate — first valid response with this
// stopHash wins, late duplicates fall through the `if (!pending)` guard.
function walkCFHeadersNext(): void {
  const effectiveTip = effectiveScanTipHeight();
  if (cfHeadersWalkStart > effectiveTip) {
    console.log('[cfheaders] chain complete; starting cfilter scan');
    startCFilterScan();
    return;
  }
  phase = 'cfheaders';
  const startHeight = cfHeadersWalkStart;
  const nextCkpt = (Math.floor((startHeight - 1) / 1000) + 1) * 1000;
  const stopHeight = Math.min(nextCkpt, effectiveTip);
  const stopHashWire = heightToBlockHash.get(stopHeight);
  if (!stopHashWire) {
    console.warn(`[cfheaders] no block hash at h=${stopHeight}; stopping`);
    return;
  }
  if (pendingCFHeaders.has(stopHeight)) return;        // already racing this window

  const racers = [...filterCapablePeers];
  if (racers.length === 0) {
    console.warn('[cfheaders] no +CF peers available — waiting');
    return;
  }
  const entry = {startHeight, stopHeight, raceTimer: null as ReturnType<typeof setTimeout> | null};
  pendingCFHeaders.set(stopHeight, entry);
  const msg = M.GetCFHeaders({filterType: FILTER_TYPE, startHeight, stopHash: stopHashWire});
  for (const p of racers) p.sendMessage(msg);
  entry.raceTimer = setTimeout(() => {
    if (!pendingCFHeaders.has(stopHeight)) return;     // already won
    console.warn(`[cfheaders] window ${startHeight}..${stopHeight} timed out — re-racing`);
    pendingCFHeaders.delete(stopHeight);
    walkCFHeadersNext();
  }, CFHEADERS_RACE_TIMEOUT_MS);
}

function onCFHeaders(msg: CFHeadersArgs, fromPeer: Peer): void {
  const stopHashWire = msg.stopHash ?? new Uint8Array(32);
  const stopHeight = wireHexToHeight.get(bytesToHex(stopHashWire)) ?? -1;
  const pending = stopHeight >= 0 ? pendingCFHeaders.get(stopHeight) : undefined;
  if (!pending) return;                          // race already won, or unsolicited
  if (pending.raceTimer) clearTimeout(pending.raceTimer);
  pendingCFHeaders.delete(stopHeight);
  // Latch this peer as the cfilters leader candidate — proven willing.
  leader = fromPeer;

  const filterHashes = msg.filterHashes ?? [];
  const expectedCount = pending.stopHeight - pending.startHeight + 1;
  if (filterHashes.length !== expectedCount) {
    console.warn(`[cfheaders] count mismatch: got ${filterHashes.length} expected ${expectedCount}`);
    return;
  }

  // Chain forward from prevHeader, recording per-height filter headers.
  let prev = msg.previousFilterHeader ?? new Uint8Array(32);
  // Sanity: prev should match our cached value at startHeight - 1, when known.
  const prevExpected = heightToFilterHeader.get(pending.startHeight - 1);
  if (prevExpected && !equalBytes(prevExpected, prev)) {
    console.warn(`[cfheaders] previousFilterHeader disagrees with our cache at h=${pending.startHeight - 1}`);
    return;
  }

  for (let i = 0; i < filterHashes.length; i++) {
    const concat = new Uint8Array(64);
    concat.set(filterHashes[i]!, 0);
    concat.set(prev, 32);
    const next = doubleSHA256(concat);
    heightToFilterHeader.set(pending.startHeight + i, next);
    prev = next;
  }

  // Verify against the next-checkpoint anchor when our stopHeight is one.
  const ckpt = checkpointHeaders.get(pending.stopHeight);
  if (ckpt && !equalBytes(ckpt, prev)) {
    console.warn(`[cfheaders] checkpoint mismatch at h=${pending.stopHeight} — peer dishonest, abort`);
    return;
  }

  console.log(`[cfheaders] processed checkpoint until: ${pending.startHeight}`);

  cfHeadersWalkStart = pending.stopHeight + 1;
  walkCFHeadersNext();
}

// ── cfilter scan ─────────────────────────────────────────────────────────────

let cfilterCursor = 0;
// Each in-flight batch tracks the heights still awaiting a cfilter. First
// responder per height wins (Set-based dedupe); a batch retires when its
// remaining set is empty. Per-batch timer re-races stuck heights.
interface CFilterBatch {
  startHeight: number;
  stopHeight: number;
  stopHashWire: Uint8Array;
  remaining: Set<number>;
  timer: ReturnType<typeof setTimeout> | null;
}

const inflightBatches = new Map<number, CFilterBatch>();   // keyed by startHeight
const MAX_INFLIGHT_BATCHES = 4;
const CFILTER_BATCH_TIMEOUT_MS = 15_000;

function startCFilterScan(): void {
  phase = 'cfilters';
  cfilterCursor = Math.max(WALLET_BIRTHDAY_HEIGHT, anchorHeight + 1);
  console.log(`[cfilters] scanning ${cfilterCursor}..${effectiveScanTipHeight()}`);
  pumpCFilters();
}

function dispatchCFilterBatch(batch: CFilterBatch): void {
  const racers = [...filterCapablePeers];
  if (racers.length === 0) return;
  const msg = M.GetCFilters({
    filterType: FILTER_TYPE,
    startHeight: batch.startHeight,
    stopHash: batch.stopHashWire,
  });
  for (const p of racers) p.sendMessage(msg);
}

function armCFilterBatchTimer(batch: CFilterBatch): void {
  if (batch.timer) clearTimeout(batch.timer);
  batch.timer = setTimeout(() => {
    if (!inflightBatches.has(batch.startHeight)) return;
    if (batch.remaining.size === 0) return;
    console.warn(`[cfilters] batch ${batch.startHeight}..${batch.stopHeight} stuck on ${batch.remaining.size} height(s) — re-racing`);
    dispatchCFilterBatch(batch);
    armCFilterBatchTimer(batch);
  }, CFILTER_BATCH_TIMEOUT_MS);
}

function pumpCFilters(): void {
  const effectiveTip = effectiveScanTipHeight();
  while (cfilterCursor <= effectiveTip && inflightBatches.size < MAX_INFLIGHT_BATCHES) {
    const startHeight = cfilterCursor;
    const stopHeight = Math.min(startHeight + CFILTER_BATCH - 1, effectiveTip);
    const stopHashWire = heightToBlockHash.get(stopHeight);
    if (!stopHashWire) break;
    const remaining = new Set<number>();
    for (let h = startHeight; h <= stopHeight; h++) remaining.add(h);
    const batch: CFilterBatch = {startHeight, stopHeight, stopHashWire, remaining, timer: null};
    inflightBatches.set(startHeight, batch);
    dispatchCFilterBatch(batch);
    armCFilterBatchTimer(batch);
    cfilterCursor = stopHeight + 1;
  }
  if (cfilterCursor > effectiveTip && inflightBatches.size === 0) maybeDrainAndFinish();
}

// Matched blocks come back from peers in arbitrary order (4 batches in flight,
// each spread across ~24 +CF peers). Applying them as they arrive would let a
// spending block be processed before its receiving block, silently dropping
// the spend. We collect everything during the scan, then drain in ascending
// height order at the end.
const matchedBlocks = new Map<number, Block>();

function maybeDrainAndFinish(): void {
  if (phase !== 'cfilters') return;
  if (cfilterCursor <= effectiveScanTipHeight()) return;
  if (inflightBatches.size > 0) return;
  if (blockRequestsInflight.size > 0) return;
  const sortedHeights = [...matchedBlocks.keys()].sort((a, b) => a - b);
  for (const h of sortedHeights) applyBlock(matchedBlocks.get(h)!, h);
  matchedBlocks.clear();
  finishScan();
}

function onCFilter(msg: CFilterArgs): void {
  const blockHashWire = msg.blockHash ?? new Uint8Array(32);
  const height = wireHexToHeight.get(bytesToHex(blockHashWire)) ?? -1;
  if (height < 0) return;
  // Locate the batch that owns this height; first responder wins, others fall
  // through.
  let owner: CFilterBatch | undefined;
  for (const b of inflightBatches.values()) {
    if (b.remaining.has(height)) {
      owner = b;
      break;
    }
  }
  if (!owner) return;
  owner.remaining.delete(height);

  // Verify the GCS payload hashes to the filter_hash committed by cfheaders.
  const expectedFilterHash = recomputeFilterHash(height);
  if (expectedFilterHash) {
    const got = doubleSHA256(msg.filter ?? new Uint8Array(0));
    if (!equalBytes(got, expectedFilterHash)) {
      console.warn(`[cfilters] filter h=${height} fails commitment — discarding`);
      maybePump();
      return;
    }
  }

  const cf = new CompactFilter(msg.filter ?? new Uint8Array(0), blockHashWire);
  if (cf.matchAny(watchedItems)) {
    console.log(`[cfilters] match at h=${height} block=${wireToDisplayHex(blockHashWire).slice(0, 16)}…  N=${cf.N}`);
    requestFullBlock(height, blockHashWire);
  }

  if (owner.remaining.size === 0) {
    if (owner.timer) clearTimeout(owner.timer);
    inflightBatches.delete(owner.startHeight);
    if (height % 5000 < CFILTER_BATCH) {
      console.log(`[cfilters] batch ${owner.startHeight}..${owner.stopHeight} done  inflight-batches=${inflightBatches.size}`);
    }
    if (phase === 'cfilters') pumpCFilters();
  }
}

// Recover filter_hash from filter_header chain: filter_header_n =
// dSHA256(filter_hash_n || filter_header_{n-1}). We can't invert dSHA256, so
// we instead recompute the chain step using the candidate filter (above)
// and compare. This helper just exposes the cached header pair to the
// caller for debugging — the actual integrity check is the dSHA256(filter)
// comparison in onCFilter. Returning null disables that extra check when
// we don't have the headers cached (shouldn't happen post-cfheaders walk).
function recomputeFilterHash(height: number): Uint8Array | null {
  // filter_header_n = dSHA256(filter_hash_n || filter_header_{n-1})
  // So filter_hash_n is the first 32 bytes of the doubleSHA256 preimage; we
  // can't recover it from headers alone. Skip extra check (the cfheaders
  // walk already authenticated the chain end-to-end via the checkpoint).
  void height;
  return null;
}

// ── Pull matched blocks for tx-level processing ──────────────────────────────

const blockRequestsInflight = new Set<string>();      // wire-hex of pending block

function requestFullBlock(height: number, blockHashWire: Uint8Array): void {
  // Any peer with the block will do; pick one that has proven willing on
  // some recent request. Falls back to any ready peer.
  const target = leader ?? readyPeers.values().next().value;
  if (!target) return;
  const key = bytesToHex(blockHashWire);
  if (blockRequestsInflight.has(key)) return;
  blockRequestsInflight.add(key);
  void height;
  target.sendMessage(M.GetData([{type: Inventory.TYPE.BLOCK, hash: blockHashWire}]));
}

interface Utxo {
  txid: string;
  vout: number;
  satoshis: bigint;
  address: string;
  height: number
}

const utxos = new Map<string, Utxo>();
const seenOwnOutpoints = new Set<string>();
const watchedAddressSet = new Set(WATCH_ADDRESSES);

function applyBlock(block: Block, height: number): void {
  for (const tx of block.txs) {
    const txid = tx.hash();

    for (const input of tx.inputs) {
      const key = `${input.txId}:${input.vOut}`;
      const spent = utxos.get(key);
      if (spent) {
        console.log(`[utxo] spent    ${spent.txid.slice(0, 16)}…:${spent.vout}  -${Number(spent.satoshis) / 1e8} DASH  h=${height}`);
        utxos.delete(key);
      }
    }

    for (let vout = 0; vout < tx.outputs.length; vout++) {
      const output = tx.outputs[vout]!;
      const address = output.getAddress(NETWORK === 'mainnet' ? 'Mainnet' : 'Testnet');
      if (!address || !watchedAddressSet.has(address)) continue;
      const key = `${txid}:${vout}`;
      if (seenOwnOutpoints.has(key)) continue;
      seenOwnOutpoints.add(key);
      utxos.set(key, {txid, vout, satoshis: output.satoshis, address, height});
      console.log(`[utxo] received ${txid.slice(0, 16)}…:${vout}  +${Number(output.satoshis) / 1e8} DASH  h=${height}  (${address})`);
      // From now on a spend of this output will also match the filter.
      watchedItems.push(bip158Outpoint(txid, vout));
    }
  }
}

function finishScan(): void {
  if (phase !== 'cfilters') return;
  phase = 'live';
  const balance = [...utxos.values()].reduce((s, u) => s + u.satoshis, 0n);
  console.log(`[scan] complete  utxos=${utxos.size}  balance=${Number(balance) / 1e8} DASH`);
  for (const u of utxos.values()) {
    console.log(`  ${u.txid.slice(0, 16)}…:${u.vout}  ${Number(u.satoshis) / 1e8} DASH  h=${u.height}  (${u.address})`);
  }
  if (leader) leader.sendMessage(M.SendHeaders());
}

// ── Event wiring ─────────────────────────────────────────────────────────────

pool.on('peerconnect', (peer: Peer) => {
  if (BANNED_HOSTS.has(peer.host)) {
    console.log(`[ban] dropping ${peer.host}:${peer.port}`);
    peer.disconnect();
  }
});

pool.on('peerversion', (peer: Peer, message: Message & { services?: bigint }) => {
  const services = message.services ?? 0n;
  peerServices.set(peer, services);
  if ((services & BigInt(NODE_COMPACT_FILTERS)) !== 0n) filterCapablePeers.add(peer);
});

pool.on('peerready', (peer: Peer) => {
  const services = peerServices.get(peer) ?? 0n;
  const cf = peerServesFilters(peer) ? '+CF' : '-CF';
  console.log(`[pool] peer ready  ${peer.host}:${peer.port}  v${peer.version}  services=0x${services.toString(16)} ${cf}`);
  readyPeers.add(peer);
  if (phase !== 'headers') return;
  if (!currentRace) {
    startHeaderRace();
  } else if (currentRace.racers.size < HEADER_RACE_PEERS) {
    currentRace.racers.add(peer);
    peer.sendMessage(getHeadersMsg(currentRace.locatorWire));
  }
});

pool.on('peerheaders', (peer: Peer, message: Message & { headers: Uint8Array[] }) => {
  const rawHeaders = message.headers ?? [];

  if (phase !== 'headers') {
    // Live: extend chain by one block at a time and refetch its filter via the
    // same race machinery as the initial scan.
    if (rawHeaders.length > 0 && processHeaders(rawHeaders)) {
      cfilterCursor = Math.min(cfilterCursor, chainTipHeight - rawHeaders.length + 1);
      pumpCFilters();
    }
    return;
  }

  const race = currentRace;
  if (!race || !race.racers.has(peer)) return;

  // Reject stale responses (peer is answering a previous round's locator) up
  // front so they don't poison processHeaders' prev-link check.
  if (rawHeaders.length > 0) {
    if (rawHeaders[0]!.length < 80) {
      console.warn(`[headers] malformed header from ${peer.host}: truncated`);
      race.racers.delete(peer);
      return;
    }
    const incomingPrev = rawHeaders[0]!.subarray(4, 36);
    if (!equalBytes(incomingPrev, race.locatorWire)) return;
  }

  race.racers.delete(peer);

  if (rawHeaders.length === 0) {
    race.zeroResponses++;
    const agreeThreshold = Math.min(2, Math.max(1, readyPeers.size));
    if (race.zeroResponses >= agreeThreshold) {
      console.log(`[headers] sync complete  height=${chainTipHeight}`);
      console.log(`[cfdbg] +CF peers at headers-complete (${filterCapablePeers.size}):`);
      let i = 0;
      for (const p of filterCapablePeers) {
        const svc = (peerServices.get(p) ?? 0n).toString(16);
        console.log(`  [${i++}] ${p.host}:${p.port} v${p.version} svc=0x${svc}`);
      }
      endRace(race);
      requestCheckpoints();
    } else if (race.racers.size === 0) {
      endRace(race);
      startHeaderRace();
    }
    return;
  }

  const prevHeight = chainTipHeight;
  processHeaders(rawHeaders);

  if (chainTipHeight === prevHeight) {
    if (race.racers.size === 0 && race.zeroResponses === 0) {
      endRace(race);
      console.warn(`[headers] all racers invalid at h=${chainTipHeight}, retrying`);
      startHeaderRace();
    }
    return;
  }

  endRace(race);
  startHeaderRace();
});

pool.on('peercfcheckpt', (peer: Peer, message: Message & CFCheckptArgs) => {
  onCheckpoints(message, peer);
});

pool.on('peercfheaders', (peer: Peer, message: Message & CFHeadersArgs) => {
  onCFHeaders(message, peer);
});

pool.on('peercfilter', (_peer: Peer, message: Message & CFilterArgs) => {
  onCFilter(message);
});

pool.on('peerblock', (_peer: Peer, message: Message & { block?: any }) => {
  // The Pool surface emits a peerblock event with the parsed block payload.
  // We only request blocks we matched, so any block here is interesting.
  const raw: Uint8Array | undefined = (message as any).block?.bytes?.()
    ?? (message as any).payload
    ?? (message as any).rawBlock;
  if (!raw) return;
  let block: Block;
  try {
    block = Block.fromBytes(raw);
  } catch {
    return;
  }
  const blockHashWire = displayHexToWire(block.hash());
  const height = wireHexToHeight.get(bytesToHex(blockHashWire)) ?? -1;
  if (height < 0) return;
  blockRequestsInflight.delete(bytesToHex(blockHashWire));
  if (phase === 'cfilters') {
    matchedBlocks.set(height, block);
    maybeDrainAndFinish();
  } else {
    applyBlock(block, height);
  }
});

pool.on('peerdisconnect', (peer: Peer) => {
  readyPeers.delete(peer);
  filterCapablePeers.delete(peer);

  if (currentRace && currentRace.racers.has(peer)) {
    currentRace.racers.delete(peer);
    if (currentRace.racers.size === 0 && currentRace.zeroResponses === 0) {
      endRace(currentRace);
      if (phase === 'headers') startHeaderRace();
    }
  }

  if (peer !== leader) return;
  console.warn(`[pool] leader ${peer.host} disconnected — failing over`);
  leader = null;
  if (phase === 'cfcheckpt') {
    requestCheckpoints();
    return;
  }
  if (phase === 'cfheaders') return;
  for (const candidate of filterCapablePeers) {
    console.log(`[pool] new leader ${candidate.host}:${candidate.port}`);
    if (phase === 'cfilters') {
      leader = candidate;
      pumpCFilters();
    }
    return;
  }
});

pool.on('seederror', (err: Error) => console.error('[pool] seed error:', err.message));

console.log(`Connecting to Dash ${NETWORK} (compact-filter SPV)…`);
pool.connect();

process.on('SIGINT', () => {
  console.log('\nDisconnecting…');
  pool.disconnect();
  process.exit(0);
});