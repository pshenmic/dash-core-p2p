import { hexToBytes, bytesToHex, reverseBytes } from '../utils/binary.js';
function getRandomBytes(n) {
    return globalThis.crypto.getRandomValues(new Uint8Array(n));
}
function writeIP(ip, bw) {
    const words = ip.v6.split(':').map((s) => hexToBytes(s));
    for (const word of words) {
        bw.write(word);
    }
}
function writeAddr(addr, bw) {
    if (addr == null) {
        const pad = new Uint8Array(26);
        bw.write(pad);
        return;
    }
    bw.writeUInt64LE(addr.services);
    writeIP(addr.ip, bw);
    bw.writeUInt16BE(addr.port);
}
function writeInventory(inventory, bw) {
    bw.writeVarintNum(inventory.length);
    for (const value of inventory) {
        bw.writeUInt32LE(value.type);
        bw.write(value.hash);
    }
}
function parseIP(parser) {
    const ipv6Parts = [];
    const ipv4Parts = [];
    for (let a = 0; a < 8; a++) {
        const word = parser.read(2);
        ipv6Parts.push(bytesToHex(word));
        if (a >= 6) {
            ipv4Parts.push(word[0]);
            ipv4Parts.push(word[1]);
        }
    }
    return {
        v6: ipv6Parts.join(':'),
        v4: ipv4Parts.join('.'),
    };
}
function parseAddr(parser) {
    const services = parser.readUInt64LE();
    const ip = parseIP(parser);
    const port = parser.readUInt16BE();
    return { services, ip, port };
}
function checkInventory(arg) {
    if (arg == null || !Array.isArray(arg) || (arg.length > 0 && (arg[0]?.type == null || arg[0]?.hash == null))) {
        throw new Error('Argument is expected to be an array of inventory objects');
    }
}
function checkFinished(parser) {
    if (!parser.finished()) {
        throw new Error('Data still available after parsing');
    }
}
function getNonce() {
    return getRandomBytes(8);
}
function sanitizeStartStop(obj) {
    if (obj.starts != null && !Array.isArray(obj.starts)) {
        throw new Error('starts must be an array');
    }
    const starts = (obj.starts ?? []).map((hash) => {
        if (typeof hash === 'string') {
            return reverseBytes(hexToBytes(hash));
        }
        return hash;
    });
    for (let i = 0; i < starts.length; i++) {
        if (starts[i].length !== 32) {
            throw new Error('Invalid hash ' + i + ' length: ' + starts[i].length);
        }
    }
    let stop;
    if (typeof obj.stop === 'string') {
        stop = reverseBytes(hexToBytes(obj.stop));
    }
    else if (obj.stop) {
        stop = obj.stop;
    }
    else {
        stop = new Uint8Array(32);
    }
    return { starts, stop };
}
export const utils = {
    getRandomBytes,
    checkInventory,
    checkFinished,
    getNonce,
    writeIP,
    writeAddr,
    writeInventory,
    parseIP,
    parseAddr,
    sanitizeStartStop,
};
//# sourceMappingURL=utils.js.map