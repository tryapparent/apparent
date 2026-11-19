type Probe = { $: "Found" | "Failed"; index: number } | { $: "Missing" };
type Probes = { $: "End" } | { $: "Next"; probe: Probe; tail: Probes };
type Route =
  | { $: "Use" | "Report"; index: number }
  | { $: "Retry" | "Unavailable" };

declare const policy: { reader_route(probes: Probes, canWait: boolean): Route };
export type { Probe, Probes };
export default policy;
