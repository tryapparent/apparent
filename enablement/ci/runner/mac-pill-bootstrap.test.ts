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
test('prepare dispatches through early admission; clicks and snapshots retain their own observation paths', () => {
  assert.match(source, /op == "prepare" \? observeForPreparation\(req, out\) :\s*\(op == "click" \? observeBeforeInput\(req, out\) : observe\(req, out\)\)/);
});
const swiftTest = process.platform === 'darwin' ? test : test.skip;
swiftTest('production Swift bootstrap overlaps OCR and refuses changed ownership, foreground, budget and provider failures', () => {
  const job = mkdtempSync(join(tmpdir(), 'mac-pill-bootstrap-'));
  try {
    const path = join(job, 'bootstrap.swift');
    writeFileSync(path, String.raw`
import Foundation
struct Refusal: Error { let message: String }
func need(_ yes: @autoclosure () throws -> Bool, _ message: String) throws { if try !yes() { throw Refusal(message: message) } }
struct Pill { let pid: pid_t; let id: UInt32; let rect: CGRect }
struct Word {}
final class Trace {
    func requireComplete() throws { if fault == "trace" { throw Refusal(message: "trace failure") } }
    func add(_ fields: [String: Any]) {}
}
var clickTrace: Trace? = Trace()
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
func observe(_ req: [String: Any], _ png: URL) throws -> ([String: Any], [Word], Set<pid_t>) {
    events.append("ocr")
    if fault == "ocr" { throw Refusal(message: "OCR failure") }
    now += fault == "budget" ? 8 : 5.34
    if fault == "pid" { current = Pill(pid: 43, id: current.id, rect: current.rect) }
    if fault == "window" { current = Pill(pid: current.pid, id: 8, rect: current.rect) }
    if fault == "bounds" { current = Pill(pid: current.pid, id: current.id, rect: .zero) }
    if fault == "foreground" { foreground = 100 }
    return (["pid": Int(current.pid), "windowId": Int(current.id),
        "bounds": [current.rect.minX,current.rect.minY,current.rect.width,current.rect.height],
        "frontPid": fault == "observedFront" ? 100 : Int(foreground)], [], [current.pid])
}
func ownedAccessibilityButton(_ expected: Pill, label: String, point: CGPoint, descendants: Set<pid_t>) throws -> [String: Any]? {
    events.append("tree")
    if fault == "tree" { throw Refusal(message: "ambiguous or unavailable tree") }
    if fault == "neverReady" || now - admittedAt < 2 { return nil }
    return ["pid": Int(expected.pid), "label": label]
}
// Virtual time only replaces the wait/provider boundary, never the production
// ordering and guards under test. No AppKit or physical input is linked here.
enum Thread { static func sleep(forTimeInterval seconds: Double) { now += seconds } }
` + ['currentPill', 'observeForPreparation', 'preparePillAccessibility'].map(declaration).join('\n') + String.raw`
let png = URL(fileURLWithPath: "/unused-synthetic.png")
for scenario in ["", "unowned", "wrongFront", "admission", "ocr", "pid", "window", "bounds", "foreground", "observedFront", "budget", "tree", "neverReady", "trace"] {
    fault = scenario; now = 0; admittedAt = -1; events = []; foreground = 99
    current = Pill(pid: 42, id: 7, rect: CGRect(x: 1, y: 2, width: 100, height: 30))
    let expected = current
    var passed = false
    do {
        _ = try observeForPreparation(["expectedFrontPid": scenario == "wrongFront" ? 100 : 99], png)
        _ = try preparePillAccessibility([:], expected, label: "Finish", point: .zero, descendants: [42])
        passed = true
    } catch {}
    precondition(passed == scenario.isEmpty, "Unexpected acceptance: \(scenario)")
    if scenario.isEmpty {
        precondition(events == ["admit", "ocr", "tree"], "Admission must precede OCR exactly once")
        precondition(now < 8 && now >= 5.34)
    }
    if ["unowned", "wrongFront"].contains(scenario) { precondition(events.isEmpty) }
    if scenario == "admission" { precondition(events == ["admit"]) }
    if ["ocr", "pid", "window", "bounds", "foreground", "observedFront", "budget"].contains(scenario) {
        precondition(!events.contains("tree"), "Failed observation must never reach receiver acceptance")
    }
    if scenario == "neverReady" { precondition(now >= 8 && now < 8.1) }
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
  const start = consumer.indexOf('async function command('), end = consumer.indexOf('\nasync function cli(', start);
  assert.ok(start > 0 && end > start);
  const job = mkdtempSync(join(tmpdir(), 'pill-command-'));
  try {
    const fixture = join(job, 'command.ts');
    writeFileSync(fixture, `import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {writeFileSync, readFileSync} from 'node:fs';
let appEnv = process.env, remaining = 2000;
const budget = (cap: number) => { assert.ok(remaining > 0); return Math.min(cap, remaining); };
const redact = String;
${consumer.slice(start, end)}
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
