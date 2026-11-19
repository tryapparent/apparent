import { editSource } from "./mac-edit-source.ts";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureContext } from "./contracts.ts";

export function prepareMacFixtures(
  { directory, make, sources, digest }: FixtureContext,
  gap: string,
) {
  const explicitEdit = join(directory, "explicit-edit.mov");
  const combinedEdit = join(directory, "packet-and-explicit-edit.mov");
  if (process.platform === "darwin") {
    const clean = join(directory, "edit-source.m4a");
    make(clean, [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000:duration=2",
      "-c:a",
      "aac",
    ]);
    const producerSource = join(directory, "edit-fixtures.swift"),
      producer = join(directory, "edit-fixtures");
    writeFileSync(producerSource, editSource, { mode: 0o600 });
    execFileSync(
      "swiftc",
      [
        "-swift-version",
        "5",
        "-parse-as-library",
        producerSource,
        "-o",
        producer,
      ],
      { stdio: "inherit", timeout: 60_000 },
    );
    execFileSync(producer, [clean, gap, explicitEdit, combinedEdit], {
      stdio: "inherit",
      timeout: 20_000,
    });
    sources.set(explicitEdit, digest(explicitEdit));
    sources.set(combinedEdit, digest(combinedEdit));
  }
  return { explicitEdit, combinedEdit };
}
