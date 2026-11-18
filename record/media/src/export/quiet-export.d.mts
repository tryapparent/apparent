export interface Clock {
  $: "Clock";
  hi: number;
  lo: number;
}
export interface BendSpan {
  $: "Span";
  start: Clock;
  end: Clock;
}
export type Spans = { $: "Nil" } | { $: "Con"; head: BendSpan; tail: Spans };

type Unit = { $: "Unit" };
declare const quiet: {
  quiet_parameters(unit: Unit): {
    freeze_db_magnitude: number;
    freeze_ms: number;
    silence_db_magnitude: number;
    silence_ms: number;
  };
  quiet_rate(unit: Unit): number;
  limits_valid(limit: number, rate: number): boolean;
  observations_valid(spans: Spans, duration: Clock, valid: boolean): boolean;
  plan_quiet_export(
    frozen: Spans,
    silent: Spans,
    timeline: Spans,
    offset: Clock,
    limit: number,
  ): Spans;
};
export default quiet;
