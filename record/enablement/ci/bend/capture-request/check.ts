import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { verifyCaptureAdmission } from "../../../../capture-request/test/admission-cases.ts";
import {
  buildCaptureRequestPackage,
  packageRoot,
} from "../../capture-request/build.ts";
import {
  buildCaptureAdmission,
  captureAdmission,
} from "./capture-admission.ts";

export async function checkCaptureAdmission(proofOutput: string) {
  const captureRequests = await buildCaptureAdmission();
  assert.deepEqual(captureAdmission(proofOutput), captureRequests);
  verifyCaptureAdmission(captureRequests);
  console.log(
    "Record capture-request production and proof tables agree on Start, Stop and Cancel",
  );
  checkCaptureRequestPackage();
}

function checkCaptureRequestPackage() {
  buildCaptureRequestPackage();
  for (const args of [["run", "typecheck"], ["test"]])
    execFileSync("npm", args, { cwd: packageRoot, stdio: "inherit" });
}

if (import.meta.main) checkCaptureRequestPackage();
