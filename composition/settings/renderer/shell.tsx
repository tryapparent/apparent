import {
  type DetailedHTMLProps,
  type HTMLAttributes,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  AutoPaste,
  type AutoPasteProps,
} from "../../../handoff/settings/auto-paste";
import {
  FrogNudgePreference,
  type FrogNudgePreferenceProps,
} from "../../../onboarding/renderer/frog-nudge/preview";
import { About, type AboutBridge } from "./about";
import availableFrog from "../../../capture/desktop/assets/settings/frog-jump.png";
import currentFrog from "../../../capture/desktop/assets/settings/frog-lounge.png";
import failedFrog from "../../../capture/desktop/assets/settings/frog-puzzled.png";
import { General } from "./general";
import {
  RecordingStartPreference,
  recordingStartPreference,
} from "../../../record/settings/renderer/recording-start";
import type { ComponentType } from "react";
import {
  AgentContextPreference,
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
import { RecordingIndex } from "./recording-index";

const panes = [
  "General",
  "Recording",
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
        autoPasteExperiment?: ComponentType<AutoPasteProps>;
        frogExperiment?: ComponentType<FrogNudgePreferenceProps>;
        agentContextExperiment?: ComponentType<AgentContextPreferenceProps>;
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
    apparentRecording: RecordingBridge;
    apparentPermissions: PermissionBridge;
  }
}

const aboutArtwork = {
  available: availableFrog,
  current: currentFrog,
  failed: failedFrog,
};

const recordStart = recordingStartPreference({
  read: () => window.apparentLabs.read(),
  save: (selected) => window.apparentLabs.save(selected, "screenPicker"),
  subscribe: (listener) => window.apparentLabs.subscribe(listener),
});

function Settings() {
  const [current, setCurrent] = useState(
    () =>
      panes.find((pane) => location.hash === `#${pane.toLowerCase()}`) ??
      "Storage",
  );
  const content = useRef<HTMLElement>(null);
  const destination = useRef<{ pane: Pane; section?: string }>(null);
  const [section, setSection] = useState<string>();
  useLayoutEffect(
    () =>
      window.apparentSettingsRoute?.((pane) => {
        const selected = panes.find((value) => value.toLowerCase() === pane);
        if (selected) {
          setSection(
            destination.current?.pane === selected
              ? destination.current.section
              : undefined,
          );
          destination.current = null;
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
    const root = content.current;
    if (!section || !root) return;

    const focusSection = () => {
      const target =
        document.getElementById(section) ??
        root.querySelector<HTMLElement>("[data-settings-section-fallback]");
      if (!target || !root.contains(target)) return;
      cancel();
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start" });
    };
    function cancel() {
      observer.disconnect();
      setSection(undefined);
    }
    const observer = new MutationObserver(focusSection);
    observer.observe(root, { childList: true, subtree: true });
    focusSection();
    document.addEventListener("keydown", cancel);
    document.addEventListener("pointerdown", cancel);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", cancel);
      document.removeEventListener("pointerdown", cancel);
    };
  }, [current, section]);
  useLayoutEffect(() => {
    void window.apparentSettingsMounted?.().catch(() => {});
  }, []);
  const [error, setError] = useState("");
  const [navigating, setNavigating] = useState(false);
  async function navigate(pane: Pane, section?: string) {
    if (pane === current) {
      setError("");
      setSection(section);
      return;
    }
    destination.current = { pane, section };
    setSection(undefined);
    setNavigating(true);
    try {
      await window.apparent?.navigateSettings(pane.toLowerCase());
    } catch {
      destination.current = null;
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
      </aside>
      <main className="settings-content" ref={content}>
        <header className="settings-page-heading">
          <h1
            id={current === "Permissions" ? "settings-permissions" : undefined}
            tabIndex={current === "Permissions" ? -1 : undefined}
          >
            {current}
          </h1>
          <div id="settings-account" />
        </header>
        {error && <p role="alert">{error}</p>}
        {current === "Labs" && (
          <RecordingStartPreference preference={recordStart} />
        )}
        {current === "Agents" && (
          <Button
            className="settings-task-link settings-agent-delivery"
            variant="link"
            disabled={navigating}
            onClick={() => void navigate("Labs", "agent-t3-label")}
          >
            Send recordings to T3
          </Button>
        )}
        {current === "General" ? (
          <General />
        ) : current === "Recording" ? (
          <>
            <RecordingIndex disabled={navigating} navigate={navigate} />
            <RecordingSection bridge={window.apparentRecording} />
          </>
        ) : current === "Permissions" ? (
          <PermissionsSection bridge={window.apparentPermissions} />
        ) : current === "About" ? (
          <About bridge={window.apparentAbout} artwork={aboutArtwork} />
        ) : (
          <apparent-settings-pane
            pane={current}
            autoPasteExperiment={current === "Labs" ? AutoPaste : undefined}
            agentContextExperiment={AgentContextPreference}
            frogExperiment={
              current === "Labs" ? FrogNudgePreference : undefined
            }
          />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Settings />);
