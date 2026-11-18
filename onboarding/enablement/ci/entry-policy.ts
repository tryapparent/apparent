import { launch } from "../../host/entry-policy.ts";

const inputs = [false, true];
const rows = inputs.flatMap((seen) =>
  inputs.flatMap((deferred) =>
    inputs.flatMap((reopeningRepair) =>
      inputs.map((offerTour) => {
        const args = [seen, deferred, reopeningRepair, offerTour];
        const intent = launch(seen, deferred, reopeningRepair, offerTour);
        const variant = intent[0].toUpperCase() + intent.slice(1);
        return `        (${args.join(", ")}) => Launch::${variant},`;
      }),
    ),
  ),
);

process.stdout.write(`fn launch_intent(seen: bool, deferred: bool, reopening_repair: bool, offer_tour: bool) -> Launch {
    match (seen, deferred, reopening_repair, offer_tour) {
${rows.join("\n")}
    }
}
`);
