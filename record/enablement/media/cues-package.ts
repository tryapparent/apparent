/** Controlled transcriber output through actual phone, screen and recovery assembly. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export function qualifySpeechCues(options: {
  binary: string; sourceBundle: string; root: string; home: string; runtimeDirectory: string;
}) {
  const {binary, sourceBundle, root, home, runtimeDirectory} = options;
  const directory = join(root, 'speech-proof'); mkdirSync(directory, {mode: 0o700});
  const movie = join(directory, 'source.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=4:d=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=6',
    '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', movie], {timeout: 30_000});
  chmodSync(movie, 0o600);
  const wav = join(directory, 'source.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', movie, '-ac', '1', '-ar', '16000', wav], {timeout: 30_000});
  chmodSync(wav, 0o600);
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const movieHash = hash(movie), rows = [];
  for (const route of ['phone', 'screen', 'recovery']) for (const estimated of [false, true]) {
    const name = route + (estimated ? '-estimated' : '-measured');
    const input = join(directory, name + '-input.apparent'), output = join(directory, name + '-output.apparent');
    cpSync(sourceBundle, input, {recursive: true, errorOnExist: true, force: false}); chmodSync(input, 0o700);
    cpSync(movie, join(input, 'recording.mp4')); chmodSync(join(input, 'recording.mp4'), 0o600);
    cpSync(wav, join(input, 'audio.wav')); chmodSync(join(input, 'audio.wav'), 0o600);
    const transcript = {version: 1, estimated, text: 'Look here. Now watch this.',
      words: [[500, 'Look'], [700, 'here.'], [3000, 'Now'], [3200, 'watch'], [3400, 'this.']]
        .map(([t, text]) => ({t0: Number(t), t1: Number(t) + 100, text: String(text)}))};
    const transcriber = join(directory, name + '-transcriber.ts'), config = join(directory, name + '-config.json');
    writeFileSync(transcriber, `console.log(JSON.stringify(${JSON.stringify(transcript)}));\n`, {mode: 0o600});
    writeFileSync(config, JSON.stringify({transcriber: 'command', transcribeTimeoutSeconds: 10,
      transcribeCommand: [process.execPath, '--experimental-strip-types', transcriber, '{audio}']}), {mode: 0o600});
    const manifestPath = join(input, 'apparent.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    Object.assign(manifest, {durationMs: 6000, source: route === 'phone' ? 'iphone' : 'screen',
      device: route === 'phone' ? {name: 'Synthetic file', capture: 'mirror', width: 64, height: 48} : undefined,
      target: {mode: 'display', displayId: 0, frame: {x: 0, y: 0, width: 64, height: 48, scale: 1}},
      video: 'recording.mp4', videoOffsetMs: 0, strokes: [], marks: [], events: [], cursor: []});
    // Screen/recovery consume capture's separate WAV; phone ingestion owns movie extraction.
    manifest.audio = 'audio.wav';
    writeFileSync(manifestPath, JSON.stringify(manifest), {mode: 0o600});
    const preserved = [movie, wav, join(input, 'recording.mp4'), join(input, 'audio.wav'), manifestPath, transcriber, config].map(path => [path, hash(path)] as const);
    execFileSync(binary, ['reprocess', input, '--out', output, '--transcriber', 'command',
      ...(route === 'screen' ? ['--bench', '1'] : [])], {timeout: 90_000, stdio: 'pipe', env: {...process.env,
        HOME: home, CFFIXED_USER_HOME: home, APPARENT_CONFIG: config, APPARENT_MODELS_DIR: join(home, 'unused-models'),
        XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'),
        XDG_RUNTIME_DIR: runtimeDirectory, DISPLAY: '', WAYLAND_DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: '', APPIMAGE_EXTRACT_AND_RUN: '1'}});
    const result = JSON.parse(readFileSync(join(output, 'apparent.json'), 'utf8'));
    assert.match(result.transcript.source, /^command:/); assert.equal(result.transcript.text, transcript.text);
    assert.equal(Boolean(result.transcript.estimated), estimated);
    assert.equal(result.keyframes.length, 1, 'spoken cues must not duplicate an unchanged screen');
    const frame = result.keyframes[0];
    assert.equal(frame.reason, estimated ? 'initial' : 'speech', 'estimated timing must not create a speech cue');
    assert.equal(frame.said, transcript.text, 'selection must retain the full transcript');
    assert.equal(frame.t, estimated ? 3000 : 750, 'selected timestamp must preserve the baseline cue-word binding');
    assert.equal(frame.event, estimated ? 'initial view' : 'said “look”');
    const pixels = execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', join(output, frame.file),
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {timeout: 10_000, maxBuffer: 1024 * 1024});
    assert.equal(pixels.length, 64 * 48 * 4); const center = (24 * 64 + 32) * 4;
    assert(pixels[center + 2] > pixels[center] + 40, 'the actual decoded frame must stay blue');
    for (const [path, before] of preserved) assert.equal(hash(path), before, 'source or isolated config changed');
    rows.push({route, estimated, keyframes: result.keyframes, sheet: join(output, result.contactSheet),
      frameHash: hash(join(output, frame.file)), sourcePreserved: true});
  }
  assert.equal(hash(movie), movieHash);
  return rows;
}
