import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installUbuntuDependencies, type UbuntuSetup } from './runtime/ubuntu-dependencies.ts'

export const mediaPackages = [
  'ffmpeg', 'pkg-config', 'libgstreamer1.0-dev', 'libgstreamer-plugins-base1.0-dev',
  'gstreamer1.0-plugins-base', 'gstreamer1.0-plugins-good', 'gstreamer1.0-libav',
] as const

// Capture/2 additionally ships the X11 source, H264 encoder and parser plugins.
export const capturePackages = [...mediaPackages, 'xvfb', 'x11-xserver-utils', 'libx11-dev', 'gstreamer1.0-x',
  'gstreamer1.0-plugins-bad', 'gstreamer1.0-plugins-ugly'] as const

// Exact existing root GUI/AppImage build list from appimage/dependencies.sh.
// Reuse bounded apt admission here rather than adding an unbounded setup lane.
export const nativeHostPackages = [
  'build-essential', 'pkg-config', 'cmake', 'ninja-build', 'clang',
  'libxkbcommon-dev', 'libxkbcommon-x11-dev', 'libvulkan-dev',
  'libx11-dev', 'libx11-xcb-dev', 'libxcb1-dev', 'libxcb-shm0-dev', 'libxcb-xfixes0-dev',
  'libxcb-shape0-dev', 'libxcb-randr0-dev', 'libxcb-composite0-dev', 'libxcb-xinput-dev',
  'libxcb-xtest0-dev', 'libasound2-dev', 'libfontconfig-dev', 'libfreetype-dev', 'libssl-dev',
  'libdbus-1-dev', 'libgstreamer1.0-dev', 'libgstreamer-plugins-base1.0-dev',
  'patchelf', 'file', 'ffmpeg', 'wl-clipboard', 'gstreamer1.0-tools', 'gstreamer1.0-plugins-base',
  'gstreamer1.0-plugins-good', 'gstreamer1.0-plugins-bad', 'gstreamer1.0-plugins-ugly',
  'gstreamer1.0-libav', 'gstreamer1.0-pipewire',
] as const

export function installNativeHostDependencies(setup: UbuntuSetup): void {
  installUbuntuDependencies(setup, nativeHostPackages)
}

export function installCaptureDependencies(setup: UbuntuSetup): void {
  installUbuntuDependencies(setup, capturePackages)
}

export function installMediaDependencies(setup: UbuntuSetup): void {
  installUbuntuDependencies(setup, mediaPackages)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Apt owns files beneath this unique temporary directory; the disposable
  // runner removes them with its other job state. Nothing here is an artifact.
  const directory = mkdtempSync(join(tmpdir(), 'apparent-media-apt-'))
  const install = process.argv.includes('--native-host') ? installNativeHostDependencies
    : process.argv.includes('--capture') ? installCaptureDependencies : installMediaDependencies
  install({ directory, osRelease: readFileSync('/etc/os-release', 'utf8'),
    environment: process.env, root: process.getuid?.() === 0 })
}
