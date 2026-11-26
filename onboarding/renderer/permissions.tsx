import "./permissions.css";
import { Button } from "@apparent/ui/button";

export type PermissionRow = {
  permission: string;
  status: string;
  required: boolean;
  reopening: boolean;
  relaunch: boolean;
};
const names: Record<string, string> = {
  "screen-recording": "Screen & System Audio Recording",
  microphone: "Microphone",
  accessibility: "Accessibility",
  "speech-recognition": "Speech Recognition",
  camera: "Camera",
};

export function Permissions({
  platform,
  rows,
  repair,
  action,
}: {
  platform: "linux" | "macos";
  rows: PermissionRow[];
  repair: boolean;
  action: (value: string) => Promise<void>;
}) {
  return (
    <>
      <h1>{repair ? "Allow access." : "We need three things."}</h1>
      <div className="native-permissions">
        {rows.map((row) => {
          const linuxInput =
            platform === "linux" && row.permission === "accessibility";
          const linuxScreen =
            platform === "linux" && row.permission === "screen-recording";
          const checking = row.status === "unavailable";
          const granted = row.status === "granted" && !row.relaunch;
          return (
            <div key={row.permission}>
              <div className="native-permission-description">
                <strong>
                  {linuxInput
                    ? "Input devices"
                    : linuxScreen
                      ? "Screen recording"
                      : names[row.permission]}
                </strong>
                {!repair && !row.required && <small>Optional</small>}
                {platform === "macos" &&
                  row.permission === "screen-recording" &&
                  !granted &&
                  !checking &&
                  !row.reopening &&
                  !row.relaunch && (
                    <small>
                      Turn on apparent in System Settings, or click + to add it.
                    </small>
                  )}
                {linuxInput && !granted && !checking && (
                  <small>
                    To draw and add notes over other apps, run this command in a
                    terminal, then log out and back in. This grants your account
                    access to keyboard and pointer input across all apps.
                  </small>
                )}
                {linuxInput && !granted && !checking && (
                  <code>sudo usermod -aG input "$USER"</code>
                )}
              </div>
              {checking ? (
                <span role="status">Checking access…</span>
              ) : row.reopening ? (
                <span role="status">Reopening apparent…</span>
              ) : granted ? (
                <span className={linuxScreen ? undefined : "native-granted"}>
                  {linuxScreen ? "Asked when recording starts" : "✓ Enabled"}
                </span>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => void action(`grant:${row.permission}`)}
                >
                  {row.relaunch
                    ? "Reopen apparent"
                    : linuxInput
                      ? "Copy command"
                      : "Open Settings"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function PermissionRepairFooter({
  ready,
  action,
}: {
  ready: boolean;
  action: (value: string) => Promise<void>;
}) {
  return (
    <footer data-permission-repair>
      <Button onClick={() => void action("continue")} disabled={!ready}>
        Done
      </Button>
    </footer>
  );
}
