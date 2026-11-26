import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { agentFiles } from "../site-build/agent-files.ts";

const publicDir = resolve(
  process.env.SITE_ARTIFACT ??
    resolve(import.meta.dirname, "../../site/dist-apparent"),
);

test("packaged homepage identifies the recorder and its desktop installer without JavaScript", () => {
  const head = readFileSync(join(publicDir, "index.html"), "utf8").split(
    "</head>",
  )[0];
  const records = [
    ...head.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ]
    .map((match) => JSON.parse(match[1]))
    .filter((record) => record["@type"] === "SoftwareApplication");
  assert.equal(records.length, 1);
  const [app] = records;
  assert.equal(app.name, "Apparent");
  assert.equal(app.url, "https://app.tryapparent.com/");
  assert.equal(
    app.installUrl,
    "https://github.com/tryapparent/apparent/releases",
  );
  assert.deepEqual(app.sameAs, ["https://github.com/tryapparent/apparent"]);
  assert.deepEqual(app.operatingSystem, ["macOS", "Linux"]);
  assert.equal(app.image, "https://app.tryapparent.com/social-preview-v1.png");
  assert.ok(existsSync(join(publicDir, new URL(app.image).pathname.slice(1))));
});

test("agent documentation survives the illustrated README and relocated guides", () => {
  const files = agentFiles();
  for (const [name, content] of Object.entries(files)) {
    assert.equal(readFileSync(join(publicDir, name), "utf8"), content);
  }
  assert.match(
    readFileSync(join(publicDir, "sitemap.xml"), "utf8"),
    /<loc>https:\/\/app\.tryapparent\.com\/agents\/<\/loc>/,
  );
  for (const name of ["llms.txt", "llms-full.txt"]) {
    assert.match(files[name], /Point\. Talk\. Draw\./);
    assert.doesNotMatch(
      files[name],
      /readme-banner|\]\((?:\.\.\/|capture\/|shared\/)/,
    );
  }
  const full = files["llms-full.txt"];
  assert.match(full, /## Capture controls[\s\S]*Hold/);
  assert.match(full, /## Export as video[\s\S]*ffmpeg/);
  assert.match(full, /## Keeping captures small[\s\S]*pin/);
  assert.match(
    full,
    /https:\/\/github\.com\/tryapparent\/apparent\/blob\/main\/capture\/agent\/docs\/installation\.md/,
  );
});

test("the public guides are indexable and linked from the agent quickstart", () => {
  const origin = "https://app.tryapparent.com";
  const routes = [
    "/guides/record-screen-for-coding-agent/",
    "/guides/send-existing-screen-recording/",
    "/guides/show-coding-agent-right-ui-element/",
  ];
  const sitemap = readFileSync(join(publicDir, "sitemap.xml"), "utf8");
  const quickstart = readFileSync(join(publicDir, "agents/index.html"), "utf8");
  const index = readFileSync(join(publicDir, "llms.txt"), "utf8");
  for (const route of routes) {
    assert.ok(sitemap.includes(`<loc>${origin}${route}</loc>`), route);
    assert.ok(quickstart.includes(`href="${route}"`), route);
    assert.ok(index.includes(`(${origin}${route})`), route);
    const html = readFileSync(join(publicDir, route.slice(1), "index.html"), "utf8");
    assert.ok(html.includes(`rel="canonical" href="${origin}${route}"`), route);
    assert.match(html, /<meta name="description" content="[^"]+"/);
    assert.doesNotMatch(html, /<script\b|\bnoindex\b/i);
    assert.match(html, /<h1>[^<]+<\/h1>/);
  }
});
