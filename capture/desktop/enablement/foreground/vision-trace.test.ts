import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, writeFileSync, mkdtempSync, rmSync, statSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const source = readFileSync(new URL('../../scripts/native/foreground/pill-input.swift', import.meta.url), 'utf8');
function block(start: string) {
  const from = source.indexOf(start), end = source.indexOf('\n}\n', from);
  assert.ok(from >= 0 && end > from, start);
  return source.slice(from, end + 3);
}
const phases = ['visionRequestCreation', 'visionRequestConfiguration', 'visionHandlerCreation', 'visionPerform'];
const stages = ['textRecognitionStart', ...phases.flatMap(p => [p + 'Start', p + 'Complete']), 'textRecognitionComplete'];
const production = source.match(/^struct Word .*$/m)![0] + '\n' + block('final class ClickTrace {') + '\n' + block('func recognizeWords(');
const preamble = String.raw`
import Foundation
import CoreGraphics
import Darwin
struct Refusal: Error { let message: String }
func need(_ yes: @autoclosure () throws -> Bool, _ message: String) throws { if try !yes() { throw Refusal(message: message) } }
var clickTrace: ClickTrace?
let helperDeadline = ProcessInfo.processInfo.systemUptime + (CommandLine.arguments[1] == "budget" ? -1 : 8)
` + source.match(/^func withinBudget\(.*$/m)![0] + '\n';
const invoke = String.raw`
clickTrace = try ClickTrace(URL(fileURLWithPath: CommandLine.arguments[2]))
do {
    let words = try recognizeWords(URL(fileURLWithPath: CommandLine.arguments[3]))
    try clickTrace!.requireComplete()
    precondition(words.count == 1 && words[0].text == "SYNTHETIC")
} catch {
    // Match the existing failure stage; do not replace or wrap the provider error.
    clickTrace?.add(["stage":"failure", "message":String(String(describing:error).prefix(240))])
    if let refusal = error as? Refusal {
        precondition(refusal.message == "Adapter exceeded eight-second budget")
        exit(75)
    }
    precondition(error as? MockError == .provider)
    exit(74)
}
`;
function run(executable: string, args: string[], job: string, timeout = 30_000) {
  return spawnSync(executable, args, {encoding: 'utf8', timeout,
    env: {...process.env, TMPDIR: job, CLANG_MODULE_CACHE_PATH: join(job, 'modules')}});
}
function readTrace(file: string) {
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  rows.forEach((row, i) => {
    assert.ok(Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0);
    if (i) assert.ok(row.elapsedMs >= rows[i - 1].elapsedMs);
    assert.deepEqual(Object.keys(row).sort(), (row.stage === 'failure' ? ['elapsedMs','message','stage'] :
      row.stage === 'textRecognitionComplete' ? ['elapsedMs','stage','wordCount'] : ['elapsedMs','stage']).sort());
  });
  assert.doesNotMatch(readFileSync(file, 'utf8'), /SYNTHETIC|private-input|\.png/);
  return rows;
}
function retainFailureBoundary(file: string) {
  if (!existsSync(file)) return;
  // Only fixed vocabulary and monotonic timing enter the retained test report.
  // Incomplete final JSON is expected after external termination.
  const rows = readFileSync(file, 'utf8').slice(0, 16_384).split('\n').flatMap(line => {
    try {
      const row = JSON.parse(line);
      return stages.includes(row.stage) && Number.isFinite(row.elapsedMs) ?
        [{stage: row.stage, elapsedMs: row.elapsedMs}] : [];
    } catch { return []; }
  });
  console.log('Incomplete Vision phase trace: ' + JSON.stringify(rows.slice(-16)));
}

test('observation calls the instrumented production OCR only when requested', () => {
  assert.match(block('func observe('), /if recognizeText \{\s*words = try recognizeWords\(png\)\s*\}/);
});
const darwin = process.platform === 'darwin' ? test : test.skip;
darwin('production Vision orchestration preserves incomplete phases, errors, budget and private monotonic trace', () => {
  const job = mkdtempSync(join(tmpdir(), 'apparent-dev-vision-regression-'));
  try {
    const file = join(job, 'mock.swift'), executable = join(job, 'mock');
    writeFileSync(file, preamble + String.raw`
enum MockError: Error { case provider }
func interrupt(_ phase: String) { if CommandLine.arguments[1] == phase { exit(73) } }
class VNRecognizedText { let string = "SYNTHETIC" }
class Observation {
    let boundingBox = CGRect.zero
    func topCandidates(_ count: Int) -> [VNRecognizedText] { [VNRecognizedText()] }
}
class VNRecognizeTextRequest {
    enum Level { case accurate }
    var recognitionLevel: Level = .accurate { didSet { interrupt("visionRequestConfiguration") } }
    var usesLanguageCorrection = true
    var results: [Observation]? = [Observation()]
    init() { interrupt("visionRequestCreation") }
}
class VNImageRequestHandler {
    init(url: URL) { interrupt("visionHandlerCreation") }
    func perform(_ requests: [VNRecognizeTextRequest]) throws {
        precondition(requests.count == 1 && requests[0].recognitionLevel == .accurate && !requests[0].usesLanguageCorrection)
        interrupt("visionPerform")
        if CommandLine.arguments[1] == "error" { throw MockError.provider }
    }
}
` + production + invoke);
    const compiled = run('/usr/bin/swiftc', [file, '-o', executable], job, 60_000);
    assert.equal(compiled.status, 0, compiled.stderr);
    for (const scenario of ['success', ...phases, 'error', 'budget']) {
      const trace = join(job, scenario + '.log');
      const result = run(executable, [scenario, trace, join(job, 'private-input.png')], job);
      assert.equal(result.status, phases.includes(scenario) ? 73 : scenario === 'error' ? 74 : scenario === 'budget' ? 75 : 0, result.stderr);
      const rows = readTrace(trace), actual = rows.map(row => row.stage);
      const expected = phases.includes(scenario) ? stages.slice(0, stages.indexOf(scenario + 'Start') + 1) :
        scenario === 'error' ? [...stages.slice(0, -2), 'failure'] :
        scenario === 'budget' ? [...stages.slice(0, -1), 'failure'] : stages;
      assert.deepEqual(actual, expected, scenario);
      // Old readers can continue to filter their enclosing events. Incomplete
      // requests never acquire a synthetic completion, even after perform returns.
      assert.deepEqual(actual.filter(s => s.startsWith('textRecognition')), scenario === 'success' ?
        ['textRecognitionStart','textRecognitionComplete'] : ['textRecognitionStart']);
      if (scenario === 'success') assert.equal(rows.at(-1).wordCount, 1);
      if (scenario === 'error') assert.equal(rows.at(-1).message, 'provider');
    }
    console.log('7 production Vision trace scenarios passed');
  } finally { rmSync(job, {recursive: true, force: true}); }
});

darwin('real Vision over an offscreen generated sanitized PNG uses the production phases', () => {
  const job = mkdtempSync(join(tmpdir(), 'apparent-dev-vision-png-'));
  try {
    const file = join(job, 'real.swift'), executable = join(job, 'real'), trace = join(job, 'trace.log');
    writeFileSync(file, preamble + '\nimport AppKit\nimport Vision\n' + production + String.raw`
let image = NSImage(size: NSSize(width: 640, height: 120))
image.lockFocus()
NSColor.white.setFill(); NSRect(x: 0, y: 0, width: 640, height: 120).fill()
("SYNTHETIC" as NSString).draw(at: NSPoint(x: 40, y: 40), withAttributes: [.font:NSFont.systemFont(ofSize: 48), .foregroundColor:NSColor.black])
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
let png = URL(fileURLWithPath: CommandLine.arguments[3])
try bitmap.representation(using: .png, properties: [:])!.write(to: png, options: .withoutOverwriting)
clickTrace = try ClickTrace(URL(fileURLWithPath: CommandLine.arguments[2]))
let words = try recognizeWords(png)
try clickTrace!.requireComplete()
precondition(words.contains { $0.text == "SYNTHETIC" })
`);
    const compiled = run('/usr/bin/swiftc', [file, '-o', executable], job, 60_000);
    assert.equal(compiled.status, 0, compiled.stderr);
    // Same eight-second outer cap as the foreground helper, with no retry.
    const result = run(executable, ['success', trace, join(job, 'private-input.png')], job, 8000);
    if (result.status !== 0) retainFailureBoundary(trace);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readTrace(trace).map(row => row.stage), stages);
    console.log('Real sanitized PNG Vision trace passed');
  } finally { rmSync(job, {recursive: true, force: true}); }
});

test('native consumer requires both production and real Vision proof and preserves refusal', async () => {
  const consumer = readFileSync(new URL('../../ui/frontend/tests/foreground/mac.ts', import.meta.url), 'utf8');
  const from = consumer.indexOf('    // Vision diagnostics qualify'), end = consumer.indexOf('    // Once per case,', from);
  assert.ok(from > 0 && end > from && end < consumer.indexOf("await cli(['screen-permission-status'])"));
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const execute = new AsyncFunction('command','process','path','repo','hostEnv','temporary','assert','evidence','redact', consumer.slice(from, end));
  for (const scenario of ['success','provider','skip','missing-native']) {
    const receipts: string[] = []; let calls = 0;
    const command = async (executable: string, args: string[], options: any) => {
      calls++;
      assert.equal(executable, process.execPath);
      assert.deepEqual(args, ['--experimental-strip-types','--test','/repo/capture/desktop/enablement/foreground/vision-trace.test.ts']);
      assert.equal(options.ownedGroup, true); assert.equal(options.timeout, 60_000);
      assert.equal(options.env.TMPDIR, '/private-job');
      if (scenario === 'provider') throw Error('provider');
      return scenario === 'skip' ? 'skipped' : '7 production Vision trace scenarios passed' +
        (scenario === 'success' ? '\nReal sanitized PNG Vision trace passed' : '');
    };
    const promise = execute(command, process, await import('node:path'), '/repo', {}, '/private-job', assert,
      async (name: string) => { receipts.push(name); }, String);
    if (scenario === 'success') await promise;
    else await assert.rejects(promise);
    assert.equal(calls, 1);
    assert.deepEqual(receipts, [scenario === 'success' ? 'vision-trace-regression' : 'vision-trace-regression-failure']);
  }
});
