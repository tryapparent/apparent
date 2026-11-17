import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { commandRunner } from "./command-fixture.ts";

const command = commandRunner({
  budget: (cap) => cap,
  environment: () => process.env,
  redact: String,
});
const producer = `require('node:fs').closeSync(0); setTimeout(() => process.exit(0), 150);`;

test("real closed child stdin preserves the actual consumer primary failure and final report", async (t) => {
  const job = await mkdtemp(
    path.join(tmpdir(), "apparent-dev-foreground-pipe-"),
  );
  t.after(async () => {
    try {
      const pid = Number(
        await readFile(path.join(job, "supervisor.pid"), "utf8"),
      );
      const argv = execFileSync(
        "/bin/ps",
        ["-p", String(pid), "-o", "command="],
        { encoding: "utf8" },
      );
      const group = Number(
        execFileSync("/bin/ps", ["-p", String(pid), "-o", "pgid="], {
          encoding: "utf8",
        }),
      );
      assert.ok(
        argv.includes(job) && group === pid,
        "Refuse foreign fixture cleanup",
      );
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" &&
        (error as NodeJS.ErrnoException).code !== "ESRCH" &&
        error.status !== 1
      )
        throw error;
    }
    await rm(job, { recursive: true, force: true });
  });
  const source = await readFile(
    new URL(
      "../../../capture/desktop/ui/frontend/tests/foreground/mac.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const stop = source.slice(
    source.indexOf("async function stop("),
    source.indexOf("async function readyChild("),
  );
  const start = source.indexOf(
    "    finishing = true;",
    source.indexOf("  } catch (error) { primary = error; }"),
  );
  const end = source.indexOf("\n  }\n}\nvoid main()", start);
  assert.ok(start > 0 && end > start, "Actual finalization body must be found");
  const fixture = path.join(job, "fixture.ts");
  await writeFile(
    fixture,
    `
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import {commandRunner} from ${JSON.stringify(new URL("./command-fixture.ts", import.meta.url).href)};
const hostEnv={...process.env,GITHUB_SHA:'synthetic'};
const run=commandRunner({budget: cap=>cap,environment:()=>process.env,redact:String});
const command=()=>run(process.execPath,['-e',${JSON.stringify(producer)}],{timeout:2000,input:'x'.repeat(1024*1024)});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const redact=String;
const ended=child=>child.exitCode!==null||child.signalCode!==null;
const groupAlive=pid=>{try{process.kill(-pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}};
const supervisor=spawn(process.execPath,['-e',${JSON.stringify("setInterval(()=>{},1000)// " + job)}],{detached:true,stdio:'ignore'});
await writeFile(${JSON.stringify(path.join(job, "supervisor.pid"))},String(supervisor.pid));
const scene=undefined,service=undefined,captureId=undefined,appEnv={},root='';
const output=${JSON.stringify(job)};
let finishing=false,primary=Error('Owned accessibility role unavailable');
const cleanupErrors=[],lastControlEvent=undefined;
const evidence=(name,value)=>writeFile(path.join(output,name+'.json'),JSON.stringify(value));
${stop}
try {
${source.slice(start, end)}
} finally {
 try{process.kill(-supervisor.pid,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
 await new Promise(resolve=>supervisor.exitCode!==null||supervisor.signalCode!==null?resolve():supervisor.once('close',resolve));
}
`,
    { mode: 0o600 },
  );
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", fixture],
    { encoding: "utf8", timeout: 8000 },
  );
  assert.equal(result.signal, null);
  assert.equal(result.status, 1, "Native failure must still fail the consumer");
  assert.ok(
    !result.stderr.includes("Emitted 'error' event"),
    "No unhandled stream error",
  );
  const report = JSON.parse(
    await readFile(path.join(job, "report.json"), "utf8"),
  );
  assert.equal(report.passed, false);
  assert.equal(report.error, "Error: Owned accessibility role unavailable");
  assert.equal(report.cleanupErrors.length, 1);
  assert.match(report.cleanupErrors[0], /EPIPE/);
});

test("ordinary stdout, nonzero exit, spawn refusal and deadline keep their failure semantics", async () => {
  assert.equal(
    await command(process.execPath, ["-e", `process.stdout.write('ok')`]),
    "ok",
  );
  await assert.rejects(
    command(process.execPath, [
      "-e",
      `process.stderr.write('failure');process.exit(7)`,
    ]),
    /failure/,
  );
  await assert.rejects(command("/nonexistent-foreground-command", []), {
    code: "ENOENT",
  });
  await assert.rejects(
    command(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      timeout: 80,
    }),
    /deadline/,
  );
});
