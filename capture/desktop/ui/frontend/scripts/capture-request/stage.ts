import {cp, mkdir, stat} from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = path.resolve(root, '../../../../record/capture-request/dist');
const target = path.join(root, 'node_modules/@apparent/record-capture-request/dist');
await stat(path.join(source, 'lifecycle.js'));
await mkdir(target, {recursive: true});
await cp(source, target, {recursive: true});
