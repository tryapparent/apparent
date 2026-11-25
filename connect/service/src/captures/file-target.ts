import uploadTargetPolicy from "#bend/upload-target";
import { FILE_FORMAT } from "../../../client/typescript/contracts.ts";
import { fail, stmt, supportCapture } from "../common.ts";
import type { CaptureRow, Env, ManifestFile } from "../types.ts";
import { live } from "./history.ts";

export const supportPath = /^support\/part-[0-5]\.age$/;

export function validPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length <= 128 &&
    /^(apparent\.json|notes\.json|summary\.md|contact-sheet(?:-full)?\.png|audio\.wav|recording\.(mp4|mov)|finish-trace\.json|timeline\.json|frames(?:-full)?\/frame-[0-9]+\.png)$/.test(
      path,
    )
  );
}

export function transportPath(
  path: unknown,
  format: CaptureRow["format"],
  grouped = false,
): path is string {
  if (format === "plaintext-v1") return validPath(path);
  if (format === FILE_FORMAT)
    return (
      typeof path === "string" &&
      (path === "envelope.json" ||
        /^sealed\/(index|file-[0-9]{6})\.age$/.test(path))
    );
  if (typeof path !== "string") return false;
  return grouped
    ? /^(evidence|media)\/(envelope\.json|sealed\/part-[0-9]{6}\.age)$/.test(
        path,
      )
    : /^(envelope\.json|sealed\/part-[0-9]{6}\.age)$/.test(path);
}

export function groupedDelivery(capture: CaptureRow) {
  return (
    capture.format === "apparent-encrypted-v1" &&
    (JSON.parse(capture.manifest) as ManifestFile[]).some(
      (file) => file.path === "evidence/envelope.json",
    )
  );
}

export function allowedPath(
  path: string,
  capture: CaptureRow,
  support: boolean,
) {
  return (
    path !== "" &&
    (support
      ? supportPath.test(path)
      : transportPath(path, capture.format, groupedDelivery(capture)))
  );
}

export function decodeFilePath(encoded: string) {
  try {
    const segments = encoded.split("/").map(decodeURIComponent);
    return segments.some(
      (segment) => segment.includes("/") || segment.includes("\\"),
    )
      ? ""
      : segments.join("/");
  } catch {
    return "";
  }
}

export async function uploadTarget(
  env: Env,
  id: string,
  account: string,
  support: boolean,
  path: string,
) {
  const row = await stmt(
    env,
    `SELECT captures.*, files.size AS upload_size, files.sha256 AS upload_sha256, files.object_key AS upload_key
    FROM captures LEFT JOIN files ON files.capture_id=captures.id AND files.path=?
    WHERE captures.id=? AND account_id=? AND (${supportCapture})=? AND ${live}`,
    path,
    id,
    account,
    Number(support),
    Date.now(),
    Date.now(),
  ).first<
    CaptureRow & {
      upload_size: number | null;
      upload_sha256: string | null;
      upload_key: string | null;
    }
  >();
  if (!row) fail("not_found", 404);
  const {
    upload_size: size,
    upload_sha256: sha256,
    upload_key: object_key,
    ...capture
  } = row;
  const file =
    size === null || sha256 === null
      ? null
      : { capture_id: id, path, size, sha256, object_key };
  const problem = uploadTargetPolicy.problem(
    allowedPath(path, capture, support),
    file !== null,
  );
  if (problem === "invalid_path") fail(problem);
  if (problem === "not_found" || !file) fail("not_found", 404);
  return { capture, file };
}
