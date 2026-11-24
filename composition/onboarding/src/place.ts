import { screen, type BrowserWindow } from "electron";
import {
  coachDimensions,
  coachPosition,
  setupDimensions,
  type Rect,
} from "@apparent/onboarding/presentation";
import type { Projection } from "@apparent/onboarding/projection";
import { removeCompositorBorder } from "./hyprland.ts";
function nativeRectangle(rect: Rect | undefined): Rect | undefined {
  if (!rect) return rect;
  const start = screen.screenToDipPoint({
    x: Math.round(rect[0]),
    y: Math.round(rect[1]),
  });
  const end = screen.screenToDipPoint({
    x: Math.round(rect[0] + rect[2]),
    y: Math.round(rect[1] + rect[3]),
  });
  return [
    start.x,
    start.y,
    Math.max(1, end.x - start.x),
    Math.max(1, end.y - start.y),
  ];
}
export class Placement {
  private lastPlacement = "";
  private lastMode = "";
  private borderReady = false;
  private borderPending = false;
  private borderAttempts = 0;
  constructor(private window: BrowserWindow) {}
  present(value: Projection, activate = false) {
    const window = this.window;
    if (window.isDestroyed()) return;
    if (
      value.step === "try-it" &&
      value.practice === "screen" &&
      value.platform === "macos"
    ) {
      window.webContents.send("onboarding:state", value);
      window.hide();
      return;
    }
    if (
      value.step === "try-it" &&
      (value.practice === "preparing" || value.practiceBoard)
    ) {
      window.hide();
      return;
    }
    let v =
      process.platform === "linux"
        ? {
            ...value,
            anchor: nativeRectangle(value.anchor),
            practiceBoard: nativeRectangle(value.practiceBoard),
          }
        : value;
    const coach =
      v.step === "try-it" && v.practice !== null && v.practice !== "start";
    const focal = v.practiceBoard || v.anchor;
    const target = focal
      ? screen.getDisplayMatching({
          x: Math.round(focal[0]),
          y: Math.round(focal[1]),
          width: Math.max(1, Math.round(focal[2])),
          height: Math.max(1, Math.round(focal[3])),
        })
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = target.workArea;
    const shortcut = v.step === "shortcut" || (v.step === "try-it" && !coach);
    const { width, height } = coach
      ? coachDimensions(area, v.practice!)
      : setupDimensions(area, shortcut);
    const mode = `${coach}:${width}:${height}`;
    if (this.lastMode !== mode) {
      window.setAlwaysOnTop(coach, "floating");
      window.setHasShadow(!coach);
      window.setMaximumSize(0, 0);
      window.setMinimumSize(width, height);
      window.setMaximumSize(width, height);
      window.setSize(width, height, false);
      window.setVisibleOnAllWorkspaces(coach, {
        visibleOnFullScreen: coach,
      });
      this.lastMode = mode;
      this.lastPlacement = "";
    }
    if (coach) {
      const placement = coachPosition(
        area,
        v.anchor,
        v.practiceBoard,
        v.practice!,
      );
      const key = JSON.stringify([v.practice, v.anchor, v.practiceBoard, area]);
      if (key !== this.lastPlacement) {
        window.setPosition(placement.x, placement.y, false);
        this.lastPlacement = key;
      }
      const actual = window.getBounds();
      v = {
        ...v,
        coachArrow: placement.arrow,
        coachPointsUp:
          placement.pointsUp &&
          actual.x === placement.x &&
          actual.y === placement.y,
      };
    } else {
      const key = JSON.stringify(["setup", height, area]);
      if (key !== this.lastPlacement) {
        window.setPosition(
          area.x + Math.max(0, Math.round((area.width - width) / 2)),
          area.y + Math.max(0, Math.round((area.height - height) / 2)),
          false,
        );
        this.lastPlacement = key;
      }
    }
    window.webContents.send("onboarding:state", v);
    if (!window.isVisible() || activate) {
      if (coach) window.showInactive();
      else window.show();
    }
    if (!this.borderReady && !this.borderPending && this.borderAttempts < 8) {
      this.borderPending = true;
      this.borderAttempts++;
      void removeCompositorBorder(process.pid, window.getTitle())
        .then(
          () => {
            this.borderReady = true;
          },
          () => {},
        )
        .finally(() => {
          this.borderPending = false;
        });
    }
  }
}
