import {
  type DetailedHTMLProps,
  type HTMLAttributes,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { AutoPaste } from "../../../handoff/settings/auto-paste";
import type { AutoPasteBridge } from "../../../handoff/settings/auto-paste-host";
import { T3Settings } from "../../../handoff/settings/t3";
import { BugReport } from "../../../handoff/feedback/report-dialog";
import type { FeedbackBridge } from "../../../handoff/feedback/contract";
import {
  FrogNudgePreference,
  type FrogNudgePreferenceProps,
} from "../../../onboarding/renderer/frog-nudge/preview";
import { DesktopFrogWithWardrobe } from "./labs/frog-wardrobe";
import { VideoTracing } from "../../../agent/settings/video-tracing";
import { SpeakingStyle } from "../../../agent/settings/speaking-style";
import { OpenRouterExperiment } from "../../../record/settings/renderer/openrouter-experiment";
import { About, type AboutBridge } from "./about";
import availableFrog from "../../../capture/desktop/assets/settings/frog-jump.png";
import currentFrog from "../../../capture/desktop/assets/settings/frog-lounge.png";
import failedFrog from "../../../capture/desktop/assets/settings/frog-puzzled.png";
import { General } from "./general";
import { ConnectCard, useConnectSettings } from "./connect";
import type { ComponentType } from "react";
import {
  AgentContextPreference,
  PushToTalk,
  type PushToTalkProps,
  RecordingSection,
  type AgentContextPreferenceProps,
} from "../../../record/settings/renderer/recording-section";
import { PermissionsSection } from "../../../record/settings/permissions/permissions-section";
import type { PermissionBridge } from "../../../record/settings/permissions/permissions-contract";
import type { RecordingBridge } from "../../../record/settings/recording-contract";
import "./base.css";
import "./settings.css";
import wordmark from "../../../shared/assets/brand/apparent-wordmark.svg";
import { Button } from "@apparent/ui/button";
import { DisclosureMenu } from "@apparent/ui/disclosure-menu";

const panes = [
  "General",
  "Recording",
  "Handoff",
  "Storage",
  "Permissions",
  "Agents",
  "Labs",
  "About",
] as const;
type Pane = (typeof panes)[number];
const icons = [
  <>
    <path d="M12 8v8M8 12h8" />
    <circle cx="12" cy="12" r="9" />
  </>,
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
  </>,
  <path d="M4 12h14m-5-5 5 5-5 5" />,
  <>
    <path d="m5 4-3 9v7h20v-7l-3-9ZM2 13h20M6 17h.01M10 17h.01" />
  </>,
  <>
    <path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6ZM8 12l3 3 5-6" />
  </>,
  <>
    <path d="m4 5 6 6-6 6M13 19h7" />
  </>,
  <>
    <path d="M9 3h6M10 3v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 14h8" />
  </>,
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7h.01" />
  </>,
];

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "apparent-settings-pane": DetailedHTMLProps<
        HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        pane: string;
        experiments?: {
          pushToTalkExperiment?: ComponentType<PushToTalkProps>;
          openRouterExperiment?: typeof OpenRouterExperiment;
          speakingStyleExperiment?: typeof SpeakingStyle;
          videoTracingExperiment?: typeof VideoTracing;
          desktopFrogExperiment?: typeof DesktopFrogWithWardrobe;
          frogExperiment?: ComponentType<FrogNudgePreferenceProps>;
          agentContextExperiment?: ComponentType<AgentContextPreferenceProps>;
        };
      };
    }
  }
}

declare global {
  interface Window {
    apparentSettingsMounted?: () => Promise<void>;
    apparentSettingsHasInsetTitlebar?: boolean;
  }
  interface Window {
    apparentSettingsRoute?: (callback: (pane: string) => void) => () => void;
  }
}

declare global {
  interface Window {
    apparentAbout: AboutBridge;
    apparentFeedback?: FeedbackBridge;
    apparentRecording: RecordingBridge;
    apparentHandoff: AutoPasteBridge;
    apparentPermissions: PermissionBridge;
  }
}

const aboutArtwork = {
  available: availableFrog,
  current: currentFrog,
  failed: failedFrog,
};

function Settings() {
  const [aboutActions, setAboutActions] = useState<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState(
    () =>
      panes.find((pane) => location.hash === `#${pane.toLowerCase()}`) ??
      "Storage",
  );
  const content = useRef<HTMLElement>(null);
  const connect = useConnectSettings(current === "General");
  useLayoutEffect(
    () =>
      window.apparentSettingsRoute?.((pane) => {
        const selected = panes.find((value) => value.toLowerCase() === pane);
        if (selected) {
          setCurrent(selected);
          setError("");
        }
      }),
    [],
  );
  useLayoutEffect(() => {
    document.title = `Apparent Settings — ${current}`;
    content.current?.scrollTo(0, 0);
  }, [current]);
  useLayoutEffect(() => {
    void window.apparentSettingsMounted?.().catch(() => {});
  }, []);
  const [error, setError] = useState("");
  const [navigating, setNavigating] = useState(false);
  async function navigate(pane: Pane) {
    setNavigating(true);
    try {
      await window.apparent?.navigateSettings(pane.toLowerCase());
    } catch {
      setError("Unable to open that Settings page. Please try again.");
    } finally {
      setNavigating(false);
    }
  }
  function pageButton(pane: Pane, index: number, close?: () => void) {
    return (
      <Button
        variant="ghost"
        key={pane}
        type="button"
        disabled={navigating}
        aria-current={pane === current ? "page" : undefined}
        onClick={() => {
          close?.();
          if (pane === current) content.current?.scrollTo(0, 0);
          else void navigate(pane);
        }}
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icons[index]}
        </svg>
        {pane}
      </Button>
    );
  }
  return (
    <div
      className={`settings-shell${current === "General" ? " settings-general-shell" : ""}`}
      data-inset-titlebar={window.apparentSettingsHasInsetTitlebar || undefined}
    >
      <aside className="settings-sidebar" aria-label="Settings pages">
        <div className="settings-brand">
          <img src={wordmark} alt="Apparent" />
        </div>
        <nav className="settings-navigation-wide">
          {panes.map((pane, index) => pageButton(pane, index))}
        </nav>
        <nav
          className="settings-navigation-compact"
          aria-label="Settings pages"
        >
          <DisclosureMenu
            label={`Settings pages, ${current}`}
            trigger={current}
          >
            {(close) =>
              panes.map((pane, index) => pageButton(pane, index, close))
            }
          </DisclosureMenu>
        </nav>
        <BugReport bridge={window.apparentFeedback} frog={availableFrog} />
      </aside>
      <main className="settings-content" ref={content}>
        <header
          className="settings-page-heading"
          data-about={current === "About" || undefined}
        >
          <h1>{current}</h1>
          {current === "About" && (
            <div
              className="settings-about-heading-actions"
              ref={setAboutActions}
            />
          )}
          <div id="settings-account" />
        </header>
        {error && <p role="alert">{error}</p>}
        {current === "General" ? (
          <General connect={<ConnectCard flow={connect} />} />
        ) : current === "Recording" ? (
          <RecordingSection bridge={window.apparentRecording} />
        ) : current === "Handoff" ? (
          <AutoPaste bridge={window.apparentHandoff} />
        ) : current === "Permissions" ? (
          <PermissionsSection bridge={window.apparentPermissions} />
        ) : current === "About" ? (
          <About
            bridge={window.apparentAbout}
            artwork={aboutArtwork}
            headingActions={aboutActions}
          />
        ) : (
          <apparent-settings-pane
            pane={current}
            experiments={
              current === "Labs"
                ? {
                    speakingStyleExperiment: SpeakingStyle,
                    videoTracingExperiment: VideoTracing,
                    pushToTalkExperiment: PushToTalk,
                    openRouterExperiment: OpenRouterExperiment,
                    agentContextExperiment: AgentContextPreference,
                    desktopFrogExperiment: DesktopFrogWithWardrobe,
                    frogExperiment: FrogNudgePreference,
                  }
                : undefined
            }
          />
        )}
        {current === "Agents" && (
          <T3Settings bridge={window.apparentAgents} artwork={failedFrog} />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Settings />);
