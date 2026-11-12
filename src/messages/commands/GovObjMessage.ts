import { GovernanceObject, GovernanceObjectType, OutPoint } from 'dash-core-sdk';
import { Message, MessageOptions } from '../Message.js';

const ZERO_HASH = '0'.repeat(64);

/**
 * Governance object (`govobj`), sent in reply to getdata(MSG_GOVERNANCE_OBJECT).
 * Carries a dash-core-sdk GovernanceObject.
 */
export class GovObjMessage extends Message {
  object: GovernanceObject;

  constructor(arg: GovernanceObject | undefined, options: MessageOptions) {
    super({ ...options, command: 'govobj' });
    if (arg != null && !(arg instanceof GovernanceObject)) {
      throw new Error('An instance of GovernanceObject is expected');
    }
    this.object = arg ?? new GovernanceObject(
      ZERO_HASH, 1, 0, ZERO_HASH, '', GovernanceObjectType.UNKNOWN, new OutPoint(ZERO_HASH, 0xffffffff), '',
    );
  }

  setPayload(payload: Uint8Array): void {
    const object = GovernanceObject.fromBytes(payload.slice());
    // The SDK parser stops after the signature; reject anything left over.
    if (object.bytes().length !== payload.length) {
      throw new Error('govobj: unexpected trailing bytes');
    }
    this.object = object;
  }

  getPayload(): Uint8Array {
    return this.object.bytes();
  }
}
