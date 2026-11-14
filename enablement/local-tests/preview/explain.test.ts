import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selection, commands} from '../run.ts';
import {explainSelection} from './explain.ts';

test('explanation preserves the execution authority and exposes conservative input failures', () => {
  const result = selection('missing-history', 'also-missing');
  const plan = commands(result.selected, 'missing-history', 'also-missing', 'linux', result.rustChanged);
  const before = JSON.stringify({result, plan});
  const text = explainSelection(result, plan);
  assert.match(text, /committed range only; uncommitted changes are not included/);
  assert.match(text, /unproven — conservative coverage/);
  for (const reason of result.reasons) assert.ok(text.includes(reason));
  for (const command of plan) assert.ok(text.includes(command.argv.map(arg => JSON.stringify(arg)).join(' ')));
  assert.equal(JSON.stringify({result, plan}), before);
});
