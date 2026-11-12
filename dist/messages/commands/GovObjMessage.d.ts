import { GovernanceObject } from 'dash-core-sdk';
import { Message, MessageOptions } from '../Message.js';
/**
 * Governance object (`govobj`), sent in reply to getdata(MSG_GOVERNANCE_OBJECT).
 * Carries a dash-core-sdk GovernanceObject.
 */
export declare class GovObjMessage extends Message {
    object: GovernanceObject;
    constructor(arg: GovernanceObject | undefined, options: MessageOptions);
    setPayload(payload: Uint8Array): void;
    getPayload(): Uint8Array;
}
