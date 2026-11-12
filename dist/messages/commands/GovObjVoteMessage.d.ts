import { GovernanceVote } from 'dash-core-sdk';
import { Message, MessageOptions } from '../Message.js';
/**
 * Governance vote (`govobjvote`), sent in reply to getdata(MSG_GOVERNANCE_OBJECT_VOTE).
 * Carries a dash-core-sdk GovernanceVote.
 */
export declare class GovObjVoteMessage extends Message {
    vote: GovernanceVote;
    constructor(arg: GovernanceVote | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
