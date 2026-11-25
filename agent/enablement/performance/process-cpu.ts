import assert from "node:assert/strict";

declare const Bun: {
  spawnSync(command: string[]): {
    exitCode: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
    resourceUsage: { cpuTime: { total: bigint } };
  };
};

const [binary, bundle] = process.argv.slice(2);
const samples = Array.from({ length: 7 }, () => {
  const child = Bun.spawnSync([binary, "inspect", bundle]);
  assert.equal(child.exitCode, 0, Buffer.from(child.stderr).toString());
  return {
    cpuMs: Number(child.resourceUsage.cpuTime.total) / 1000,
    stdout: Buffer.from(child.stdout).toString(),
  };
});
console.log(JSON.stringify(samples));
