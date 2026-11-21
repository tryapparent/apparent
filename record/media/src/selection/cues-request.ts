import { speechCues } from "./cues.ts";

export function speechCueRequest(requestJson: string): string {
  const request: unknown = JSON.parse(requestJson);
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).sort().join(",") !== "estimated,version,words"
  )
    throw Error("Invalid input");
  const { version, estimated, words } = request as Record<string, unknown>;
  if (
    version !== 1 ||
    typeof estimated !== "boolean" ||
    !Array.isArray(words) ||
    words.some((word) => typeof word !== "string")
  )
    throw Error("Invalid input");
  const output = JSON.stringify({
    version: 1,
    cues: speechCues(estimated, words),
  });
  return output;
}
