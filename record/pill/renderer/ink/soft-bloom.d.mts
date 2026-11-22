declare const policy: {
  freshness_ms(): number;
  bloom(
    held: number,
    magnitude: number,
    fresh: boolean,
  ): {
    $: "Reading";
    level: number;
    active: boolean;
    fresh: boolean;
  };
};
export default policy;
