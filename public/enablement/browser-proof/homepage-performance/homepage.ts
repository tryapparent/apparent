import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname, release } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, devices, type Page } from "playwright-core";
import { verifyDemo } from "./demo.ts";
import { externalEffects, scenario, servePackage } from "./fixture.ts";
import {
  evaluateInterference,
  hostedInterference,
  hostedSampler,
} from "./hosted-guard/interference.ts";
import {
  idlePreflight,
  maxCpuPressurePercent,
  pressure,
  pressureSample,
  processes,
} from "./resources.ts";
import {
  account,
  rendererSpans,
  startTrace,
  writeWaterfall,
  type Span,
} from "./trace.ts";

const { values } = parseArgs({
  options: {
    artifact: { type: "string" },
    revision: { type: "string" },
    output: { type: "string" },
    runs: { type: "string", default: "5" },
    "max-blocks": { type: "string" },
    mode: { type: "string", default: "quiet" },
    control: { type: "string", multiple: true },
    size: { type: "string", default: "desktop" },
    theme: { type: "string", default: "light" },
    "idle-preflight": { type: "boolean" },
    "pressure-diagnostic": { type: "boolean" },
  },
});
if (
  !values.artifact ||
  !values.output ||
  !/^[a-f0-9]{40}$/.test(values.revision ?? "")
)
  throw new Error(
    "Supply --artifact, --revision (full source SHA) and --output",
  );
const runs = Number(values.runs);
const maxBlocks = Number(values["max-blocks"] ?? runs);
assert(Number.isSafeInteger(runs) && runs > 0);
assert(Number.isSafeInteger(maxBlocks) && maxBlocks >= runs);
assert(["quiet", "trace", "calibrate"].includes(values.mode));
const diagnostic = values["pressure-diagnostic"];
assert(
  !diagnostic || (values.mode === "calibrate" && runs === 1 && maxBlocks === 1),
);
const scope = process.env.APPARENT_PUBLIC_BENCHMARK_CGROUP;
const sampleHosted = scope && hostedSampler(scope);

assert(["desktop", "phone", "small-phone"].includes(values.size));
assert(values.theme === "dark" || values.theme === "light");
const mobile = values.size !== "desktop";
const phone = devices["iPhone 13"];
const viewport = mobile
  ? { width: values.size === "phone" ? 390 : 320, height: 852 }
  : scenario.viewport;
const artifacts = resolve(values.artifact);
const output = resolve(values.output);
const runId = randomUUID();
await mkdir(output, { recursive: true });
const site = await servePackage(artifacts);
const receipts: (Awaited<ReturnType<typeof attempt>> & {
  eligible: boolean;
})[] = [];
let completeBlocks = 0;
const demos: {
  attemptId: string;
  evidence: Awaited<ReturnType<typeof verifyDemo>>;
}[] = [];
const failed: { attemptId: string; error: string }[] = [];
const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-background-networking",
    "--dns-prefetch-disable",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
  ],
});
const browserCDP = await browser.newBrowserCDPSession();

try {
  for (
    let pair = 0;
    pair < maxBlocks && completeBlocks < runs && !failed.length;
    pair++
  ) {
    const blockStart = receipts.length;
    const modes =
      values.mode === "calibrate"
        ? pair % 2 === 0
          ? [false, true]
          : [true, false]
        : [values.mode === "trace"];
    for (const detailed of modes) {
      const context = await browser.newContext({
        viewport,
        colorScheme: values.theme,
        ...(mobile
          ? {
              deviceScaleFactor: phone.deviceScaleFactor,
              userAgent: phone.userAgent,
              isMobile: phone.isMobile,
              hasTouch: phone.hasTouch,
            }
          : { deviceScaleFactor: 2 }),
        reducedMotion: "no-preference",
        permissions: ["clipboard-read", "clipboard-write"],
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12_000);
      const cdp = await context.newCDPSession(page);
      const effects = await externalEffects(cdp);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => {
        if (response.url().startsWith(site.origin) && response.status() >= 400)
          errors.push(response.status() + " " + response.url());
      });
      try {
        for (const navigation of ["cold", "warm"] as const) {
          const id = `${runId}-${pair}-${detailed ? "trace" : "quiet"}-${navigation}`;
          try {
            receipts.push({
              ...(await attempt(
                page,
                id,
                navigation,
                detailed,
                errors,
                effects,
              )),
              eligible: false,
            });
            if (detailed && navigation === "warm") {
              await page.screenshot({
                path: join(output, id + ".png"),
                timeout: 5_000,
              });
              demos.push({
                attemptId: id,
                evidence: await verifyDemo(page, mobile),
              });
            }
          } catch (error) {
            failed.push({ attemptId: id, error: String(error) });
            break;
          }
        }
      } finally {
        await context.close();
      }
    }
    const block = receipts.slice(blockStart);
    if (
      !failed.length &&
      block.every(
        (row) =>
          row.interference?.passed ??
          row.cpuPressurePercent <= maxCpuPressurePercent,
      )
    ) {
      block.forEach((row) => {
        row.eligible = true;
      });
      completeBlocks++;
    }
  }
} finally {
  await browser.close();
  await site.close();
}

const runner = {
  host: hostname(),
  kernel: release(),
  browser: browser.version(),
  viewport,
  mobile,
  theme: values.theme,
  node: process.version,
  affinity: (await readFile("/proc/self/status", "utf8")).match(
    /^Cpus_allowed_list:\s*(.+)$/m,
  )?.[1],
};
const med = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const middle = Math.floor(xs.length / 2);
  return xs.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const cold = receipts.filter(
  (row) => row.navigation === "cold" && row.eligible,
);
const selected = cold.filter(
  (row) => row.detailed === (values.mode === "trace"),
);
const measuredMs = selected.length
  ? med(selected.map((row) => row.verifiedMs))
  : null;
const probe = createHash("sha256");
for (const source of [
  "homepage.ts",
  "fixture.ts",
  "trace.ts",
  "demo.ts",
  "resources.ts",
  "hosted-guard/interference.ts",
  "../motion/frame-pacing.ts",
])
  probe.update(await readFile(new URL(source, import.meta.url)));
const compatible = {
  scenario: scenario.id,
  probeSha256: probe.digest("hex"),
  runner,
  detailed: values.mode === "trace",
  ...(values["idle-preflight"] && { idlePreflight: true }),
  ...(scope && { hostedInterference }),
};
const references = await Promise.all(
  (values.control ?? []).map(async (path) =>
    JSON.parse(await readFile(path, "utf8")),
  ),
);
for (const reference of references) {
  assert.deepEqual(reference.compatible, compatible, "Incompatible control");
  assert(
    reference.qualified && reference.measuredMs > 0,
    "Control lacks qualified waits",
  );
}
assert(
  new Set(references.map((row) => row.runId)).size === references.length,
  "Repeated control",
);
assert(
  references.every(
    (row) =>
      row.revision === references[0].revision &&
      row.packageSha256 === references[0].packageSha256,
  ),
  "Control builds differ",
);
const controlMs = references.length
  ? references.reduce((sum, row) => sum + row.measuredMs, 0) / references.length
  : measuredMs;
const qualified = !diagnostic && !failed.length && completeBlocks === runs;
const report = {
  runId,
  compatible,
  revision: values.revision,
  mode: values.mode,
  ...(diagnostic && { diagnostic: true }),
  qualified,
  failed,
  packageSha256: site.packageSha256,
  packageBytes: site.packageBytes,
  measuredMs,
  score:
    qualified && measuredMs !== null ? (100 * measuredMs) / controlMs! : null,
  reference: references.length ? references.map((row) => row.runId) : [runId],
  controlMs,
  requestedBlocks: runs,
  maxBlocks,
  completeBlocks,
  probeOverheadMs:
    values.mode === "calibrate" &&
    qualified &&
    cold.filter((row) => row.detailed).length === runs
      ? med(cold.filter((row) => row.detailed).map((row) => row.verifiedMs)) -
        measuredMs!
      : null,
  receipts,
  demos,
};
const path = join(output, runId + ".json");
await writeFile(path, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    ...report,
    receipts: receipts.map(
      ({
        attemptId,
        navigation,
        detailed,
        verifiedMs,
        cpuPressurePercent,
        eligible,
      }) => ({
        attemptId,
        navigation,
        detailed,
        verifiedMs,
        cpuPressurePercent,
        eligible,
      }),
    ),
    receipt: path,
  }),
);
if (diagnostic ? failed.length || receipts.length !== 4 : !qualified)
  process.exitCode = 1;

async function attempt(
  page: Page,
  id: string,
  navigation: "cold" | "warm",
  detailed: boolean,
  errors: string[],
  effects: Awaited<ReturnType<typeof externalEffects>>,
) {
  const errorStart = errors.length;
  if (navigation === "cold") {
    await page.goto(
      site.origin.replace("127.0.0.1", "localhost") + "/robots.txt",
    );
  }
  await page.evaluate(() =>
    navigator.clipboard.writeText("Synthetic previous clipboard"),
  );
  if (detailed && navigation === "warm") {
    await page.evaluate(
      (id) => sessionStorage.setItem("apparent-benchmark-attempt", id),
      id,
    );
  }
  if (detailed && navigation === "cold") {
    await page.addInitScript((coldId) => {
      if (window !== window.top || location.hostname !== "127.0.0.1") return;
      const id = sessionStorage.getItem("apparent-benchmark-attempt") ?? coldId;
      document.addEventListener(
        "click",
        (event) => {
          if (
            event.isTrusted &&
            (event.target as Element).closest(".setup-prompt button")
          )
            performance.mark(id + ":trusted-copy");
        },
        { capture: true, once: true },
      );
    }, id);
  }
  const idle = values["idle-preflight"] ? await idlePreflight() : undefined;
  const observerStart = diagnostic ? await pressureSample() : undefined;
  const tracePath = join(output, id + ".chrome.json");
  const stopTrace = detailed ? await startTrace(browserCDP) : null;
  const resourceStart = await processes(browserCDP);
  const hostedStart = sampleHosted && sampleHosted();
  const pressureStart = await pressure();
  const start = performance.now();
  try {
    const response =
      navigation === "cold"
        ? await page.goto(site.origin + "/", { waitUntil: "domcontentloaded" })
        : await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200);
    const hero = page.getByRole("heading", {
      name: /Tell your coding agent what to change/,
    });
    await hero.waitFor({ state: "visible" });
    const readyMs = await page.evaluate(() => performance.now());
    const copy = page
      .locator(".setup-prompt")
      .getByRole("button", { name: "Copy Prompt", exact: true });
    await copy.click({ timeout: 5_000 });
    await page
      .getByRole("button", { name: "Copied", exact: true })
      .waitFor({ timeout: 5_000 });
    const endpoint = await page.evaluate(
      async ({ expected, id }) => {
        const visibleMs = performance.now();
        const actual = await navigator.clipboard.readText();
        const readbackMs = performance.now();
        if (actual !== expected)
          throw new Error("Clipboard did not contain the setup prompt");
        performance.mark(id + ":clipboard-verified");
        const clickMs = performance.getEntriesByName(id + ":trusted-copy")[0]
          ?.startTime;
        return { visibleMs, readbackMs, clickMs };
      },
      { expected: scenario.expectedPrompt, id },
    );
    const end = performance.now();
    const pressureEnd = await pressure();
    const interference =
      hostedStart &&
      sampleHosted &&
      evaluateInterference(hostedStart, sampleHosted());
    const cpuPressurePercent =
      (100 * (pressureEnd - pressureStart)) / ((end - start) * 1000);
    assert(
      Number.isFinite(cpuPressurePercent),
      "Linux CPU pressure is required",
    );
    const resourceEnd = await processes(browserCDP);
    const pageTiming = await page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming;
      const timing = (entry: PerformanceResourceTiming) => ({
        name: entry.name,
        startMs: entry.startTime,
        fetchMs: entry.fetchStart,
        responseMs: entry.responseStart,
        endMs: entry.responseEnd,
        transferBytes: entry.transferSize,
        encodedBytes: entry.encodedBodySize,
        initiator: entry.initiatorType,
      });
      return {
        document: timing(navigation),
        domInteractive: navigation.domInteractive,
        domContentLoaded: navigation.domContentLoadedEventEnd,
        paints: performance
          .getEntriesByType("paint")
          .map((entry) => ({ name: entry.name, startMs: entry.startTime })),
        resources: (
          performance.getEntriesByType(
            "resource",
          ) as PerformanceResourceTiming[]
        ).map(timing),
      };
    });
    const events = stopTrace ? await stopTrace(tracePath) : [];
    const pressureEvidence = diagnostic && {
      idle,
      observerStart,
      timedStart: { atMs: start, pressureUs: pressureStart },
      timedEnd: { atMs: end, pressureUs: pressureEnd },
      observerEnd: await pressureSample(),
    };
    const spans: Span[] = [
      {
        stage: "navigation to headers",
        startMs: 0,
        endMs: pageTiming.document.responseMs,
      },
      {
        stage: "html response",
        startMs: pageTiming.document.responseMs,
        endMs: pageTiming.document.endMs,
      },
      ...pageTiming.resources
        .filter((row) => row.name.startsWith(site.origin))
        .map((row) => ({
          stage: "resource transfer",
          startMs: row.fetchMs,
          endMs: row.endMs,
        })),
    ];
    if (detailed) {
      assert(endpoint.clickMs !== undefined);
      spans.push(...rendererSpans(events, id, endpoint.clickMs));
      spans.push(
        {
          stage: "input to Copied",
          startMs: endpoint.clickMs,
          endMs: endpoint.visibleMs,
        },
        {
          stage: "clipboard readback",
          startMs: endpoint.visibleMs,
          endMs: endpoint.readbackMs,
        },
      );
      await writeWaterfall(
        join(output, id + ".html"),
        id,
        endpoint.readbackMs,
        spans,
        [
          ...pageTiming.paints,
          { name: "DOMContentLoaded", startMs: pageTiming.domContentLoaded },
          { name: "hero heading visible", startMs: readyMs },
          { name: "trusted click", startMs: endpoint.clickMs },
          { name: "Copied visible", startMs: endpoint.visibleMs },
          { name: "exact clipboard verified", startMs: endpoint.readbackMs },
        ],
      );
    }
    assert.deepEqual(errors.slice(errorStart), []);
    assert.deepEqual(effects.unexpected, []);
    return {
      attemptId: id,
      verified: true,
      navigation,
      detailed,
      verifiedMs: endpoint.readbackMs,
      readyMs,
      ...endpoint,
      pageTiming,
      cpuPressurePercent,
      ...(interference && { interference }),
      chromiumCpuMs: (resourceEnd.cpuSeconds - resourceStart.cpuSeconds) * 1000,
      sampledChromiumPssKiB: resourceEnd.pssKiB,
      hostCommandMs: end - start,
      trace: detailed ? tracePath : null,
      effects: structuredClone(effects),
      spans,
      coverage: account(spans, endpoint.readbackMs),
      ...(pressureEvidence && { pressureEvidence }),
    };
  } catch (error) {
    if (stopTrace) await browserCDP.send("Tracing.end").catch(() => {});
    throw error;
  }
}
