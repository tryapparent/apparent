import assert from "node:assert/strict";
import { verifyCaptureAdmission } from "../../../../capture-request/test/admission-cases.ts";
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
}
