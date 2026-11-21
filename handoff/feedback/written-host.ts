import policy from "../pure/written-report.mjs";
import type { WrittenResult } from "./contract.ts";

type Send = (input: { description: string; id: string }) => Promise<WrittenResult>;

export function writtenReportHost(send: Send) {
  let sending = false;
  return async (description: unknown, id: unknown): Promise<WrittenResult> => {
    if (typeof description !== "string" || typeof id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id) ||
      !policy.admit_written_report(Boolean(description.trim()), !description.includes("\0"), Buffer.byteLength(description)))
      return "invalid";
    if (sending) return "unconfirmed";
    sending = true;
    try {
      return await send({ description, id });
    } catch {
      return "unconfirmed";
    } finally {
      sending = false;
    }
  };
}
