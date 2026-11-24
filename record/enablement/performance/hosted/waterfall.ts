import { writeFileSync } from "node:fs";

type Row = { name: string; fromMs: number; toMs: number };
type Attempt = { label: string; rows: Row[] };
const escape = (name: string) =>
  name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function waterfall(
  path: string,
  title: string,
  clock: string,
  attempts: Attempt[],
) {
  const sections = attempts
    .map(({ label, rows }, index) => {
      const span = Math.max(...rows.map((row) => row.toMs), 1);
      const bars = rows
        .map(
          ({ name, fromMs, toMs }) =>
            "<tr><td>" +
            escape(name) +
            '</td><td class="track"><i style="left:' +
            (100 * fromMs) / span +
            "%;width:" +
            (100 * (toMs - fromMs)) / span +
            '%"></i></td><td>' +
            fromMs.toFixed(1) +
            "–" +
            toMs.toFixed(1) +
            " ms</td></tr>",
        )
        .join("");
      return (
        "<details" +
        (index === 0 ? " open" : "") +
        "><summary>" +
        escape(label) +
        "</summary><table><thead><tr><th>Operation</th><th>Elapsed</th><th>Range</th></tr></thead><tbody>" +
        bars +
        "</tbody></table></details>"
      );
    })
    .join("");
  writeFileSync(
    path,
    `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><style>
body{font:14px system-ui,sans-serif}details{margin:12px 0}summary{cursor:pointer}
table{border-collapse:collapse;width:100%;max-width:960px}th,td{text-align:left;padding:4px}
.track{position:relative;width:55%;background:#c2d0dc;height:16px}
.track i{position:absolute;top:3px;height:10px;min-width:1px;background:#2465a3}
</style><h1>${escape(title)}</h1><p>${escape(clock)}</p>${sections}</html>`,
    { mode: 0o600 },
  );
}
