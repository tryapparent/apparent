import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {desktopVersion} from './desktop-version.ts';

test('one package version supplies both release identities without workflow counters', () => {
  const manifest = '[workspace]\nmembers=[]\n[package]\nname="apparent"\nversion = "0.22.1"\n[dependencies]\nother="9.9.9"\n';
  assert.deepEqual(desktopVersion(manifest), {version: '0.22.1', macTag: 'preview-mac-22-1'});
  assert.equal(desktopVersion(manifest, 'v0.22.1').version, '0.22.1');
  assert.throws(() => desktopVersion(manifest, 'v0.3.13'), /differs/);
  for (const value of ['01.22.1', '0.22.1-preview', '0.22', '0.22.1\nEVIL=1']) {
    assert.throws(() => desktopVersion(`[package]\nversion="${value}"\n`), /numeric/);
  }
  assert.throws(() => desktopVersion('[package]\nversion="0.22.1"\nversion="0.23.1"\n'), /one numeric/);
});

test('both publishing workflows resolve the canonical version before PostHog and compilation', () => {
  for (const platform of ['mac-preview', 'linux']) {
    const workflow = readFileSync(new URL(`../../../../.github/workflows/release-${platform}.yml`, import.meta.url), 'utf8');
    const resolution = workflow.indexOf('node --experimental-strip-types capture/desktop/scripts/release/desktop-version.ts');
    assert.ok(resolution > 0 && resolution < workflow.indexOf('- name: Register PostHog desktop release'));
    assert.ok(!workflow.includes('APPARENT_PREVIEW_VERSION=0.$GITHUB_RUN_NUMBER'));
    assert.ok(!workflow.includes('APPARENT_RELEASE_VERSION="${TAG:-linux-main-v2-'));
  }
});
