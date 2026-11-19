import { readFileSync } from "node:fs";
import { inputs, type Table, steps } from "./table.ts";

const nativeTable = new URL(
  "../../../host/traversal/tour-traversal.json",
  import.meta.url,
);

export function nativeTraversal(): string {
  const table: Table = JSON.parse(readFileSync(nativeTable, "utf8"));
  const stepVariants = steps.map((step) => `Step::${step}`);
  const functions = (Object.keys(inputs) as (keyof Table)[]).map((name) => {
    const flags = inputs[name];
    const [result, variants] = {
      visible: ["bool", ["false", "true"]],
      enter: ["Step", stepVariants],
      advance: [
        "Option<Step>",
        [...stepVariants.map((step) => `Some(${step})`), "None"],
      ],
      back: ["Step", stepVariants],
      primary: [
        "Primary",
        ["Primary::Stay", "Primary::Advance", "Primary::Close"],
      ],
      resume_capture: ["Step", stepVariants],
    }[name] as [string, string[]];
    const args = flags.map((flag) => `, ${flag}: bool`).join("");
    const index = flags
      .map((flag, bit) =>
        bit ? `usize::from(${flag}) << ${bit}` : `usize::from(${flag})`,
      )
      .join(" | ");
    const rows = table[name];
    if (rows.length !== steps.length)
      throw Error(`Invalid ${name} table length`);
    const arms = rows.map((row, step) => {
      if (row.length !== 2 ** flags.length || !/^[0-9]+$/.test(row))
        throw Error(`Invalid ${name} table row`);
      const values = [...row].map((value) => {
        const variant = variants[Number(value)];
        if (!variant) throw Error(`Invalid ${name} table value`);
        return variant;
      });
      return `            Step::${steps[step]} => [${values.join(", ")}][index],`;
    });
    return `    pub(super) fn ${name}(step: Step${args}) -> ${result} {
        let index = ${index};
        match step {
${arms.join("\n")}
        }
    }`;
  });
  return `mod traversal {
    use super::Step;

    #[derive(Clone, Copy)]
    pub(super) enum Primary { Stay, Advance, Close }

${functions.join("\n\n")}
}
`;
}
