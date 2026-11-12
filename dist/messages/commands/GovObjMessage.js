import { GovernanceObject, GovernanceObjectType, OutPoint } from 'dash-core-sdk';
import { Message } from '../Message.js';
const ZERO_HASH = '0'.repeat(64);
/**
 * Governance object (`govobj`), sent in reply to getdata(MSG_GOVERNANCE_OBJECT).
 * Carries a dash-core-sdk GovernanceObject.
 */
export class GovObjMessage extends Message {
    object;
    constructor(arg, options) {
        super({ ...options, command: 'govobj' });
        if (arg != null && !(arg instanceof GovernanceObject)) {
            throw new Error('An instance of GovernanceObject is expected');
        }
        this.object = arg ?? new GovernanceObject(ZERO_HASH, 1, 0, ZERO_HASH, '', GovernanceObjectType.UNKNOWN, new OutPoint(ZERO_HASH, 0xffffffff), '');
    }
    setPayload(payload) {
        const object = GovernanceObject.fromBytes(payload.slice());
        // The SDK parser stops after the signature; reject anything left over.
        if (object.bytes().length !== payload.length) {
            throw new Error('govobj: unexpected trailing bytes');
        }
        this.object = object;
    }
    getPayload() {
        return this.object.bytes();
    }
}
//# sourceMappingURL=GovObjMessage.js.map