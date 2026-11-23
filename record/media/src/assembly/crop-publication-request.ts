type Kind = "Full" | "Focus" | "Activity" | "Window" | "Windows" | "Fallback";

type List<T> = { $: "Nil" } | { $: "Con"; head: T; tail: List<T> };

type Candidate = {
  $: "Candidate";
  kind: { $: `Crop${Kind}` };
  apps: List<string>;
};

type Publication =
  | { $: "Uncropped" }
  | { $: "Cropped"; label: string; regions: List<boolean> };

function cropList<T>(values: T[]): List<T> {
  return values.reduceRight<List<T>>(
    (tail, head) => ({ $: "Con", head, tail }),
    { $: "Nil" },
  );
}

export function cropPublicationRequest(
  publish: (candidates: List<Candidate>) => Publication,
) {
  return (request: string): string => {
    const rows: [Lowercase<Kind>, string[]][] = JSON.parse(request);
    const result = publish(
      cropList(
        rows.map(([kind, apps]) => ({
          $: "Candidate",
          kind: {
            $: ("Crop" +
              kind[0].toUpperCase() +
              kind.slice(1)) as `Crop${Kind}`,
          },
          apps: cropList(apps),
        })),
      ),
    );
    if (result.$ === "Uncropped") return "null";
    const regions = [];
    for (let rest = result.regions; rest.$ === "Con"; rest = rest.tail)
      regions.push(rest.head);
    return JSON.stringify({ label: result.label, regions });
  };
}
