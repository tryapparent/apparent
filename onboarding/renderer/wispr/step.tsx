import { Button } from "@apparent/ui/button";
import type { ReactNode } from "react";
import type { DictationApp } from "../../host/dictation";
import type { useWisprFlow } from "./use-wispr";
import "./wispr.css";

const appNames: Record<DictationApp, string> = {
  wisprFlow: "Wispr Flow",
  superwhisper: "Superwhisper",
};

function focusHeading(heading: HTMLHeadingElement | null) {
  heading?.focus();
}

export function WisprStep({
  flow,
  children,
}: {
  flow: ReturnType<typeof useWisprFlow>;
  children: ReactNode;
}) {
  const success = flow.phase === "dunking" || flow.phase === "confirmed";
  const error = flow.phase === "error";
  const waiting = flow.phase === "checking" || flow.phase === "quitting";
  const multiple = flow.apps.length > 1;
  const names = flow.apps.map((app) => appNames[app]).join(" and ");
  const shortName = flow.apps[0] === "wisprFlow" ? "Wispr" : names;
  let title = "Check for shortcut conflicts";
  let detail = "Checking for dictation apps…";
  if (flow.phase === "running") {
    title = multiple ? "Dictation apps are open" : `${shortName}, take five.`;
    detail = `${names} may use the same shortcut as Apparent.`;
  }
  if (flow.phase === "quitting") {
    title = multiple ? "Dictation apps are open" : `${shortName}, take five.`;
    detail = `Waiting for ${names} to close.`;
  }
  if (success) {
    title = "All yours.";
    detail = `${names} ${multiple ? "have" : "has"} quit.`;
  }
  if (error) {
    title = flow.unknown
      ? names
        ? "Couldn’t confirm the apps closed."
        : "Couldn’t check dictation apps."
      : multiple
        ? "At least one app is still open."
        : `${shortName} is still open.`;
    detail =
      flow.unknown && !names
        ? "Try checking again or continue to shortcut setup."
        : "Finish any dictation, then try again.";
  }
  return (
    <div className="native-wispr" aria-busy={waiting}>
      {children}
      <h1 ref={focusHeading} tabIndex={-1}>
        {title}
      </h1>
      <p role={error ? "alert" : "status"}>{detail}</p>
      <div className="native-wispr-actions">
        <Button disabled={waiting || success} onClick={() => void flow.quit()}>
          {error
            ? "Try again"
            : multiple
              ? "Quit both apps"
              : names
                ? `Quit ${names}`
                : "Checking…"}
        </Button>
        <Button
          variant="ghost"
          disabled={flow.phase === "quitting"}
          onClick={flow.skip}
        >
          {success
            ? flow.phase === "confirmed"
              ? "Continue"
              : "Skip animation"
            : error
              ? "Continue anyway"
              : multiple
                ? "Keep both open"
                : names
                  ? "Keep it open"
                  : "Continue anyway"}
        </Button>
      </div>
    </div>
  );
}
