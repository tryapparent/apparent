import assert from "node:assert/strict";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

export const width = 640;
export const screenHeight = 320;
export const height = 96;
export const top = 25;
export const bytesPerFrame = width * height * 3;
const stride = width * 4;

type Frame = {
  at: number;
  marker: { x: number; y: number } | null;
  bytes?: Buffer;
};

function pixelOffset(fd: number) {
  const header = Buffer.alloc(100);
  assert.equal(readSync(fd, header, 0, header.length, 0), header.length);
  const value = (index: number) => header.readUInt32BE(index * 4);
  const expected = [
    [1, 7],
    [2, 2],
    [3, 24],
    [4, width],
    [5, screenHeight],
    [6, 0],
    [7, 0],
    [11, 32],
    [12, stride],
    [13, 4],
    [14, 0xff0000],
    [15, 0xff00],
    [16, 0xff],
  ];
  assert.ok(
    expected.every(([index, field]) => value(index) === field),
    "Unexpected Xvfb XWD pixel format",
  );
  const headerSize = value(0);
  const colours = value(19);
  const info = fstatSync(fd);
  assert.ok(headerSize >= header.length && colours <= 256 && info.isFile());
  const start = headerSize + colours * 12;
  assert.ok(
    info.size >= start + screenHeight * stride,
    "Truncated Xvfb framebuffer",
  );
  return start + top * stride;
}

function observedFrame(pixels: Buffer): Frame {
  const at = performance.now();
  let red = 0;
  let x = 0;
  let y = 0;
  for (let row = 17; row < height - 15; row++) {
    for (let column = 120; column < width - 120; column++) {
      const offset = row * stride + column * 4;
      const r = pixels[offset + 2];
      if (r > 115 && r > pixels[offset + 1] + 30 && r > pixels[offset] + 20) {
        red++;
        x += column;
        y += row;
      }
    }
  }
  if (red < 12) return { at, marker: null };
  const bytes = Buffer.allocUnsafe(bytesPerFrame);
  for (let i = 0, pixel = 0; i < bytes.length; i += 3, pixel += 4) {
    bytes[i] = pixels[pixel + 2];
    bytes[i + 1] = pixels[pixel + 1];
    bytes[i + 2] = pixels[pixel];
  }
  return {
    at,
    bytes,
    marker: { x: Math.round(x / red), y: top + Math.round(y / red) },
  };
}

export function watchDisplay(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let offset: number;
  try {
    offset = pixelOffset(fd);
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  const frames: Frame[] = [];
  const pixels = Buffer.allocUnsafe(height * stride);
  let failure: unknown;
  const timer = setInterval(() => {
    try {
      assert.equal(
        readSync(fd, pixels, 0, pixels.length, offset),
        pixels.length,
      );
      frames.push(observedFrame(pixels));
      if (frames.length > 24) frames.shift();
    } catch (error) {
      failure = error;
      clearInterval(timer);
    }
  }, 1000 / 60);
  return {
    frames,
    get failure() {
      return failure;
    },
    close() {
      clearInterval(timer);
      closeSync(fd);
    },
  };
}
