// Cargo's application version is the shared user-facing Mac/Linux release identity.
import {appendFileSync, readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function desktopVersion(manifest: string, tag = ''): {version: string; macTag: string} {
  const section = manifest.match(/^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  const versions = [...(section ?? '').matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)];
  const version = versions[0]?.[1];
  if (versions.length !== 1 || !version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Desktop release requires one numeric package version');
  }
  if (tag && tag !== `v${version}`) throw new Error('Release tag differs from the shared desktop version');
  const suffix = version.startsWith('0.') ? version.slice(2) : version;
  return {version, macTag: `preview-mac-${suffix.replaceAll('.', '-')}`};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {version, macTag} = desktopVersion(readFileSync(new URL('../../../../Cargo.toml', import.meta.url), 'utf8'), process.env.TAG);
  if (!process.env.GITHUB_ENV) throw new Error('Missing workflow environment file');
  appendFileSync(process.env.GITHUB_ENV, `APPARENT_RELEASE_VERSION=${version}\nAPPARENT_PREVIEW_VERSION=${version}\nAPPARENT_PREVIEW_TAG=${macTag}\n`);
}
