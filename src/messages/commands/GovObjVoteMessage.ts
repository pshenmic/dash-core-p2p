import { GovernanceVote, OutPoint, VoteOutcome, VoteSignal } from 'dash-core-sdk';
import { Message, MessageOptions } from '../Message.js';

const ZERO_HASH = '0'.repeat(64);

/**
 * Governance vote (`govobjvote`), sent in reply to getdata(MSG_GOVERNANCE_OBJECT_VOTE).
 * Carries a dash-core-sdk GovernanceVote.
 */
export class GovObjVoteMessage extends Message {
  vote: GovernanceVote;

  constructor(arg: GovernanceVote | undefined, options: MessageOptions) {
    super({ ...options, command: 'govobjvote' });
    if (arg != null && !(arg instanceof GovernanceVote)) {
      throw new Error('An instance of GovernanceVote is expected');
    }
    this.vote = arg ?? new GovernanceVote(
      new OutPoint(ZERO_HASH, 0xffffffff), ZERO_HASH, VoteOutcome.NONE, VoteSignal.NONE, 0, '',
    );
  }

  setPayload(payload: Uint8Array): void {
    const vote = GovernanceVote.fromBytes(payload.slice());
    // The SDK parser stops after the signature; reject anything left over.
    if (vote.bytes().length !== payload.length) {
      throw new Error('govobjvote: unexpected trailing bytes');
    }
    this.vote = vote;
  }

  getPayload(): Uint8Array {
    return this.vote.bytes();
  }
}
