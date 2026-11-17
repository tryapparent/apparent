#!/usr/bin/env -S node --experimental-strip-types
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import type { Asset, Release, Ref } from "../github.ts";
const args = process.argv.slice(2);
appendFileSync(process.env.FIXTURE_LOG!, JSON.stringify(args) + "\n");
const routes: Record<string, { file?: string; json?: unknown }> = JSON.parse(
  readFileSync(process.env.FIXTURE_ROUTES!, "utf8"),
);
const statePath = process.env.FIXTURE_STATE;
if (statePath) {
  const state: {
    release?: Release;
    tag?: Ref;
    uploads: number;
    failUpload?: number;
  } = JSON.parse(readFileSync(statePath, "utf8"));
  const save = () => writeFileSync(statePath, JSON.stringify(state));
  const reply = (value: unknown) => {
    save();
    process.stdout.write(JSON.stringify(value));
    process.exit(0);
  };
  const path = args[1]?.replace(/^repos\/tryapparent\/apparent\//, "");
  const method = args[args.indexOf("--method") + 1];
  if (args[0] === "release" && args[1] === "upload") {
    state.uploads++;
    if (state.uploads === state.failUpload) {
      save();
      process.stderr.write("fixture interrupted upload");
      process.exit(1);
    }
    const bytes = readFileSync(args[3]);
    const asset: Asset = {
      name: basename(args[3]),
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      size: bytes.length,
      state: "uploaded",
    };
    if (
      !state.release ||
      state.release.assets.some((a) => a.name === asset.name)
    )
      process.exit(1);
    state.release.assets.push(asset);
    reply({});
  }
  if (args[0] === "api") {
    if (path === "releases?per_page=100&page=1")
      reply(state.release ? [state.release] : []);
    if (
      path === `git/ref/tags/${process.env.FIXTURE_TAG ?? "v1.2.3"}` &&
      state.tag
    )
      reply(state.tag);
    if (path === "git/refs" && method === "POST") {
      const body: { sha: string } = JSON.parse(readFileSync(0, "utf8"));
      state.tag = { object: { type: "commit", sha: body.sha } };
      reply(state.tag);
    }
    if (path === "commits/v1.2.3" && state.tag)
      reply({ sha: state.tag.object.sha });
    if (path === "releases" && method === "POST") {
      state.release = {
        ...JSON.parse(readFileSync(0, "utf8")),
        id: 100,
        assets: [],
      };
      reply(state.release);
    }
    if (path === "releases/100" && state.release) {
      if (method === "PATCH")
        Object.assign(state.release, JSON.parse(readFileSync(0, "utf8")));
      reply(state.release);
    }
  }
}
const response = routes[args[1]];
if (args[0] !== "api" || !response) {
  process.stderr.write("Unconfigured fixture request (HTTP 404)");
  process.exit(1);
}
process.stdout.write(
  response.file ? readFileSync(response.file) : JSON.stringify(response.json),
);
