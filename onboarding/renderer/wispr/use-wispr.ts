import { useCallback, useRef, useState } from "react";
import type { DictationApp, WisprResult } from "../../host/dictation";
import { confirmationHold } from "./motion";

export type WisprPhase =
  | "checking"
  | "running"
  | "quitting"
  | "dunking"
  | "confirmed"
  | "error"
  | "bypass";
export type WisprRequest = (operation: "read" | "quit") => Promise<WisprResult>;

async function runRequest(
  request: WisprRequest | undefined,
  operation: "read" | "quit",
): Promise<WisprResult> {
  try {
    return (await request?.(operation)) ?? { status: "disabled" };
  } catch {
    return { status: "unknown" };
  }
}

export function useWisprFlow(
  eligible: boolean,
  request: WisprRequest | undefined,
) {
  const [phase, setPhase] = useState<WisprPhase>("checking");
  const [apps, setApps] = useState<readonly DictationApp[]>([]);
  const [unknown, setUnknown] = useState(false);
  const revision = useRef(0);
  const pending = useRef(false);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    const run = ++revision.current;
    pending.current = true;
    setPhase("checking");
    setApps([]);
    const result = await runRequest(request, "read");
    if (run !== revision.current) return;
    pending.current = false;
    const failed = result.status === "unknown" || result.status === "refused";
    setUnknown(failed);
    setApps(result.status === "running" ? result.apps : []);
    setPhase(
      result.status === "running" ? "running" : failed ? "error" : "bypass",
    );
  }, [request]);

  const attach = useCallback(
    (section: HTMLElement | null) => {
      if (!section) return;
      if (eligible) void check();
      else setPhase("checking");
      return () => {
        revision.current++;
        pending.current = false;
        if (hold.current) clearTimeout(hold.current);
      };
    },
    [eligible, check],
  );

  async function quit() {
    if (!eligible || pending.current || !["running", "error"].includes(phase))
      return;
    if (!apps.length) return check();
    pending.current = true;
    const run = revision.current;
    setPhase("quitting");
    const result = await runRequest(request, "quit");
    if (run !== revision.current) return;
    pending.current = false;
    setUnknown(result.status === "unknown");
    setPhase(
      result.status === "closed"
        ? "dunking"
        : result.status === "disabled"
          ? "bypass"
          : "error",
    );
  }

  function skip() {
    revision.current++;
    pending.current = false;
    if (hold.current) clearTimeout(hold.current);
    setPhase("bypass");
  }

  function landed() {
    if (phase !== "dunking") return;
    setPhase("confirmed");
    const run = revision.current;
    hold.current = setTimeout(() => {
      if (run === revision.current) setPhase("bypass");
    }, confirmationHold);
  }

  return {
    visible: eligible && phase !== "bypass",
    phase,
    apps,
    unknown,
    attach,
    quit,
    skip,
    landed,
  };
}
