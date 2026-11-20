import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@apparent/ui/button";
import { Input } from "@apparent/ui/input";
import { NativeSelect, NativeSelectOption } from "@apparent/ui/native-select";
import { Switch } from "@apparent/ui/switch";
import type {
  Choice,
  RecordingBridge,
  RecordingChange,
  RecordingState,
} from "../recording-contract";
import { RecordingLevelFeed } from "./recording-feed";
import policy from "../recording-policy.mjs";

function Options({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: Choice[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="recording-row">
      <label htmlFor={id}>{label}</label>
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) =>
          option.title ? (
            <NativeSelectOption
              key={option.id}
              value={option.id}
              disabled={!option.enabled}
            >
              {option.title}
            </NativeSelectOption>
          ) : (
            <hr key={option.id} />
          ),
        )}
      </NativeSelect>
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  busy,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  busy: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="recording-row">
      <span id={id}>{label}</span>
      <Switch
        className="recording-switch"
        aria-labelledby={id}
        checked={checked}
        disabled={disabled}
        aria-busy={busy || undefined}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function Group({
  title,
  sectionId,
  children,
}: {
  title: string;
  sectionId?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const id = sectionId ?? generatedId;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} tabIndex={sectionId ? -1 : undefined}>
        {title}
      </h2>
      {children}
    </section>
  );
}

const localeNames = new Intl.DisplayNames(undefined, { type: "language" });
function localeName(locale: string) {
  try {
    return localeNames.of(locale.replaceAll("_", "-")) ?? locale;
  } catch {
    return locale;
  }
}

function maximalLocale(locale: string) {
  try {
    return new Intl.Locale(locale.replaceAll("_", "-")).maximize().baseName;
  } catch {
    return locale;
  }
}

function appleLanguages(saved: string, speech: RecordingState["speech"]) {
  const system = localeNames.resolvedOptions().locale;
  const effective = speech.locale || system;
  const supported = (speech.locales ?? [])
    .map((id) => ({ id, title: localeName(id), enabled: true }))
    .sort((left, right) =>
      left.title.localeCompare(right.title, undefined, { numeric: true }),
    );
  const options = [
    {
      id: "auto",
      title: `Automatic (${localeName(saved === "auto" ? effective : system)})`,
      enabled: true,
    },
    ...supported,
  ];
  if (saved === "auto") return { options, selected: "auto" };
  const match = supported.find(
    (option) => maximalLocale(option.id) === maximalLocale(saved),
  );
  if (match) return { options, selected: match.id };
  const unknown = supported.length === 0;
  const name = localeName(saved);
  options.push({
    id: saved,
    title: unknown ? name : `${name} (not available)`,
    enabled: unknown,
  });
  return {
    options,
    selected: saved,
    note: unknown
      ? undefined
      : `${name} isn’t available on this Mac. Using ${localeName(effective)}.`,
  };
}

function speechNote(
  platform: RecordingState["platform"],
  speech: RecordingState["speech"],
) {
  const percent = Math.round(Math.min(1, Math.max(0, speech.progress)) * 100);
  if (speech.state === "downloading")
    return `Downloading the speech model… ${percent}%`;
  if (platform === "linux") {
    if (speech.state === "failed")
      return `The speech model couldn’t be downloaded${speech.error ? ` (${speech.error})` : ""}. Apparent tries again in a few minutes.`;
    return;
  }
  switch (speech.state) {
    case "checking":
      return "Checking for the speech model…";
    case "unavailable":
      return `No Apple speech model for ${speech.locale ? localeName(speech.locale) : "your language"} on this Mac.`;
    case "needsPermission":
      return (
        speech.error ??
        "Speech Recognition isn’t allowed yet, so captures have no transcript."
      );
    case "failed":
      return (
        (speech.engine === "SFSpeechRecognizer" && speech.error) ||
        "The speech model didn’t download. Apparent will try again."
      );
  }
}

function Level({ bridge }: { bridge: RecordingBridge }) {
  const [feed] = useState(() => new RecordingLevelFeed(bridge));
  const level = useSyncExternalStore(feed.subscribe, feed.snapshot);
  return (
    <div className="recording-row">
      <span>Input level</span>
      <div
        role="meter"
        aria-label="Input level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        className="recording-level"
      >
        <div style={{ width: `${level * 100}%` }} />
      </div>
    </div>
  );
}

function HexLanguage({
  value,
  pending,
  save,
}: {
  value: string;
  pending: boolean;
  save: (value: string) => void;
}) {
  const id = useId();
  const [edit, setEdit] = useState({ saved: value, draft: value });
  const draft = edit.saved === value ? edit.draft : value;
  const normalized = draft.trim().toLowerCase();
  const valid = normalized === "" || /^[a-z][a-z0-9-]{0,34}$/.test(normalized);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !pending && (normalized || "en") !== value)
          save(normalized);
      }}
      className="recording-language"
    >
      <div className="recording-row">
        <label htmlFor={id}>Hex language</label>
        <div>
          <Input
            id={id}
            placeholder="en"
            value={draft}
            disabled={pending}
            aria-invalid={!valid}
            aria-describedby={`${id}-help`}
            onChange={(event) =>
              setEdit({ saved: value, draft: event.currentTarget.value })
            }
          />
          <Button
            type="submit"
            variant="outline"
            disabled={!valid || pending || (normalized || "en") === value}
          >
            Apply
          </Button>
        </div>
      </div>
      <p id={`${id}-help`} className="recording-note">
        {valid
          ? "Use a language code such as en, nl or auto. Some Hex models ignore this preference."
          : "Enter a language code of up to 35 letters, digits or hyphens, starting with a letter."}
      </p>
    </form>
  );
}

function MacVolume({
  value,
  disabled,
  save,
}: {
  value: number;
  disabled: boolean;
  save: (value: number) => void;
}) {
  const id = useId();
  const [edit, setEdit] = useState({ saved: value, draft: value });
  const draft = edit.saved === value ? edit.draft : value;
  const commit = (event: { currentTarget: HTMLInputElement }) => {
    const next = event.currentTarget.valueAsNumber;
    if (next !== value) save(next);
  };
  return (
    <div className="recording-row">
      <label htmlFor={id}>Lower to</label>
      <div className="recording-range">
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          value={draft}
          disabled={disabled}
          aria-valuetext={`${draft}%`}
          onChange={(event) =>
            setEdit({ saved: value, draft: event.currentTarget.valueAsNumber })
          }
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <output htmlFor={id}>{draft}%</output>
      </div>
    </div>
  );
}

const playbackChoices = [0, 10, 20, 35, 50, 75, 100];

export function RecordingControls({
  state,
  bridge,
  pending,
  save,
  openGuide,
}: {
  state: RecordingState;
  bridge: RecordingBridge;
  pending: RecordingChange | undefined;
  save: (change: RecordingChange) => void;
  openGuide: () => void;
}) {
  const { microphone, transcriber, speech } = state;
  const mac = state.platform === "macos";
  const local = mac ? "Apple Speech" : "Parakeet";
  const hex = transcriber.engine === "hex";
  const apple = transcriber.engine === "apple";
  const engines = [
    { id: "apple", title: local, enabled: true },
    { id: "hex", title: transcriber.hexTitle, enabled: transcriber.hexEnabled },
  ];
  if (transcriber.command)
    engines.push({
      id: "command",
      title: `Command (${transcriber.command})`,
      enabled: true,
    });
  const detail = policy.transcription_detail(
    transcriber.engine === "command",
    hex,
    transcriber.hexEnabled,
  );
  const note =
    detail === 2
      ? `Command runs transcribeCommand from config.json. If it fails, that recording uses ${local}.`
      : detail === 1
        ? `${local} times each word. Hex uses a model you have in Hex, and its word times are estimates.`
        : mac
          ? "Apple Speech runs on this Mac and times each word. Hex shows up here while Hex is running."
          : "Parakeet runs on this computer and times each word. Apparent downloads its 730 MB model once, unless Hex already has it. Hex shows up here while Hex is running.";
  const languages =
    mac && apple ? appleLanguages(transcriber.appleLocale, speech) : undefined;
  const speechStatus = apple ? speechNote(state.platform, speech) : undefined;
  const disabled = !!pending;
  const chosenModel =
    transcriber.models.find((model) => model.chosen)?.id ?? "";
  const playback = state.playbackLevel;
  const levels = [...new Set([...playbackChoices, playback])]
    .sort((a, b) => a - b)
    .map((level) => ({ id: String(level), title: `${level}%`, enabled: true }));
  const levelDisabled =
    disabled ||
    !policy.volume_level_enabled(state.playbackAvailable, state.lowerPlayback);
  return (
    <>
      <Group title="Microphone">
        <div className="recording-group">
          <Options
            label="Input"
            value={microphone.selected}
            options={
              microphone.options.some(
                (option) => option.id === microphone.selected,
              )
                ? microphone.options
                : [
                    ...microphone.options,
                    {
                      id: microphone.selected,
                      title: microphone.value,
                      enabled: false,
                    },
                  ]
            }
            disabled={disabled}
            onChange={(value) => save({ key: "microphone", value })}
          />
          {microphone.meter && <Level key={microphone.meter} bridge={bridge} />}
        </div>
        {microphone.note && (
          <p className="recording-note" role="status">
            {microphone.note}
          </p>
        )}
        {!mac && (
          <p className="recording-note">
            If the chosen input cannot open, recording uses the system default.
            The level shows input only.
          </p>
        )}
      </Group>
      <Group title="Transcription" sectionId="recording-transcription">
        <div className="recording-group">
          <Options
            label="Transcription engine"
            options={engines}
            value={transcriber.engine}
            disabled={disabled}
            onChange={(value) => save({ key: "transcriber", value })}
          />
          {languages && (
            <Options
              label="Language"
              options={languages.options}
              value={languages.selected}
              disabled={disabled}
              onChange={(value) => save({ key: "appleLocale", value })}
            />
          )}
          {hex && transcriber.models.length > 0 && (
            <Options
              label="Hex model"
              options={[
                { id: "", title: "Choose", enabled: false },
                ...transcriber.models.map((model) => ({
                  ...model,
                  enabled: true,
                })),
              ]}
              value={chosenModel}
              disabled={disabled}
              onChange={(value) => save({ key: "hexModel", value })}
            />
          )}
          {hex && mac && (
            <HexLanguage
              value={transcriber.language}
              pending={disabled}
              save={(value) => save({ key: "hexLanguage", value })}
            />
          )}
        </div>
        <p className="recording-note">{note}</p>
        {languages?.note && <p className="recording-note">{languages.note}</p>}
        {!mac && (
          <p className="recording-note">
            Apparent’s default Parakeet model supports English. For another
            language, configure a local transcribeCommand and select Command. If
            Command or Hex fails, this recording uses local Parakeet.
          </p>
        )}
        {speechStatus && (
          <p className="recording-note" role="status">
            {speechStatus}
          </p>
        )}
        {state.mediaWarnings.map((warning) => (
          <p className="recording-note" role="status" key={warning}>
            {warning}
          </p>
        ))}
      </Group>
      <Group title="Other-app volume">
        <p className="recording-note">
          Temporarily lower other apps’ playback volume while recording.
        </p>
        {!mac && (
          <>
            <p className="recording-note">
              On Linux, install audio support and enable the experiment first.
              Apparent doesn’t measure the resulting volume.
            </p>
            <Button
              variant="link"
              className="recording-guide"
              onClick={openGuide}
            >
              Set up and test volume lowering
            </Button>
          </>
        )}
        <div className="recording-group">
          <Toggle
            label="Lower volume while recording"
            checked={state.lowerPlayback}
            disabled={
              disabled ||
              !policy.volume_switch_enabled(
                state.playbackAvailable,
                state.lowerPlayback,
              )
            }
            busy={pending?.key === "lowerPlayback"}
            onChange={(value) => save({ key: "lowerPlayback", value })}
          />
          {mac ? (
            <MacVolume
              value={playback}
              disabled={levelDisabled}
              save={(value) => save({ key: "playbackLevel", value })}
            />
          ) : (
            <Options
              label="Lower to"
              options={levels}
              value={String(playback)}
              disabled={levelDisabled}
              onChange={(value) =>
                save({ key: "playbackLevel", value: Number(value) })
              }
            />
          )}
        </div>
      </Group>
      <Group title="Export" sectionId="recording-video-export">
        <div className="recording-group">
          <Toggle
            label="Video export"
            checked={state.videoExport}
            disabled={disabled}
            busy={pending?.key === "videoExport"}
            onChange={(value) => save({ key: "videoExport", value })}
          />
        </div>
        <p className="recording-note">
          Experimental. Adds Export Last Capture as Video… to the menu.
        </p>
      </Group>
    </>
  );
}
