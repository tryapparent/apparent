const lipflowRevision = "3aac76ca8d505f663aec60ca20841e2b6202bf6e";
const uvVersion = "0.12.13";

export type LipArtifact = { url: string; sha256: string; limit: number };
const mib = 1024 * 1024;
const vsr = "https://huggingface.co/Amanvir/LRS3_V_WER19.1/resolve/c0b413f56b164565865a63f00774ee55a9738cc5";
const lm = "https://huggingface.co/Amanvir/lm_en_subword/resolve/f4e39b6d0904b2a900c53a2fff0377796c797bdc";

export const source: LipArtifact = {
  url: `https://codeload.github.com/amywork777/lipflow/tar.gz/${lipflowRevision}`,
  sha256: "ef0c38a000f59dd9b4046c61cab95cd353baeb23212eb66101ac77a769748098",
  limit: 16 * mib,
};

export const weights: ReadonlyArray<readonly [string, LipArtifact]> = [
  ["vsr/model.json", { url: `${vsr}/model.json`, sha256: "e062e8c58579f54cb51087e639e674781189809905db4162efe0fe1325356d4f", limit: mib }],
  ["vsr/model.pth", { url: `${vsr}/model.pth`, sha256: "e740cef369abeabd0ba2c18e37a0661342e1d94d432d6caa77755a11821d8fe3", limit: 1024 * mib }],
  ["lm/model.json", { url: `${lm}/model.json`, sha256: "6e2d2004e4066af3e5a3d74c53b0d648fd53904da07178671d1cbe28a206d548", limit: mib }],
  ["lm/model.pth", { url: `${lm}/model.pth`, sha256: "c75aa39020dec98f432c8689b145d3f4cc407d4daa90a0c64202386c34f83c18", limit: 256 * mib }],
  ["face_landmarker.task", { url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff", limit: 16 * mib }],
];

const runtimes: Readonly<Record<string, string>> = {
  "x86_64-unknown-linux-gnu": "745765a3b6e360ad76743599ae5c42e9278c7edf8bbff9fc76d05bf2623a04dd",
  "aarch64-apple-darwin": "7e6ddb9316acc00f2296c82ff4d99977870ee34b2f0ddcae9444d714db9364ed",
  "x86_64-apple-darwin": "5e287ef61cb6a9b61b3a83fef124fd143e400468a7dac794230147a810e17119",
};

export function uvArtifact(platform: string, arch: string): LipArtifact | undefined {
  const cpu = { x64: "x86_64", arm64: "aarch64" }[arch];
  const system = { darwin: "apple-darwin", linux: "unknown-linux-gnu" }[platform];
  const target = `${cpu}-${system}`;
  const sha256 = runtimes[target];
  if (!sha256) return;
  return { url: `https://github.com/astral-sh/uv/releases/download/${uvVersion}/uv-${target}.tar.gz`, sha256, limit: 64 * mib };
}
