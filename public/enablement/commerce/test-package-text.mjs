import assert from "node:assert/strict"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { agentOutputNames } from "../artifact/agent-paths.ts"

const site = fileURLToPath(new URL("../../site/", import.meta.url))
const heading = "Tell your coding agent what to change"
const belief = "We believe work should be"
const canonical = '<link rel="canonical" href="https://app.tryapparent.com/">'

function packageFixture(html) {
  const job = mkdtempSync(join(tmpdir(), "apparent-package-text-"))
  const root = join(job, "site")
  mkdirSync(root)
  try {
    mkdirSync(join(root, "../enablement/site-build"), { recursive: true })
    mkdirSync(join(root, "../enablement/browser-proof"), { recursive: true })
    mkdirSync(join(root, "../enablement/artifact"), { recursive: true })
    mkdirSync(join(root, "dist/agents"), { recursive: true })
    mkdirSync(join(root, "dist-apparent"))
    writeFileSync(join(root, "dist-apparent", "previous.txt"), "previous artifact")
    symlinkSync(join(site, "../node_modules"), join(job, "node_modules"), "dir")
    for (const [group, names] of [["site-build", ["package-apparent.mjs", "package-page-text.mjs", "expected-homepage-canonical.mjs"]], ["browser-proof", ["upstream-link-guard.mjs"]], ["artifact", ["agent-paths.ts"]]]) {
      for (const name of names) cpSync(join(site, "../enablement", group, name), join(root, "../enablement", group, name))
    }
    for (const name of [
      "brand", "connect", "hosted", "assets", "pond", "team", "feature-demos", "apparent-wordmark.svg", "icon.svg", "HostGrotesk-Variable.ttf",
      "social-preview-v1.png", "Apparent-ghost-demo-v4-lilac.mp4", "Apparent-ghost-demo-v4-lilac-poster.jpg",
      "appcast.xml", "og.mp4", "narration.mp3", "narration-iphone.mp3", "releases", "map-tyyxsf5b", "private-pitch.html",
      ...agentOutputNames,
    ]) writeFileSync(join(root, "dist", name), "synthetic fixture")
    writeFileSync(join(root, "dist", "index.html"), html)
    const result = spawnSync(process.execPath, [join(root, "../enablement", "site-build", "package-apparent.mjs")], { encoding: "utf8" })
    return {
      ...result,
      preserved: existsSync(join(root, "dist-apparent", "previous.txt")),
      previous: existsSync(join(root, "dist-apparent", "previous.txt")) ? readFileSync(join(root, "dist-apparent", "previous.txt"), "utf8") : null,
      outputFiles: readdirSync(join(root, "dist-apparent")),
      published: existsSync(join(root, "dist-apparent", "index.html")) ? readFileSync(join(root, "dist-apparent", "index.html"), "utf8") : null,
      leaked: ["appcast.xml", "og.mp4", "narration.mp3", "narration-iphone.mp3", "releases", "map-tyyxsf5b", "private-pitch.html"]
        .filter((name) => existsSync(join(root, "dist-apparent", name))),
    }
  } finally {
    rmSync(job, { recursive: true, force: true })
  }
}

test("packages real text across inline markup and entities without rewriting HTML or copying private files", () => {
  const html = `${canonical}<body><h1 style="display: block">Tell your coding agent what to cha<span>nge</span></h1><h2>We believe work should b&#101;</h2></body>`
  const result = packageFixture(html)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.published, html)
  assert.deepEqual(result.leaked, [])
  assert.equal(result.preserved, false)
})

for (const [name, content] of [
  ["script", `<script>${heading}; ${belief}</script>`],
  ["style", `<style>/* ${heading}; ${belief} */</style>`],
  ["template", `<template>${heading} ${belief}</template>`],
  ["hidden ancestor", `<div hidden><section><h1>${heading}</h1><h2>${belief}</h2></section></div>`],
  ["hidden attribute with false value", `<div hidden="false">${heading} ${belief}</div>`],
  ["inline display:none ancestor", `<div style="color: red; display: none;"><section>${heading} ${belief}</section></div>`],
  ["inline display:none important", `<div style="DISPLAY : NONE !important">${heading} ${belief}</div>`],
  ["noscript", `<noscript>${heading} ${belief}</noscript>`],
  ["iframe fallback", `<iframe>${heading} ${belief}</iframe>`],
  ["comment", `<!-- > ${heading} ${belief} -->`],
  ["attribute", `<div title="> ${heading} ${belief}">unrelated</div>`],
  ["missing headline", `<h2>${belief}</h2>`],
  ["missing belief", `<h1>${heading}</h1>`],
]) {
  test(`rejects stale build with markers only in ${name} before touching previous output`, () => {
    const result = packageFixture(`${canonical}<body>${content}</body>`)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Refusing to package a stale or unrelated build/)
    assert.equal(result.preserved, true)
    assert.equal(result.previous, "previous artifact")
    assert.deepEqual(result.outputFiles, ["previous.txt"])
    assert.equal(result.published, null)
  })
}
