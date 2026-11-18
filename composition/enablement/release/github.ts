import { execFileSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { repository } from "./manifest.ts";

export const gh = (args: string[]) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
export function api<T>(path: string, method = "GET", body?: unknown): T {
  return JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        `repos/${repository}/${path}`,
        "--method",
        method,
        ...(body === undefined ? [] : ["--input", "-"]),
      ],
      {
        encoding: "utf8",
        input: body === undefined ? undefined : JSON.stringify(body),
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    ),
  );
}
export function optional<T>(path: string): T | null {
  try {
    return api<T>(path);
  } catch (error) {
    if (/\(HTTP 404\)/.test(String((error as { stderr?: Buffer }).stderr)))
      return null;
    throw error;
  }
}
export function pages<T>(path: string, key?: string): T[] {
  const all: T[] = [];
  for (let page = 1; page <= 100; page++) {
    const data = api<Record<string, T[]> & T[]>(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    const entries = key ? data[key] : data;
    if (!Array.isArray(entries)) throw Error("Invalid paginated response");
    all.push(...entries);
    if (entries.length < 100) return all;
  }
  throw Error("Incomplete GitHub history");
}
export function download(path: string, output: string): void {
  const fd = openSync(output, "wx", 0o600);
  try {
    execFileSync("gh", ["api", `repos/${repository}/${path}`], {
      stdio: ["ignore", fd, "pipe"],
      timeout: 300_000,
    });
  } finally {
    closeSync(fd);
  }
}

export type Asset = {
  name: string;
  digest: string;
  size: number;
  state: string;
};
export type Release = {
  id: number;
  draft: boolean;
  prerelease: boolean;
  tag_name: string;
  target_commitish: string;
  body: string;
  assets: Asset[];
};
export type Run = {
  id: number;
  repository: { full_name: string };
  head_repository: { full_name: string };
  path: string;
  head_branch: string;
  head_sha: string;
  display_title?: string;
  actor?: { login: string };
  event: string;
  run_attempt: number;
  status: string;
  conclusion: string | null;
};
export type Job = {
  name: string;
  run_attempt: number;
  status: string;
  conclusion: string | null;
  id?: number;
  runner_id?: number | null;
  created_at?: string;
  completed_at?: string;
  steps?: { name: string; started_at?: string }[];
  labels?: string[];
};
export type Artifact = {
  id: number;
  name: string;
  expired: boolean;
  digest: string;
  workflow_run: { id: number; head_sha: string };
};
export type Ref = { object: { type: string; sha: string } };
