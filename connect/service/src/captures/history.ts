import policy from "#bend/style-history";
import listPolicy from "#bend/recording-list";
import { FILE_FORMAT } from "../../../client/typescript/contracts.ts";
import {
  bearer,
  DAY,
  fail,
  json,
  separateReportQuota,
  stmt,
  supportCapture,
} from "../common.ts";
import type { CaptureRow, Env } from "../types.ts";

export const live =
  "status!='deleted' AND expires_at>? AND (status='ready' OR pending_until>?)";

async function recordingTimeAvailable(env: Env): Promise<boolean> {
  return !!(await stmt(
    env,
    "SELECT 1 FROM sqlite_schema WHERE type='index' AND name='captures_recorded'",
  ).first());
}

export async function privateReservation(
  env: Env,
  values: (string | number | null)[],
  support: boolean,
  requested: boolean,
  account: string,
  now: number,
  bytes: number,
) {
  const hasTime = values[7] !== null && (await recordingTimeAvailable(env));
  const insert =
    "INSERT INTO captures(id,account_id,manifest,bytes,expires_at,pending_until,format" +
    (hasTime ? ",recorded_at" : "");
  const parameters = hasTime ? "?,?,?,?,?,?,?,?" : "?,?,?,?,?,?,?";
  const args = hasTime ? values : values.slice(0, 7);
  if (support)
    return stmt(
      env,
      insert +
        `) SELECT ${parameters} WHERE (SELECT COALESCE(sum(bytes),0) FROM captures WHERE account_id=? AND (NOT ${separateReportQuota} OR ${supportCapture}) AND ${live})<=?`,
      ...args,
      account,
      now,
      now,
      500000000 - bytes,
    );
  return policy.available(requested, true, values[6] === FILE_FORMAT)
    ? stmt(env, insert + `,style_history) VALUES(${parameters},1)`, ...args)
    : stmt(env, insert + `) VALUES(${parameters})`, ...args);
}

export function recordingTime(value: unknown): number | null {
  if (value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    !listPolicy.valid_recording_day(Math.floor(value / DAY))
  ) {
    fail("invalid_recorded_at");
  }
  return value;
}

export async function listCaptures(request: Request, env: Env, url: URL) {
  const account = await bearer(request, env);
  const rawLimit = url.searchParams.get("limit") ?? "10";
  if (
    !/^\d{1,2}$/.test(rawLimit) ||
    !listPolicy.valid_limit(Number(rawLimit))
  ) {
    fail("invalid_limit");
  }
  const now = Date.now();
  const recordedColumn = (await recordingTimeAvailable(env))
    ? "recorded_at"
    : "NULL AS recorded_at";
  const rows = await stmt(
    env,
    `SELECT id, ${recordedColumn}, status FROM captures
    WHERE account_id=? AND NOT ${supportCapture} AND ${live}
    ORDER BY recorded_at DESC, reservation_seq DESC LIMIT ?`,
    account.account_id,
    now,
    now,
    Number(rawLimit),
  ).all<Pick<CaptureRow, "id" | "recorded_at" | "status">>();
  return json({
    captures: rows.results.map((capture) => ({
      id: capture.id,
      recordedAt:
        capture.recorded_at === null
          ? null
          : new Date(capture.recorded_at).toISOString(),
      ageSeconds:
        capture.recorded_at === null
          ? null
          : Math.max(0, Math.floor((now - capture.recorded_at) / 1000)),
      status: capture.status,
    })),
  });
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
