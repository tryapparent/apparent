import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function matchesSavedClipboard(
  text: string,
  bundle: string,
  transcript: string | undefined,
  requiresBundle: boolean,
) {
  const inspect = "apparent inspect '" + bundle.replaceAll("'", "'\\''") + "'";
  const words = transcript?.trim();
  return (
    text.split("\n").includes(inspect) ||
    (!requiresBundle && !!words && text === words)
  );
}

export async function clipboardProof(
  bundle: string,
  text: string,
  requiresBundle: boolean,
) {
  const manifest = JSON.parse(
    await readFile(join(bundle, "apparent.json"), "utf8"),
  );
  if (
    !matchesSavedClipboard(
      text,
      bundle,
      manifest.transcript?.text,
      requiresBundle,
    )
  )
    throw Error("Clipboard did not match the owned capture " + bundle);
  return JSON.stringify({
    actualInk: manifest.strokes?.length ?? 0,
    durationMs: manifest.durationMs,
    keyframes: manifest.keyframes?.length ?? 0,
  });
}
