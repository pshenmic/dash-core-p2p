/**
 * Broadcast a signed Dash transaction to the P2P network.
 *
 * The protocol primitives (inv, getdata-handler, islock/reject watchers,
 * tx validation) live in `src/Broadcast.ts`. This example shows how a
 * wallet composes them into a `broadcastTransaction` method with timeout,
 * minimum-ack, and rebroadcast policy.
 *
 * Usage:
 *   const tx = ... // signed Transaction
 *   const result = await broadcastTransaction(pool, tx, {
 *     minPeerAcks: 2,
 *     waitForInstantLock: true,
 *     timeoutMs: 30_000,
 *   });
 *
 * Run as a script:
 *   npx tsx examples/broadcast_tx.ts <signed-tx-hex>
 */

import { Pool, TxBroadcast, type RejectInfo } from '../src';
import type { Peer } from '../src';
import { Transaction } from 'dash-core-sdk';

// ---------------------------------------------------------------------------
// Policy: broadcastTransaction
// ---------------------------------------------------------------------------

export interface BroadcastPolicy {
  /**
   * Distinct ready peers we wait for an inv→getdata ack from before
   * resolving. Default 1. With relay=false on the pool, this is the
   * only acceptance signal available.
   */
  minPeerAcks?: number;
  /**
   * Also wait for a DIP-10 `islock` (legacy InstantSend lock). When true
   * the promise resolves on the FIRST of [minPeerAcks reached, islock
   * arrived]. When set with `requireInstantLock`, islock is required.
   *
   * IMPORTANT: current Dash Core removed legacy `islock` in favor of DIP-24
   * `isdlock`, which is NOT parsed by this repo yet (see
   * Builder.unsupportedCommands). On current mainnet/testnet this option
   * will never resolve via islock — only via the minPeerAcks path. Pair it
   * with a finite timeout, and prefer `requireInstantLock: false`.
   */
  waitForInstantLock?: boolean;
  /**
   * Reject if no islock arrives within timeout. See the warning on
   * `waitForInstantLock`: this will time out on current Dash networks
   * because isdlock parsing isn't implemented yet.
   */
  requireInstantLock?: boolean;
  /**
   * How long to wait for a ready peer if the pool has none yet. Default
   * 10_000 ms.
   */
  peerWaitMs?: number;
  /** Overall deadline for the broadcast. Default 30_000 ms. */
  timeoutMs?: number;
  /**
   * Re-send inv every interval to peers that haven't ack'd, plus any new
   * peers that joined the pool. Default 15_000 ms. Set to 0 to disable.
   */
  rebroadcastIntervalMs?: number;
  /** Max number of rebroadcast rounds. Default 2. */
  maxRebroadcasts?: number;
  /**
   * If a peer doesn't ask for the tx within this many ms after we inv'd it,
   * push the full tx unsolicited. Default 5_000 ms. Set to 0 to disable.
   */
  unsolicitedPushAfterMs?: number;
  /** Fail the broadcast on any `reject` message. Default true. */
  failOnReject?: boolean;
}

export interface BroadcastResult {
  txid: string;
  peersInvited: number;
  peersAcked: string[];
  peersPropagated: string[];
  instantLocked: boolean;
  rejections: Array<{ peer: string; ccode: number; reason: string }>;
  durationMs: number;
}

export class BroadcastError extends Error {
  readonly txid: string;
  readonly result: BroadcastResult;
  constructor(message: string, txid: string, result: BroadcastResult) {
    super(message);
    this.name = 'BroadcastError';
    this.txid = txid;
    this.result = result;
  }
}

function peerLabel(peer: Peer): string {
  return `${peer.host}:${peer.port}`;
}

/**
 * Broadcast a transaction and wait for acceptance per the policy.
 *
 * This is policy-level wallet logic — the wire protocol details all live
 * inside TxBroadcast. We just orchestrate when to inv, when to give up,
 * and what constitutes "accepted".
 */
export function broadcastTransaction(
  pool: Pool,
  tx: Transaction,
  policy: BroadcastPolicy = {},
): Promise<BroadcastResult> {
  const minPeerAcks = policy.minPeerAcks ?? 1;
  const waitForIs = policy.waitForInstantLock ?? false;
  const requireIs = policy.requireInstantLock ?? false;
  const peerWaitMs = policy.peerWaitMs ?? 10_000;
  const timeoutMs = policy.timeoutMs ?? 30_000;
  const rebroadcastMs = policy.rebroadcastIntervalMs ?? 15_000;
  const maxRebroadcasts = policy.maxRebroadcasts ?? 2;
  const unsolicitedAfterMs = policy.unsolicitedPushAfterMs ?? 5_000;
  const failOnReject = policy.failOnReject ?? true;

  const session = new TxBroadcast(pool, tx);
  const startedAt = Date.now();

  return new Promise<BroadcastResult>((resolve, reject) => {
    let settled = false;
    let rebroadcastsLeft = maxRebroadcasts;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];
    const pushTimers = new Map<Peer, ReturnType<typeof setTimeout>>();

    const buildResult = (): BroadcastResult => ({
      txid: session.txid,
      peersInvited: session.invSentTo.size,
      peersAcked: [...session.requestedBy].map(peerLabel),
      peersPropagated: [...session.propagatedFrom].map(peerLabel),
      instantLocked: session.instantLocked,
      rejections: session.rejections.map((r) => ({
        peer: peerLabel(r.peer),
        ccode: r.ccode,
        reason: r.reason,
      })),
      durationMs: Date.now() - startedAt,
    });

    const cleanup = () => {
      for (const t of timers) clearTimeout(t);
      for (const i of intervals) clearInterval(i);
      for (const t of pushTimers.values()) clearTimeout(t);
      pushTimers.clear();
      pool.off('peerready', onPeerReady);
      session.close();
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(buildResult());
    };

    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new BroadcastError(msg, session.txid, buildResult()));
    };

    const checkDone = () => {
      if (settled) return;
      if (requireIs) {
        if (session.instantLocked && session.requestedBy.size >= minPeerAcks) succeed();
        return;
      }
      if (session.instantLocked && waitForIs) {
        succeed();
        return;
      }
      if (session.requestedBy.size >= minPeerAcks && !waitForIs) {
        succeed();
        return;
      }
      if (session.requestedBy.size >= minPeerAcks && waitForIs && !requireIs) {
        // Acks satisfied; we'd rather have islock but it's not required.
        succeed();
      }
    };

    // Schedule an unsolicited tx push to any peer that doesn't request
    // within unsolicitedAfterMs. Covers paths where the peer's known-set
    // already had the txid (e.g. they heard it elsewhere first).
    const armUnsolicited = (peer: Peer) => {
      if (unsolicitedAfterMs <= 0) return;
      if (pushTimers.has(peer)) return;
      const t = setTimeout(() => {
        pushTimers.delete(peer);
        if (settled) return;
        if (!session.requestedBy.has(peer) && !session.txSentTo.has(peer)) {
          session.push(peer);
        }
      }, unsolicitedAfterMs);
      pushTimers.set(peer, t);
    };

    const inviteNewPeers = () => {
      const before = session.invSentTo.size;
      const sent = session.announce();
      for (const p of sent) armUnsolicited(p);
      return sent.length || (session.invSentTo.size - before);
    };

    // 1) Wire up the session events.
    session.on('request', () => checkDone());
    session.on('islock', () => checkDone());
    session.on('reject', (info: RejectInfo) => {
      if (failOnReject) {
        fail(`peer ${peerLabel(info.peer)} rejected tx (ccode=0x${info.ccode.toString(16)}: ${info.reason})`);
      }
    });

    // 2) Pick up peers that join after we start.
    function onPeerReady(peer: Peer) {
      if (settled) return;
      const sent = session.announce(peer);
      if (sent.length) armUnsolicited(peer);
      checkDone();
    }
    pool.on('peerready', onPeerReady);

    // 3) Initial announce to whichever peers are ready right now.
    const initial = inviteNewPeers();

    // 4) If no peers yet, give the pool peerWaitMs to produce one before failing.
    if (initial === 0 && pool.numberConnected() === 0) {
      timers.push(
        setTimeout(() => {
          if (settled) return;
          if (session.invSentTo.size === 0) {
            fail(`no ready peers within ${peerWaitMs}ms`);
          }
        }, peerWaitMs),
      );
    }

    // 5) Overall deadline.
    timers.push(
      setTimeout(() => {
        fail(
          `timed out after ${timeoutMs}ms ` +
          `(invited=${session.invSentTo.size}, ack=${session.requestedBy.size}, ` +
          `islock=${session.instantLocked})`,
        );
      }, timeoutMs),
    );

    // 6) Rebroadcast loop: re-invite ANY ready peer not yet invited.
    if (rebroadcastMs > 0 && maxRebroadcasts > 0) {
      intervals.push(
        setInterval(() => {
          if (settled) return;
          if (rebroadcastsLeft-- <= 0) return;
          inviteNewPeers();
        }, rebroadcastMs),
      );
    }

    // Re-evaluate immediately in case an islock or ack landed synchronously
    // during initial announce (unlikely, but cheap).
    checkDone();
  });
}

// ---------------------------------------------------------------------------
// CLI demo
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const hex = process.argv[2];
  if (!hex) {
    console.error('usage: tsx examples/broadcast_tx.ts <signed-tx-hex>');
    process.exit(2);
  }

  const tx = Transaction.fromHex(hex);
  console.log(`txid = ${tx.hash()}  size = ${tx.bytes().length} bytes`);

  const pool = new Pool({
    network: 'testnet',
    maxSize: 8,
    // relay=true so the network can echo our tx back via inv as a
    // propagation confirmation signal.
    relay: true,
  });

  pool.on('peerready', (peer: Peer) => {
    console.log(`[pool] peer ready ${peer.host}:${peer.port}`);
  });
  pool.on('seederror', (e: Error) => console.error('[pool] seed error', e.message));

  pool.connect();

  try {
    const result = await broadcastTransaction(pool, tx, {
      minPeerAcks: 2,
      waitForInstantLock: true,
      timeoutMs: 60_000,
      rebroadcastIntervalMs: 15_000,
      maxRebroadcasts: 2,
      unsolicitedPushAfterMs: 5_000,
    });
    console.log('[broadcast] accepted');
    console.dir(result, { depth: null });
  } catch (e) {
    console.error('[broadcast] failed:', (e as Error).message);
    if (e instanceof BroadcastError) console.dir(e.result, { depth: null });
    process.exitCode = 1;
  } finally {
    pool.disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}