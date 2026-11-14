// The reader subprocess must not fetch directly, including on an error path.
// This is a Node API guard, not an operating-system sandbox.
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const denied=()=>{throw new Error('direct_network_forbidden');};
net.Socket.prototype.connect=denied as typeof net.Socket.prototype.connect;
http.request=denied as typeof http.request;http.get=denied as typeof http.get;
https.request=denied as typeof https.request;https.get=denied as typeof https.get;
globalThis.fetch=async()=>denied();syncBuiltinESMExports();
assert.throws(()=>net.connect(1,'127.0.0.1'),/direct_network_forbidden/);
await assert.rejects(fetch('https://invalid.example'),/direct_network_forbidden/);
process.stderr.write('Reader network guard active\n');
