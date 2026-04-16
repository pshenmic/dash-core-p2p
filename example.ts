import {Peer} from "./src";

const peer = new Peer({host: '194.163.156.190', port: 9999});

peer.on('version', (message) => {
    console.log('Received version message:');
    console.log('Version:', (message as any).version);
    console.log('Subversion:', (message as any).subversion);
    console.log('StartHeight:', (message as any).startHeight);
    peer.disconnect();
});

peer.on('error', (err: Error) => {
    console.error('Connection error:', err.message);
    process.exit(1);
});

peer.on('disconnect', () => {
    console.log('Connection disconnected');
  process.exit(0);
});

peer.on('connect', () => console.log('TCP connected'));

await peer.connect();

if (!peer.socket) {
    throw new Error('No socket available');
}

peer.socket.on('data', (d: Uint8Array) => {
    console.log('raw data:', d.length, 'bytes')
});
