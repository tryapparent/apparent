import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fixture } from "../helpers.mjs";

test("one agent reads encrypted uploads from two Connect accounts", {
  timeout: 120_000,
}, async (t) => {
  const binary = process.env.APPARENT_CONNECT_TEST_BINARY;
  assert.ok(
    binary && isAbsolute(binary),
    "Set APPARENT_CONNECT_TEST_BINARY to the rebuilt CLI",
  );
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "apparent-dev-connect-readers-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const worker = await fixture();
  t.after(() => worker.close());
  await worker.db.exec(
    await readFile(".generated/migrations/0020.sql", "utf8"),
  );
  const proxy = http.createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const result = await worker.call(request.url, {
        method: request.method,
        token: request.headers.authorization?.slice(7),
        raw: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      response.writeHead(result.status, {
        "Content-Type":
          result.headers.get("content-type") ?? "application/octet-stream",
      });
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        proxy.closeAllConnections();
        proxy.close(() => resolve());
      }),
  );
  const address = proxy.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings = JSON.stringify({
    cloud: { server: origin },
    experiments: { hostedEncryption: true },
  });
  async function profile(name: string) {
    const cwd = join(root, name);
    await mkdir(cwd, { mode: 0o700 });
    const config = join(cwd, "config.json");
    await writeFile(config, settings, { mode: 0o600 });
    return { cwd, config };
  }
  async function run(
    owner: Awaited<ReturnType<typeof profile>>,
    args: string[],
    approve?: Awaited<ReturnType<typeof worker.identity>>,
  ) {
    const child = spawn(binary!, args, {
      cwd: owner.cwd,
      env: { ...process.env, APPARENT_CONFIG: owner.config },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const lines = createInterface({ input: child.stdout });
    const timer = setTimeout(() => child.kill("SIGKILL"), 35_000);
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("close", resolve);
      child.once("error", reject);
    });
    try {
      for await (const line of lines) {
        stdout += `${line}\n`;
        if (approve && line.startsWith("Open ")) {
          const userCode = new URL(line.slice(5)).searchParams.get("code");
          const result = await worker.call("/v1/device/approve", {
            ...approve,
            method: "POST",
            body: { userCode },
          });
          assert.equal(result.status, 200);
        }
      }
      return { code: await exited, stdout, stderr, signal: child.signalCode };
    } finally {
      clearTimeout(timer);
      lines.close();
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  }
  async function success(...args: Parameters<typeof run>) {
    const result = await run(...args);
    assert.equal(result.code, 0, result.stderr || String(result.signal));
    return result.stdout;
  }

  const agent = await profile("agent");
  const captures = [];
  for (const name of ["first", "second"]) {
    const account = await worker.identity(name);
    const sender = await profile(name);
    await success(
      agent,
      [
        "connect",
        "login",
        "--reader",
        name,
        "--server",
        origin,
        "--no-browser",
      ],
      account,
    );
    await success(
      sender,
      [
        "connect",
        "login",
        "--scope",
        "upload",
        "--consent-upload",
        "--server",
        origin,
        "--no-browser",
      ],
      account,
    );
    const bundle = join(sender.cwd, "source.apparent");
    await mkdir(bundle, { mode: 0o700 });
    const transcript = `Synthetic recording ${name}`;
    const video = `synthetic video ${name}`;
    await writeFile(join(bundle, "recording.mov"), video);
    await writeFile(join(bundle, "summary.md"), transcript);
    await writeFile(
      join(bundle, "contact-sheet.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/p0AAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await writeFile(
      join(bundle, "apparent.json"),
      JSON.stringify({
        version: 1,
        id: name,
        createdAtMs: 0,
        durationMs: 4000,
        target: {
          mode: "display",
          displayId: 1,
          frame: { x: 0, y: 0, width: 32, height: 32, scale: 1 },
        },
        transcript: { source: "synthetic", text: transcript, segments: [] },
        strokes: [],
        marks: [],
        events: [],
        keyframes: [],
        contactSheet: "contact-sheet.png",
        video: "recording.mov",
      }),
    );
    const output = await success(sender, ["connect", "upload", bundle]);
    const id =
      output.match(/apparent inspect ([a-f0-9]{32})/)?.[1] ??
      (
        JSON.parse(await success(sender, ["connect", "status"])) as {
          queue: { status: string; id: string }[];
        }
      ).queue.find((job) => job.status === "ready")?.id;
    assert.ok(id?.match(/^[a-f0-9]{32}$/), "expected a ready capture ID");
    const stored = await worker.db
      .prepare("SELECT account_id, format FROM captures WHERE id=?")
      .bind(id)
      .first();
    assert.equal(stored.account_id, account.id);
    assert.equal(stored.format, "apparent-encrypted-v2");
    captures.push({ name, id, transcript, video });
    if (name === "first") {
      const config = JSON.parse(await readFile(sender.config, "utf8"));
      config.experiments.speakingStyle = true;
      await writeFile(sender.config, JSON.stringify(config));
      const manifest = JSON.parse(
        await readFile(join(bundle, "apparent.json"), "utf8"),
      );
      manifest.id = "current-example";
      manifest.transcript.text = "Only the current recording contains this.";
      await writeFile(join(bundle, "apparent.json"), JSON.stringify(manifest));
      const uploaded = await success(sender, ["connect", "upload", bundle]);
      const current =
        uploaded.match(/\b[a-f0-9]{32}\b/)?.[0] ??
        JSON.parse(await success(sender, ["connect", "status"])).queue.find(
          (job: { status: string; id: string }) =>
            job.status === "ready" && job.id !== id,
        )?.id;

      assert.ok(current, uploaded);
      assert.match(
        await success(agent, ["inspect", current]),
        /--style-examples/,
      );
      const examples = await success(agent, [
        "inspect",
        current,
        "--style-examples",
      ]);
      assert.match(examples, /Synthetic recording first/);
      assert.doesNotMatch(examples, /Only the current/);
      assert.notEqual(
        (await run(agent, ["inspect", id, "--style-examples"])).code,
        0,
      );
    }
  }
  assert.equal(await readFile(agent.config, "utf8"), settings);
  const profiles = JSON.parse(await success(agent, ["connect", "readers"])) as {
    name: string;
  }[];
  assert.deepEqual(
    profiles.map(({ name }) => name),
    ["default", "first", "second"],
  );
  for (const capture of captures) {
    const wrong = capture.name === "first" ? "second" : "first";
    const out = join(agent.cwd, `${capture.name}.apparent`);
    const refusal = await run(agent, [
      "fetch",
      capture.id,
      "--out",
      out,
      "--reader",
      wrong,
    ]);
    assert.notEqual(refusal.code, 0);
    assert.match(refusal.stderr, /not_found/);
    await assert.rejects(stat(out), { code: "ENOENT" });
    const listing = JSON.parse(
      await success(agent, ["connect", "files", capture.id]),
    ) as { files: { path: string }[] };
    assert.ok(listing.files.some(({ path }) => path === "recording.mov"));
    await success(agent, ["fetch", capture.id, "--out", out]);
    assert.equal(
      await readFile(join(out, "recording.mov"), "utf8"),
      capture.video,
    );
    const inspected = JSON.parse(
      await success(agent, ["inspect", capture.id, "--json"]),
    );
    assert.equal(inspected.transcript.text, capture.transcript);
  }
  await success(agent, ["connect", "logout", "--reader", "first"]);
  const after = JSON.parse(await success(agent, ["connect", "readers"]));
  assert.equal(after[1].auth.status, "signed_out");
  assert.equal(after[2].auth.status, "signed_in");
  await success(agent, [
    "fetch",
    captures[1].id,
    "--out",
    join(agent.cwd, "after-logout.apparent"),
  ]);
  assert.equal(await readFile(agent.config, "utf8"), settings);
});
