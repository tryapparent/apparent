import { execFile, spawn } from 'node:child_process';
import path from 'node:path';

// Launch the installed Mac app through Launch Services, rather than inheriting
// the calling terminal/Hermes process's privacy responsibility via posix_spawn.
// Unbundled development executables retain their existing direct-launch route.
export function recorderLaunch(executable: string, platform: NodeJS.Platform = process.platform) {
  if (!path.isAbsolute(executable) || /[\x00-\x1f\x7f]/.test(executable)) throw new Error('Invalid Apparent executable');
  const macOS = path.dirname(executable);
  const contents = path.dirname(macOS);
  const bundle = path.dirname(contents);
  if (platform === 'darwin' && path.basename(executable) === 'apparent' &&
      path.basename(macOS) === 'MacOS' && path.basename(contents) === 'Contents' && bundle.endsWith('.app')) {
    // No -n: reuse the installed instance. No -W: capture readiness is checked
    // separately. -g preserves the user's foreground app; setup may still show.
    return { file: '/usr/bin/open', args: ['-g', '-a', bundle, '--args', 'launch', '--background'], waitForExit: true };
  }
  return { file: executable, args: ['launch', '--background'], waitForExit: false };
}

export async function launchRecorder(executable: string) {
  const command = recorderLaunch(executable);
  if (command.waitForExit) {
    await new Promise<void>((resolve, reject) => {
      execFile(command.file, command.args, { timeout: 5000, maxBuffer: 8192 }, error => {
        if (error) reject(new Error('Open the installed Apparent app and complete onboarding, then try again.'));
        else resolve();
      });
    });
    return;
  }
  const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}
