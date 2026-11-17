import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {portableStorageController, storageControllers} from './qualify.ts';

for (const path of storageControllers) {
  const source = readFileSync(new URL('../../../../' + path, import.meta.url), 'utf8');
  test(`${path}: bounded implementation changes preserve the renderer contract`, () => {
    assert.equal(portableStorageController(path, source, source.replace('this.#generation++;', 'this.#generation += 1;')), true);
    assert.equal(portableStorageController(path, source, source.replace('generation === this.#generation', 'this.#generation === generation')), true);
  });
  test(`${path}: new capabilities, imports and public ports need integration`, () => {
    for (const changed of [source + '\nimport "node:fs";', source.replace('./policy.js', './other.js'),
      source.replace('dispose() {', 'dispose() { fetch("/effect");'),
      source.replace('dispose() {', 'dispose() { import("node:fs");'),
      source.replace('dispose() {', 'dispose() { window.close();'),
      source.replace('dispose() {', 'anotherPublicMethod(): void {}\n  dispose() {'),
      source.replace('dispose() {', 'anotherPublicField = true;\n  dispose() {'),
      source.replace('dispose() {', 'dispose() { new Worker("/effect.js");'),
      source.replace('dispose() {', 'dispose() { const url = "http://example.invalid"; new Worker(url);'),
      source.replace('dispose() {', 'dispose(force: boolean) {'),
      source.replace('read():', 'read(extra: string):'), '']) {
      assert.equal(portableStorageController(path, source, changed), false, changed);
    }
  });
}
test('shared policy and cleanup planner never qualify', () => {
  for (const path of ['record/storage/src/policy.ts', 'record/storage/src/types.ts',
    'record/storage/src/retention/policy.ts', 'record/storage/src/retention-workflow.ts'])
    assert.equal(portableStorageController(path, '', ''), false);
});
