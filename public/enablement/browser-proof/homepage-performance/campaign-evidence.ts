import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Matched } from "../../../../shared/enablement/performance/comparison.ts";
import { hostedInterference } from "./hosted-guard/interference.ts";

const read = async <T>(path: string) =>
  JSON.parse(await readFile(path, "utf8")) as T;

export type Result = {
  navigation: "cold" | "warm";
  detailed: boolean;
  verified: true;
  eligible: boolean;
  verifiedMs: number;
  cpuPressurePercent: number;
  interference?: { passed: boolean };
  chromiumCpuMs: number;
  sampledChromiumPssKiB: number;
  pageTiming: {
    document: { transferBytes: number };
    resources: { name: string; transferBytes: number }[];
  };
};
export type Receipt = {
  compatible: {
    detailed: boolean;
    scenario: string;
    hostedInterference?: string;
    probeSha256: string;
    runner: {
      host: string;
      kernel: string;
      browser: string;
      viewport: { width: number; height: number };
      mobile: boolean;
      theme: string;
      node: string;
      affinity: string;
    };
  };
  mode: "quiet" | "trace" | "calibrate";
  runId: string;
  qualified: boolean;
  revision: string;
  packageSha256: string;
  packageBytes: number;
  receipts: Result[];
  probeOverheadMs: number | null;
  demos: { evidence: { changed?: boolean; mobileSketchVisible?: boolean } }[];
};
export type Effort = { start: string; end: string };
export type Experiment = {
  hypothesis: string;
  effort: Effort[];
  runs: Matched<string>;
  qualityEvidence: string;
};
export type Ledger = {
  controls: [] | [string, string];
  experiments: Experiment[];
  unscoredEffort: Effort[];
  diagnostics?: { evidence: string; reason: string }[];
};
export type HostedLedger = Pick<Ledger, "unscoredEffort" | "diagnostics"> & {
  calibration: string;
  experiments: (Pick<Experiment, "hypothesis" | "effort"> & {
    evidence: string;
  })[];
};
type Gateway = {
  stream: string;
  entry: string;
  run: string;
  attempt: string;
  control: string;
  candidate: string;
  workflowSha: string;
  node: string;
  runnerImage: string;
  after: { cpuPressure: string };
};
type Platform = {
  imageOS: string;
  imageVersion: string;
  node: string;
  runId: string;
  runAttempt: string;
  reviewed: string;
  control: string;
  candidate: string;
  affinity: string;
};

async function hostedJob(
  evidence: string,
  calibration: boolean,
  ledgerDirectory: string,
) {
  const directory = resolve(ledgerDirectory, evidence);
  const publicDirectory = join(directory, "public");
  const [gateway, platform, job] = await Promise.all([
    read<Gateway>(join(directory, "gateway.json")),
    read<Platform>(join(publicDirectory, "platform.json")),
    read<Ledger>(join(publicDirectory, "comparison-ledger.json")),
  ]);
  const sha = /^[0-9a-f]{40}$/;
  const id = gateway.run + "/" + gateway.attempt;
  assert(
    gateway.stream === "public" &&
      gateway.entry ===
        "public/enablement/browser-proof/homepage-performance/hosted.ts" &&
      /^[1-9][0-9]*\/[1-9][0-9]*$/.test(id) &&
      [gateway.control, gateway.candidate, gateway.workflowSha].every((value) =>
        sha.test(value),
      ) &&
      gateway.node === "22.23.0" &&
      /^some .*total=\d+/m.test(gateway.after?.cpuPressure) &&
      gateway.run === platform.runId &&
      gateway.attempt === platform.runAttempt &&
      gateway.control === platform.control &&
      gateway.candidate === platform.candidate &&
      gateway.workflowSha === platform.reviewed &&
      platform.imageOS === "ubuntu24" &&
      platform.node === "v" + gateway.node &&
      gateway.runnerImage &&
      platform.imageVersion === gateway.runnerImage &&
      platform.affinity,
    "Incompatible or incomplete Public hosted job " + evidence,
  );
  assert(
    (gateway.control === gateway.candidate) === calibration &&
      job.controls.length === 2 &&
      job.experiments.length === (calibration ? 0 : 1) &&
      !job.unscoredEffort.length,
    "Unexpected Public hosted bracket " + id,
  );
  function receipt(path: string, label: string) {
    const result = resolve(publicDirectory, path);
    assert.equal(
      dirname(result),
      join(publicDirectory, label),
      "Unexpected hosted receipt path for " + label,
    );
    return result;
  }
  const controls = [
    receipt(job.controls[0], "noise-first"),
    receipt(job.controls[1], "noise-second"),
  ] as const;
  const row = job.experiments[0];
  assert(calibration || (row.runs.length === 4 && !row.effort.length));
  const bracket = row && {
    runs: (["a-first", "b-first", "b-repeat", "a-repeat"] as const).map(
      (label, i) => receipt(row.runs[i], label),
    ) as Matched<string>,
    qualityEvidence: receipt(row.qualityEvidence, "candidate-desktop"),
  };
  return { gateway, platform, controls, bracket };
}
export async function loadHostedEvidence(
  input: HostedLedger,
  directory: string,
) {
  const calibration = await hostedJob(input.calibration, true, directory);
  const hostedExperiments = await Promise.all(
    input.experiments.map(({ evidence }) =>
      hostedJob(evidence, false, directory),
    ),
  );
  const ids = [calibration, ...hostedExperiments].map(
    ({ gateway }) => gateway.run + "/" + gateway.attempt,
  );
  assert.equal(new Set(ids).size, ids.length, "Repeated hosted job");
  const ledger: Ledger = {
    controls: [...calibration.controls],
    unscoredEffort: input.unscoredEffort,
    diagnostics: input.diagnostics,
    experiments: input.experiments.map(({ hypothesis, effort }, i) => {
      const bracket = hostedExperiments[i].bracket;
      assert(bracket);
      return { ...bracket, hypothesis, effort };
    }),
  };
  return { ledger, calibration, hostedExperiments };
}

export function browserContract(compatible: Receipt["compatible"]) {
  const { browser, viewport, mobile, theme, node } = compatible.runner;
  return {
    scenario: compatible.scenario,
    hostedInterference: compatible.hostedInterference,
    probe: compatible.probeSha256,
    browser,
    viewport,
    mobile,
    theme,
    node,
  };
}

export function pressureQualified(receipt: Receipt, result: Result) {
  if (
    !Number.isFinite(result.cpuPressurePercent) ||
    result.cpuPressurePercent < 0
  )
    return false;
  return receipt.compatible.hostedInterference
    ? receipt.compatible.hostedInterference === hostedInterference &&
        result.interference?.passed === true
    : result.cpuPressurePercent <= 2;
}

export async function verifyDemoProof(
  directory: string,
  expected: Receipt,
  mode: "calibrate" | "trace",
  mobile = false,
  namedReceipt?: string,
) {
  const filenames = await readdir(directory);
  const receipts = filenames.filter((name) =>
    /^[a-f0-9-]{36}\.json$/.test(name),
  );
  assert(
    receipts.length === 1 &&
      (!namedReceipt || receipts[0] === basename(namedReceipt)),
    "Missing or ambiguous browser proof " + directory,
  );
  const proof = await read<Receipt>(join(directory, receipts[0]));
  const compatible = {
    ...expected.compatible,
    detailed: mode === "trace",
    runner: mobile
      ? {
          ...expected.compatible.runner,
          viewport: { width: 320, height: 852 },
          mobile: true,
          theme: "dark",
        }
      : expected.compatible.runner,
  };
  assert.deepEqual(proof.compatible, compatible);
  assert(
    proof.qualified &&
      proof.mode === mode &&
      proof.revision === expected.revision &&
      proof.packageSha256 === expected.packageSha256 &&
      proof.demos.length > 0 &&
      proof.demos.every(({ evidence }) =>
        mobile
          ? evidence.mobileSketchVisible === true
          : evidence.changed === true,
      ) &&
      filenames.some((name) => name.endsWith(".html")),
    "Unqualified browser proof " + directory,
  );
  if (mode === "calibrate")
    assert(Number.isFinite(proof.probeOverheadMs), "Missing probe overhead");
  return proof.probeOverheadMs;
}
