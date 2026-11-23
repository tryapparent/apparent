import policy from "#bend/style-history";
import { FILE_FORMAT } from "../../../client/typescript/contracts.ts";
import {
  fail,
  json,
  separateReportQuota,
  stmt,
  supportCapture,
} from "../common.ts";
import type { CaptureRow, Env } from "../types.ts";

export function privateReservation(
  env: Env,
  values: (string | number)[],
  support: boolean,
  requested: boolean,
  account: string,
  now: number,
  bytes: number,
  live: string,
) {
  const insert =
    "INSERT INTO captures(id,account_id,manifest,bytes,expires_at,pending_until,format";
  if (support)
    return stmt(
      env,
      insert +
        `) SELECT ?,?,?,?,?,?,? WHERE (SELECT COALESCE(sum(bytes),0) FROM captures WHERE account_id=? AND (NOT ${separateReportQuota} OR ${supportCapture}) AND ${live})<=?`,
      ...values,
      account,
      now,
      now,
      500000000 - bytes,
    );
  return policy.available(requested, true, values[6] === FILE_FORMAT)
    ? stmt(env, insert + ",style_history) VALUES(?,?,?,?,?,?,?,1)", ...values)
    : stmt(env, insert + ") VALUES(?,?,?,?,?,?,?)", ...values);
}

export async function styleHistory(
  env: Env,
  capture: CaptureRow,
  support: boolean,
  owned: () => Promise<CaptureRow>,
) {
  if (
    support ||
    !policy.available(
      capture.style_history === 1,
      capture.status === "ready",
      capture.format === FILE_FORMAT,
    )
  )
    fail("not_found", 404);
  const rows = await stmt(
    env,
    "SELECT id FROM captures WHERE account_id=? AND reservation_seq<? AND format=? AND status='ready' AND expires_at>? ORDER BY reservation_seq DESC LIMIT ?",
    capture.account_id,
    capture.reservation_seq,
    FILE_FORMAT,
    Date.now(),
    policy.scan_limit(),
  ).all<{ id: string }>();
  await owned();
  return json({
    ids: rows.results.map((row) => row.id),
    tokenBudget: policy.token_budget(),
  });
}
