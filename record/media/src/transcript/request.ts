import { alignTranscript, type TimedText } from "./policy.ts";

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  )
    throw Error("Invalid request");
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value))
    throw Error("Invalid request");
  const result = BigInt(value);
  if (result > 0xffff_ffff_ffff_ffffn) throw Error("Invalid request");
  return result;
}
function times(value: unknown): bigint[] {
  if (!Array.isArray(value)) throw Error("Invalid request");
  return value.map(timestamp);
}
function text(value: unknown): string {
  if (typeof value !== "string") throw Error("Invalid request");
  return value;
}
function units(value: unknown): TimedText[] {
  if (!Array.isArray(value)) throw Error("Invalid request");
  return value.map((item) => {
    const unit = object(item, ["t0", "t1", "text"]);
    return {
      t0: timestamp(unit.t0),
      t1: timestamp(unit.t1),
      text: text(unit.text),
    };
  });
}

export function transcriptRequest(requestJson: string): string {
  const request = object(JSON.parse(requestJson), [
    "version",
    "times",
    "anchors",
    "transcript",
  ]);
  if (request.version !== 1) throw Error("Invalid request");
  const transcript = object(request.transcript, ["text", "words", "segments"]);
  const said = alignTranscript(times(request.times), times(request.anchors), {
    text: text(transcript.text),
    words: units(transcript.words),
    segments: units(transcript.segments),
  });
  const output = JSON.stringify({ version: 1, said });
  return output;
}
