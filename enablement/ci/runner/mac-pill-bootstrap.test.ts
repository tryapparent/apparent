import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const source = readFileSync(new URL('../../../capture/desktop/scripts/native/foreground/pill-input.swift', import.meta.url), 'utf8');
// Compile the production orchestration, not a TypeScript translation of it.
// Darwin providers remain covered only by the installed foreground native case.
function declaration(name: string) {
  const start = source.indexOf(`func ${name}(`);
  assert.ok(start >= 0, `Missing production function ${name}`);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start);
  return source.slice(start, end + 3);
}
test('Finish prepares through accessibility without OCR while clicks retain OCR and hit verification', () => {
  const prepare = source.indexOf('let receipt = try preparePillAccessibility(req)');
  const observe = source.indexOf('op == "click" ? observeBeforeInput(req, out)');
  assert.ok(prepare > 0 && prepare < observe);
  assert.doesNotMatch(declaration('preparePillAccessibility'), /\bobserve\(|recognizeWords\(|mouseMoved/);
  assert.match(declaration('buttonIdentity'), /kAXEnabledAttribute/);
  assert.match(declaration('ownedAccessibilityButton'), /expected\.rect\.contains\(CGRect/);
  assert.match(source.slice(observe), /bounds\.contains|OCR target outside owned image/);
  const consumer = readFileSync(new URL('../../../capture/desktop/ui/frontend/tests/foreground/mac.ts', import.meta.url), 'utf8');
  assert.match(consumer, /prepareRecording: async \(\) => \{[\s\S]*?native\('prepare', 'Finish'\)/);
  assert.doesNotMatch(consumer, /waitForRecordingControls|includes\('finish'\)/);
});
const swiftTest = process.platform === 'darwin' ? test : test.skip;
swiftTest('production Swift bootstrap handles the icon-only control and refuses ownership, foreground, budget and provider failures', () => {
  const job = mkdtempSync(join(tmpdir(), 'mac-pill-bootstrap-'));
  try {
    const path = join(job, 'bootstrap.swift');
    writeFileSync(path, String.raw`
import Foundation
import CoreGraphics
struct Refusal: Error { let message: String }
func need(_ yes: @autoclosure () throws -> Bool, _ message: String) throws { if try !yes() { throw Refusal(message: message) } }
struct Pill { let pid: pid_t; let id: UInt32; let rect: CGRect }
final class Trace {
    func requireComplete() throws { if fault == "trace" { throw Refusal(message: "trace failure") } }
    func add(_ fields: [String: Any]) {}
}
var clickTrace: Trace? = Trace()
let clickTraceName: String? = "private-trace"
var now = 0.0, admittedAt = -1.0
var events: [String] = []
var fault = ""
var current = Pill(pid: 42, id: 7, rect: CGRect(x: 1, y: 2, width: 100, height: 30))
var foreground: pid_t = 99
func withinBudget() throws { try need(now < 8, "Adapter exceeded eight-second budget") }
func frontPID() -> pid_t { foreground }
func pill(_ req: [String: Any]) throws -> (Pill, Set<pid_t>) {
    if fault == "unowned" { throw Refusal(message: "not owned") }
    return (current, [current.pid])
}
func admitPillAccessibility(_ expected: Pill) throws {
    try withinBudget(); events.append("admit")
    if fault == "admission" { throw Refusal(message: "AX failure") }
    admittedAt = now; now += 0.2
}
func ancestry(_ pid: pid_t) throws -> Set<pid_t> {
    events.append("ancestry")
    if fault == "ancestry" { throw Refusal(message: "Ancestry failure") }
    if fault == "budget" { now += 8 }
    return [pid]
}
func ownedAccessibilityButton(_ expected: Pill, label: String, point: CGPoint?, descendants: Set<pid_t>) throws -> [String: Any]? {
    precondition(label == "Finish" && point == nil && descendants == [42])
    if events.last != "tree" { events.append("tree") }
    if fault == "tree" { throw Refusal(message: "ambiguous or unavailable tree") }
    if ["neverReady", "disabled"].contains(fault) || now - admittedAt < 2 { return nil }
    if fault == "pid" { current = Pill(pid: 43, id: current.id, rect: current.rect) }
    if fault == "window" { current = Pill(pid: current.pid, id: 8, rect: current.rect) }
    if fault == "bounds" { current = Pill(pid: current.pid, id: current.id, rect: .zero) }
    if fault == "foreground" { foreground = 100 }
    return ["pid": Int(expected.pid), "label": label]
}
// Virtual time only replaces the wait/provider boundary, never the production
// ordering and guards under test. No AppKit or physical input is linked here.
enum Thread { static func sleep(forTimeInterval seconds: Double) { now += seconds } }
` + ['currentPill', 'preparePillAccessibility'].map(declaration).join('\n') + String.raw`
for scenario in ["", "unowned", "wrongFront", "admission", "ancestry", "pid", "window", "bounds", "foreground", "disabled", "budget", "tree", "neverReady", "trace"] {
    fault = scenario; now = 0; admittedAt = -1; events = []; foreground = 99
    current = Pill(pid: 42, id: 7, rect: CGRect(x: 1, y: 2, width: 100, height: 30))
    var passed = false
    do {
        let result = try preparePillAccessibility(["expectedFrontPid": scenario == "wrongFront" ? 100 : 99])
        precondition(result["prepared"] as? Bool == true && result["pid"] as? Int == 42 && result["windowId"] as? Int == 7)
        passed = true
    } catch {}
    precondition(passed == scenario.isEmpty, "Unexpected acceptance: \(scenario)")
    if scenario.isEmpty {
        precondition(events == ["admit", "ancestry", "tree"])
        precondition(now < 8 && now >= 2)
    }
    if ["unowned", "wrongFront"].contains(scenario) { precondition(events.isEmpty) }
    if scenario == "admission" { precondition(events == ["admit"]) }
    if ["ancestry", "budget"].contains(scenario) {
        precondition(!events.contains("tree"), "Preflight failure must never reach the tree")
    }
    if ["neverReady", "disabled"].contains(scenario) { precondition(now >= 8 && now < 8.1) }
}
print("14 production bootstrap scenarios passed")
`);
    const result = spawnSync('/usr/bin/swift', ['-module-cache-path', join(job, 'modules'), path], {encoding: 'utf8', timeout: 60_000,
      env: {...process.env, TMPDIR: job, CLANG_MODULE_CACHE_PATH: join(job, 'modules')}});
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /14 production bootstrap scenarios passed/);
    console.log('14 production bootstrap scenarios passed');
  } finally { rmSync(job, {recursive: true, force: true}); }
});

test('actual foreground consumer requires one successful Darwin regression before continuing and retains failures', async () => {
  const consumer = readFileSync(new URL('../../../capture/desktop/ui/frontend/tests/foreground/mac.ts', import.meta.url), 'utf8');
  const start = consumer.indexOf('    // Once per case, before app launch/capture/input.');
  const end = consumer.indexOf('    // Login registration', start);
  assert.ok(start > 0 && end > start);
  const block = consumer.slice(start, end);
  assert.equal(consumer.match(/mac-pill-bootstrap\.test\.ts/g)?.length, 1);
  assert.ok(end < consumer.indexOf("await cli(['screen-permission-status'])"));
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const run = new AsyncFunction('command', 'process', 'path', 'repo', 'hostEnv', 'temporary', 'assert', 'evidence', 'redact', block);
  const path = await import('node:path');
  for (const failure of [false, true, 'missing-proof']) {
    const receipts: string[] = []; let calls = 0, continued = false;
    const command = async (executable: string, args: string[], options: any) => {
      calls++; assert.equal(executable, process.execPath);
      assert.deepEqual(args, ['--experimental-strip-types', '--test', path.join('/repo', 'enablement/ci/runner/mac-pill-bootstrap.test.ts')]);
      assert.equal(options.timeout, 60_000); assert.equal(options.ownedGroup, true);
      assert.equal(options.env.TMPDIR, '/private-job');
      if (failure === true) throw Error('provider failed');
      return failure ? 'skipped' : '14 production bootstrap scenarios passed';
    };
    try {
      await run(command, process, path, '/repo', {}, '/private-job', assert,
        async (name: string) => { receipts.push(name); }, String);
      continued = true;
    } catch { assert.ok(failure); }
    assert.equal(calls, 1); assert.equal(continued, !failure);
    assert.deepEqual(receipts, [failure ? 'bootstrap-regression-failure' : 'bootstrap-regression']);
  }
});

test('actual foreground command caps remaining time before spawn and kills its owned Node/Swift process group', () => {
  const consumer = readFileSync(new URL('../../../capture/desktop/ui/frontend/tests/foreground/mac.ts', import.meta.url), 'utf8');
  assert.match(consumer, /const command = commandRunner\(\{budget, environment: \(\) => appEnv, redact\}\)/);
  const job = mkdtempSync(join(tmpdir(), 'pill-command-'));
  try {
    const fixture = join(job, 'command.ts');
    writeFileSync(fixture, `import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {writeFileSync, readFileSync} from 'node:fs';
import {commandRunner} from ${JSON.stringify(new URL('../../../composition/enablement/native-foreground/command-fixture.ts', import.meta.url).href)};
let appEnv = process.env, remaining = 2000;
const budget = (cap: number) => { assert.ok(remaining > 0); return Math.min(cap, remaining); };
const redact = String;
const command = commandRunner({budget, environment: () => appEnv, redact});
assert.equal(await command(process.execPath, ['-e', 'console.log("ok")'], {ownedGroup: true}), 'ok\\n');
await assert.rejects(command(process.execPath, ['-e', 'console.log("compiler scenario diagnostic"); process.exit(3)'], {ownedGroup: true}), /compiler scenario diagnostic/);
remaining = 0;
await assert.rejects(command(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], "spawned")', ${JSON.stringify(join(job, 'forbidden'))}], {ownedGroup: true}));
assert.equal((await import('node:fs')).existsSync(${JSON.stringify(join(job, 'forbidden'))}), false);
remaining = 500;
const pidFile = ${JSON.stringify(join(job, 'child-pid'))};
const script = 'const {spawn}=require("node:child_process"); const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); require("node:fs").writeFileSync(process.argv[1],String(c.pid)); setInterval(()=>{},1000)';
await assert.rejects(command(process.execPath, ['-e', script, pidFile], {ownedGroup: true, timeout: 60_000}), /deadline/);
const pid = Number(readFileSync(pidFile, 'utf8'));
await new Promise(resolve => setTimeout(resolve, 100));
const state = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], {encoding:'utf8'}).stdout.trim();
assert.ok(state === '' || state.startsWith('Z'), 'Owned descendant still alive: ' + state);
console.log('owned command lifecycle passed');
`);
    const result = spawnSync('node', ['--experimental-strip-types', fixture], {encoding: 'utf8', timeout: 10_000, env: {...process.env, TMPDIR: job}});
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /owned command lifecycle passed/);
  } finally { rmSync(job, {recursive: true, force: true}); }
});
