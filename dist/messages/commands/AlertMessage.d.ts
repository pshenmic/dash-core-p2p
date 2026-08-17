import { Message, MessageOptions } from '../Message.js';
export interface AlertMessageArgs {
    payload?: Uint8Array;
    signature?: Uint8Array;
}
/**
 * Alert message for broadcasting network-wide alerts.
 */
export declare class AlertMessage extends Message {
    payload: Uint8Array | undefined;
    signature: Uint8Array | undefined;
    constructor(arg: AlertMessageArgs | undefined, options: MessageOptions);
    setPayload(data: Uint8Array): void;
    getPayload(): Uint8Array;
}
