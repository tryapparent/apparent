import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import policy from "./caption-admission.mjs";

export const filename = "openrouter-transcription.json";
const model = "microsoft/mai-transcribe-2";
const maxAudio = 16 * 1024 * 1024;
const maxResponse = 6 * 1024 * 1024;

type Credential = { key: string; enabled: boolean; model: string };
type Action = {
  action: string;
  key?: unknown;
  model?: unknown;
  enabled?: unknown;
};
type Trace = {
  outcome: string;
  requestMs?: number;
  httpStatus?: number;
  audioBytes?: number;
  audioMs?: number;
  words?: number;
  providerAudioSeconds?: number;
  costUsd?: number;
};
type Timed = { t0: number; t1: number; text: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9_-]{16,256}$/.test(key);
}

export function readCredential(configPath: string): Credential | undefined {
  let file: number;
  try {
    file = openSync(
      join(dirname(configPath), filename),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (record(error).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const stat = fstatSync(file);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > 1024
    ) {
      throw Error("Private credential unavailable");
    }
    const value = record(JSON.parse(readFileSync(file, "utf8")));
    if (
      validKey(value.key) &&
      typeof value.enabled === "boolean" &&
      typeof value.model === "string" &&
      policy.openrouter_model_allowed(value.model)
    ) {
      return { key: value.key, enabled: value.enabled, model: value.model };
    }
    throw Error("Invalid stored credential");
  } finally {
    closeSync(file);
  }
}

function publish(configPath: string, credential: Credential) {
  const directory = dirname(configPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${filename}.${randomUUID()}`);
  const file = openSync(temporary, "wx", 0o600);
  try {
    try {
      writeFileSync(file, JSON.stringify(credential));
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    renameSync(temporary, join(directory, filename));
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (record(error).code !== "ENOENT") throw error;
    }
  }
}

export function settings(configPath: string, input: unknown) {
  const request = record(input) as Action;
  if (request.action === "remove") {
    try {
      unlinkSync(join(dirname(configPath), filename));
    } catch (error) {
      if (record(error).code !== "ENOENT") throw error;
    }
  } else if (request.action === "save" && validKey(request.key)) {
    const previous = readCredential(configPath);
    publish(configPath, {
      key: request.key,
      enabled: previous?.enabled ?? false,
      model: previous?.model ?? model,
    });
  } else if (
    request.action === "choose" &&
    typeof request.model === "string" &&
    policy.openrouter_model_allowed(request.model) &&
    typeof request.enabled === "boolean"
  ) {
    const previous = readCredential(configPath);
    if (!previous) throw Error("Save a key first");
    publish(configPath, {
      key: previous.key,
      enabled: request.enabled,
      model: request.model,
    });
  } else if (request.action !== "read") {
    throw Error("Invalid OpenRouter preference");
  }
  const saved = readCredential(configPath);
  return {
    saved: Boolean(saved),
    enabled: saved?.enabled ?? false,
    model: saved?.model ?? model,
  };
}

export function openRouterAction(config: string | undefined, args: unknown[]) {
  if (!config || args.length !== 1)
    throw Error("OpenRouter preference unavailable");
  try {
    return settings(config, args[0]);
  } catch {
    throw Error("OpenRouter preference could not be updated");
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw Error("Missing response");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxResponse) {
      void reader.cancel().catch(() => {});
      throw Error("Oversized response");
    }
    parts.push(value);
  }
  return JSON.parse(Buffer.concat(parts, bytes).toString("utf8"));
}

function timings(
  value: unknown,
  key: "text" | "word",
  duration: number,
): Timed[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const part = record(entry);
    const text = part[key];
    if (
      typeof part.start !== "number" ||
      typeof part.end !== "number" ||
      !Number.isFinite(part.start) ||
      !Number.isFinite(part.end) ||
      part.start < 0 ||
      part.end < part.start ||
      part.start * 1000 >= duration ||
      typeof text !== "string" ||
      !text.trim()
    )
      return [];
    return [
      {
        t0: Math.round(part.start * 1000),
        t1: Math.min(duration, Math.round(part.end * 1000)),
        text,
      },
    ];
  });
}

export async function transcribe(
  credential: Credential | undefined,
  readAudio: () => Buffer,
  audioMs: number,
  request: typeof fetch = fetch,
) {
  if (
    !credential ||
    !policy.openrouter_allowed(credential.enabled, credential.model)
  )
    return {};
  const trace: Trace = { outcome: "audio_unavailable", audioMs };
  let audio: Buffer;
  try {
    audio = readAudio();
  } catch {
    return { trace };
  }
  trace.audioBytes = audio.byteLength;
  if (audio.byteLength > maxAudio)
    return { trace: { ...trace, outcome: "audio_limit" } };
  const start = performance.now();
  const deadline = AbortSignal.timeout(15_000);
  try {
    const response = await request(
      "https://openrouter.ai/api/v1/audio/transcriptions",
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${credential.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: credential.model,
          input_audio: { format: "wav", data: audio.toString("base64") },
          response_format: "verbose_json",
          timestamp_granularities: ["word"],
        }),
        signal: deadline,
      },
    );
    trace.httpStatus = response.status;
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      trace.outcome = "http_error";
      return { trace };
    }
    const result = record(await boundedJson(response));
    const usage = record(result.usage);
    if (
      typeof usage.seconds === "number" &&
      Number.isFinite(usage.seconds) &&
      usage.seconds >= 0
    ) {
      trace.providerAudioSeconds = usage.seconds;
    }
    if (
      typeof usage.cost === "number" &&
      Number.isFinite(usage.cost) &&
      usage.cost >= 0
    ) {
      trace.costUsd = usage.cost;
    }
    if (typeof result.text !== "string" || result.text.length > 512_000)
      throw Error("Invalid transcript");
    const text = result.text.trim();
    const words = timings(result.words, "word", audioMs);
    const segments = timings(result.segments, "text", audioMs);
    if (text && !words.length) throw Error("Missing word timings");
    trace.words = words.length;
    trace.outcome = "success";
    return {
      trace,
      transcript: {
        source: "openrouter",
        model: credential.model,
        text,
        words,
        segments,
      },
    };
  } catch {
    trace.outcome = deadline.aborted
      ? "timeout"
      : trace.httpStatus
        ? "invalid_response"
        : "network_error";
    return { trace };
  } finally {
    trace.requestMs = Math.round(performance.now() - start);
  }
}

if (typeof require === "function" && require.main === module) {
  const [configPath, duration] = process.argv.slice(2);
  void (async () => {
    let credential: Credential | undefined;
    try {
      credential = readCredential(configPath);
    } catch {
      process.stdout.write(
        JSON.stringify({ trace: { outcome: "credential_unavailable" } }),
      );
      return;
    }
    const result = await transcribe(
      credential,
      () => readFileSync(0),
      Number(duration),
    );
    process.stdout.write(JSON.stringify(result));
  })().catch(() => {
    process.exitCode = 1;
  });
}
