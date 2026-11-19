import assert from "node:assert/strict";
const path = ["moov", "trak", "mdia", "minf", "stbl", "stsd"];
function find(bytes: Buffer, kind: string) {
  for (let at = 0; at < bytes.length; ) {
    assert(at + 8 <= bytes.length);
    const size = bytes.readUInt32BE(at);
    assert(
      size >= 8 && at + size <= bytes.length,
      "expected bounded 32-bit fixture boxes",
    );
    if (bytes.toString("ascii", at + 4, at + 8) === kind) return { at, size };
    at += size;
  }
  throw Error("Missing producer fixture box: " + kind);
}
export function description(bytes: Buffer): Buffer {
  for (const kind of path) {
    const { at, size } = find(bytes, kind);
    bytes = bytes.subarray(at + 8, at + size);
  }
  assert.equal(bytes.readUInt32BE(4), 1);
  const size = bytes.readUInt32BE(8);
  assert.equal(8 + size, bytes.length);
  return Buffer.from(bytes.subarray(8));
}
export function appendDescription(movie: Buffer, entry: Buffer): Buffer {
  const moov = find(movie, "moov"),
    mdat = find(movie, "mdat");
  assert(moov.at > mdat.at + mdat.size - 1);
  function rewrite(bytes: Buffer, depth: number): Buffer {
    const { at, size } = find(bytes, path[depth]);
    const original = bytes.subarray(at, at + size);
    let payload: Buffer;
    if (depth === path.length - 1) {
      payload = Buffer.concat([original.subarray(8), entry]);
      assert.equal(payload.readUInt32BE(4), 1);
      payload.writeUInt32BE(2, 4);
    } else payload = rewrite(original.subarray(8), depth + 1);
    const header = Buffer.from(original.subarray(0, 8));
    header.writeUInt32BE(8 + payload.length, 0);
    return Buffer.concat([
      bytes.subarray(0, at),
      header,
      payload,
      bytes.subarray(at + size),
    ]);
  }
  return rewrite(movie, 0);
}
