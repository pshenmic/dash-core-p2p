import { Message, MessageOptions } from '../Message.js';
import { utils } from '../utils.js';
import { strToBytes, bytesToStr } from '../../utils/binary.js';
import { BufferReader } from '../../encoding/BufferReader.js';
import { BufferWriter } from '../../encoding/BufferWriter.js';

export interface RejectMessageArgs {
  message?: string;
  ccode?: number;
  reason?: string;
  data?: Uint8Array;
}

export const RejectCCode = {
  REJECT_MALFORMED: 0x01,
  REJECT_INVALID: 0x10,
  REJECT_OBSOLETE: 0x11,
  REJECT_DUPLICATE: 0x12,
  REJECT_NONSTANDARD: 0x40,
  REJECT_DUST: 0x41,
  REJECT_INSUFFICIENTFEE: 0x42,
  REJECT_CHECKPOINT: 0x43,
} as const;

/**
 * Message sent when a message is rejected.
 */
export class RejectMessage extends Message {
  message: string | undefined;
  ccode: number | undefined;
  reason: string | undefined;
  data: Uint8Array | undefined;

  static CCODE = RejectCCode;

  constructor(arg: RejectMessageArgs | undefined, options: MessageOptions) {
    super({ ...options, command: 'reject' });
    const a = arg ?? {};
    this.message = a.message;
    this.ccode = a.ccode;
    this.reason = a.reason;
    this.data = a.data;
  }

  setPayload(payload: Uint8Array): void {
    const parser = new BufferReader(payload);
    this.message = bytesToStr(parser.readVarLengthBuffer());
    this.ccode = parser.readUInt8();
    this.reason = bytesToStr(parser.readVarLengthBuffer());
    this.data = parser.readAll();
    utils.checkFinished(parser);
  }

  getPayload(): Uint8Array {
    const bw = new BufferWriter();
    const msg = strToBytes(this.message ?? '');
    const reason = strToBytes(this.reason ?? '');
    bw.writeVarintNum(msg.length);
    bw.write(msg);
    bw.writeUInt8(this.ccode ?? 0);
    bw.writeVarintNum(reason.length);
    bw.write(reason);
    if (this.data) {
      bw.write(this.data);
    }
    return bw.concat();
  }
}
