import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  connectTo,
  waitFor,
} from "../../../shared/enablement/performance/electron-observer.ts";

type Observer = Awaited<ReturnType<typeof connectTo>>;
type Process = { kill(signal?: NodeJS.Signals): boolean };
type Status = {
  capture_id?: string;
  status?: string;
  bundle_path?: string;
  state?: { phase?: string };
};
type Waits = Record<string, { ms: number; verified: true }>;
type Fixture = {
  output: string;
  scratch: string;
  runtime: string;
  cue: string;
  sink: string;
  commands: (args: string[], timeout?: number) => Promise<string>;
  start: (program: string, args: string[], log: string) => Process;
  config: () => Promise<void>;
  phase: (name: string) => Promise<void>;
};
const focusedDraft =
  'document.hasFocus() && document.activeElement?.id === "draft" && document.visibilityState === "visible"';
const focusedNote =
  'document.hasFocus() && document.visibilityState === "visible" && document.activeElement?.getAttribute("aria-label") === "Note text"';
const ready = (observer: Observer, expression: string, what: string) =>
  waitFor(
    async () => (await observer.evaluate<boolean>(expression)) || undefined,
    what,
  );

async function key(
  observer: Observer,
  key: string,
  windowsVirtualKeyCode: number,
) {
  for (const type of ["keyDown", "keyUp"])
    await observer.send("Input.dispatchKeyEvent", {
      type,
      key,
      code: key,
      windowsVirtualKeyCode,
    });
}

async function compose({ output, scratch, runtime, start }: Fixture) {
  const script = join(scratch, "benchmark-draft.cjs");
  await writeFile(
    script,
    `
const { app, BrowserWindow } = require("electron");
app.setPath("userData", ${JSON.stringify(join(scratch, "benchmark-draft-profile"))});
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 740, height: 480, title: "Apparent benchmark draft" });
  window.loadURL("data:text/html," + encodeURIComponent('<title>Apparent benchmark draft</title><label for="draft">Synthetic draft</label><textarea id="draft" autofocus rows="18" cols="70"></textarea>'));
});
`,
    { flag: "wx", mode: 0o600 },
  );
  const process = start(
    runtime,
    ["--disable-setuid-sandbox", "--ozone-platform=x11", script],
    "benchmark-draft.log",
  );
  const draft = await connectTo(output, "draft", /^data:text\/html,/);
  return {
    draft,
    close: () => {
      draft.close();
      process.kill("SIGTERM");
    },
  };
}

async function caption({ start, sink, cue }: Fixture, pill: Observer) {
  const observed = () =>
    pill.evaluate<string>(`(() => {
    const line = document.querySelector('[aria-label="Live local transcription"]');
    const box = line?.getBoundingClientRect();
    return document.visibilityState === "visible" && box?.width && box?.height ? line.innerText : "";
  })()`);
  const before = await observed();
  assert(
    !/\bopen the project settings\b/i.test(before),
    "Cue already appeared in the caption before playback",
  );
  assert(
    !before.includes("unavailable"),
    "Local speech preview unavailable before playback: " + before,
  );
  const started = performance.now();
  const player = start(
    "pw-play",
    [
      "--target=" + sink,
      "--properties={node.dont-fallback=true node.dont-reconnect=true}",
      cue,
    ],
    "caption-player.log",
  );
  try {
    const text = await waitFor(
      async () => {
        const text = await observed();
        return /\bopen the project settings\b/i.test(text) ? text : undefined;
      },
      "the spoken English cue in the visible caption",
      18000,
    );
    await pill.painted();
    return { text, ms: performance.now() - started };
  } finally {
    player.kill("SIGTERM");
  }
}

const mark = (output: string, name: string, value: object) =>
  writeFile(
    join(output, name + "-verified.json"),
    JSON.stringify(value) + "\n",
    { flag: "wx", mode: 0o600 },
  );
async function measureNote({ output, phase }: Fixture, id: string) {
  const note = await connectTo(output, "notes", /#notes-popup$/);
  try {
    assert(
      !(await note.evaluate(focusedNote)),
      "Note editor was already focused",
    );
    await phase("interaction note");
    try {
      await ready(note, focusedNote, "a real focused note field");
    } catch (error) {
      console.error(
        await note.evaluate(
          `({ active: document.activeElement?.outerHTML.slice(0,180), focused: document.hasFocus(), visibility: document.visibilityState, content: document.body.innerText.slice(0,160) })`,
        ),
      );
      throw error;
    }
    await note.painted();
    const value = "Synthetic note accepted";
    await note.send("Input.insertText", { text: value });
    assert.equal(await note.evaluate("document.activeElement.value"), value);
    await mark(output, "note", { captureId: id, value });
    await key(note, "Escape", 27);
  } finally {
    note.close();
  }
}

async function measureCancel(
  { commands }: Fixture,
  pill: Observer,
  draft: Observer,
  id: string,
) {
  const started = await pill.click(
    "main[data-phase=recording] button[data-action=cancel]",
  );
  const stopped = waitFor(async () => {
    const receipt = JSON.parse(
      await commands(["capture", "inspect", id]),
    ) as Status;
    const state = JSON.parse(await commands(["capture", "state"])) as Status;
    return receipt.capture_id === id &&
      receipt.status === "cancelled" &&
      !receipt.bundle_path &&
      state.state?.phase === "idle"
      ? receipt
      : undefined;
  }, "the same capture cancelled and recorder quiescent");
  stopped.catch(() => {});
  await ready(draft, focusedDraft, "focused foreground draft after Cancel");
  await draft.send("Input.insertText", { text: "Input resumed" });
  assert.equal(
    await draft.evaluate("document.activeElement.value"),
    "Input resumed",
  );
  await stopped;
  const ms = performance.now() - started;
  await draft.evaluate("document.activeElement.select()");
  await key(draft, "Backspace", 8);
  return ms;
}

export async function measureInteractions(fixture: Fixture) {
  const { output, commands, phase } = fixture;
  const { draft, close } = await compose(fixture);
  const waits: Waits = {};
  const version = (await readFile(join(output, "version.txt"), "utf8")).trim();
  const attempt = async (name: string, measure: () => Promise<void>) => {
    try {
      await measure();
    } catch (error) {
      console.error(
        "Interaction " +
          name +
          ": " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  };
  const id = randomUUID().replaceAll("-", "");
  try {
    await ready(draft, focusedDraft, "external draft keyboard focus");
    await fixture.config();
    await phase("interactions");
    const active = JSON.parse(
      await commands(
        ["capture", "start", "--request-id", id, "--wait", "--timeout", "75"],
        85000,
      ),
    ) as Status;
    assert(active.capture_id === id && active.status === "recording");
    const pill = await connectTo(output, "pill", /\/pill\/index\.html$/);
    try {
      await attempt("captions", async () => {
        const { ms, text } = await caption(fixture, pill);
        await mark(output, "captions", { captureId: id, ms, text });
        waits.captions = { ms, verified: true };
      });
      await attempt("note", async () => {
        await draft.send("Page.bringToFront");
        await ready(
          draft,
          focusedDraft,
          "external keyboard focus before the note gesture",
        );
        await draft.evaluate(`(() => {
          window.benchmarkKeys = [];
          for (const type of ["keydown", "keyup"]) document.addEventListener(type, event =>
            window.benchmarkKeys.push([event.type, event.code, event.isTrusted]), { capture: true });
        })()`);
        try {
          await measureNote(fixture, id);
        } catch (error) {
          console.error(
            "Draft input seen during note gesture",
            await draft.evaluate("window.benchmarkKeys"),
          );
          throw error;
        }
      });
      await attempt("cancel", async () => {
        const ms = await measureCancel(fixture, pill, draft, id);
        await mark(output, "cancel", { captureId: id, ms });
        waits.cancel = { ms, verified: true };
      });
    } finally {
      pill.close();
      await commands(["capture", "cancel", id], 5000).catch(() => {});
    }
    await attempt("paste-last", async () => {
      await ready(draft, focusedDraft, "focused latest-paste destination");
      assert.equal(await draft.evaluate("document.activeElement.value"), "");
      const expected = (
        await readFile(join(output, "shortcut-repeat-expected.txt"), "utf8")
      ).trimEnd();
      assert(
        expected.includes("apparent inspect ") &&
          expected.includes(".apparent"),
      );
      await phase("interaction paste-last");
      await waitFor(
        async () => {
          const value = await draft.evaluate<string>(
            "document.activeElement?.value",
          );
          return value?.trimEnd() === expected ? value : undefined;
        },
        "exact latest capture text in the focused external draft",
        13000,
      );
      await mark(output, "paste-last", { value: expected });
    });
  } finally {
    close();
    await writeFile(
      join(output, "interaction-waits.json"),
      JSON.stringify({ version, waits }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
}
