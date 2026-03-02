import { utils as sdkUtils } from 'dash-core-sdk';
import { Networks, type Network } from '../Network.js';
import { builder, type BuilderOptions, type Builder } from './Builder.js';
import { Message } from './Message.js';
import { bytesEqual, bytesToStr } from '../utils/binary.js';

const { doubleSHA256 } = sdkUtils;

/**
 * A factory to build Dash protocol messages and parse incoming data.
 */
export class Messages {
  static readonly MINIMUM_LENGTH = 20;
  static readonly PAYLOAD_START = 16;
  static readonly Message = Message;
  static readonly builder = builder;

  private builderInstance: Builder;
  network: Network | null;

  [key: string]: unknown;

  constructor(options?: BuilderOptions) {
    this.builderInstance = builder(options);

    // Expose message factories by capitalized name
    for (const key of Object.keys(this.builderInstance.commandsMap)) {
      const name = this.builderInstance.commandsMap[key]!;
      this[name] = this.builderInstance.commands[key]!;
    }

    this.network = (options?.network as Network) ?? Networks.defaultNetwork;
  }

  /**
   * Parse the next message from a Uint8Array buffer.
   * Returns `{ message, consumed }` where `consumed` is how many bytes to advance,
   * or `undefined` if more data is needed.
   * `message` may be absent if bytes were consumed but produced no message
   * (e.g. garbage before magic, bad checksum, or unsupported command).
   */
  parseBytes(buffer: Uint8Array): { message?: Message; consumed: number } | undefined {
    if (!(buffer instanceof Uint8Array)) throw new Error('buffer must be a Uint8Array');
    if (!this.network) throw new Error('network must be set');

    if (buffer.length < 4) return undefined;

    const magic: Uint8Array = (this.network as any).networkMagic;

    // Find the first occurrence of the magic bytes
    let magicAt = -1;
    for (let i = 0; i <= buffer.length - 4; i++) {
      if (bytesEqual(buffer.subarray(i, i + 4), magic)) {
        magicAt = i;
        break;
      }
    }

    if (magicAt === -1) {
      // No magic found — discard all but the last 3 bytes, which could be
      // the start of magic split across a chunk boundary.
      const toDiscard = buffer.length - 3;
      return toDiscard > 0 ? { consumed: toDiscard } : undefined;
    }

    // Work with the slice starting at magic
    const view = buffer.subarray(magicAt);

    if (view.length < Messages.MINIMUM_LENGTH) {
      // Not enough data for even the header; discard garbage before magic
      return magicAt > 0 ? { consumed: magicAt } : undefined;
    }

    // Parse payload length (4 bytes LE at offset 16)
    const payloadLenBytes = view.subarray(Messages.PAYLOAD_START, Messages.PAYLOAD_START + 4);
    const payloadLen = new DataView(payloadLenBytes.buffer, payloadLenBytes.byteOffset, 4).getUint32(0, true);

    const messageLength = 24 + payloadLen;
    if (view.length < messageLength) {
      // Have a valid header start but incomplete payload; discard garbage before magic
      return magicAt > 0 ? { consumed: magicAt } : undefined;
    }

    const command = bytesToStr(view.subarray(4, 16), true);
    const payload = view.subarray(24, messageLength);
    const checksum = view.subarray(20, 24);

    const checksumConfirm = doubleSHA256(payload).subarray(0, 4);
    if (!bytesEqual(checksumConfirm, checksum)) {
      // Bad checksum — skip this entire message
      return { consumed: magicAt + messageLength };
    }

    const message = this._buildFromBytes(command, payload);
    return { message: message ?? undefined, consumed: magicAt + messageLength };
  }

  private _buildFromBytes(command: string, payload: Uint8Array): Message | undefined {
    if (!this.builderInstance.commands[command]) {
      if (this.builderInstance.unsupportedCommands.indexOf(command) > -1) {
        return undefined; // silently ignore unsupported commands
      }
      throw new Error('Unrecognized message command: ' + command);
    }
    return this.builderInstance.commands[command]!.fromBytes(payload);
  }

  add(key: string, name: string, Command: new (arg: unknown, options: object) => Message): void {
    this.builderInstance.add(key, Command as any);
    this[name] = this.builderInstance.commands[key]!;
  }
}
