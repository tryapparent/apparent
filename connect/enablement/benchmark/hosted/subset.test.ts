import assert from "node:assert/strict";
import test from "node:test";
import { quietResources } from "../watch-sample.ts";
import { completeSubsets } from "./subset.ts";

test("selects complete noncontiguous sibling sets and refuses partial cores", () => {
  const topology = [
    { cpu: 0, siblings: "0,2" },
    { cpu: 1, siblings: "1,3" },
    { cpu: 2, siblings: "0,2" },
    { cpu: 3, siblings: "1,3" },
  ];
  assert.deepEqual(completeSubsets(topology), [
    [0, 2],
    [1, 3],
  ]);
  assert.throws(() => completeSubsets(topology.slice(0, 3)));
});

test("outside CPU and I/O wait retain their independent 5% bounds", () => {
  assert.equal(
    quietResources({ externalCpuPercent: 5, peakHostWaitPercent: 5 }),
    true,
  );
  assert.equal(
    quietResources({ externalCpuPercent: 5.01, peakHostWaitPercent: 0 }),
    false,
  );
  assert.equal(
    quietResources({ externalCpuPercent: 0, peakHostWaitPercent: 5.01 }),
    false,
  );
});
