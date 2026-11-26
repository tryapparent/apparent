type Point = { x: number; y: number };
type Rectangle = Point & { width: number; height: number };
type Display = { workArea: Rectangle; scaleFactor: number };
type Screen = {
  screenToDipPoint: (point: Point) => Point;
  dipToScreenPoint: (point: Point) => Point;
  getDisplayMatching: (bounds: Rectangle) => Display;
  getDisplayNearestPoint: (point: Point) => Display;
};
type NotesWindow = {
  isVisible: () => boolean;
  isDestroyed: () => boolean;
  setBounds: (bounds: Rectangle) => void;
  show: () => void;
  hide: () => void;
  focus: () => void;
  getNativeWindowHandle: () => { readUInt32LE: (offset: number) => number };
  webContents: {
    focus: () => void;
    executeJavaScript: (code: string) => Promise<unknown>;
  };
};
type Snapshot = {
  mode: "editor" | "list";
  position: [number, number];
  badgeRect: [number, number, number, number] | null;
};
type PlaceDropdown = (
  center: number, top: number, bottom: number, width: number, height: number, content: number,
) => Rectangle;
type Surface = { action: "surface"; id: number; rect: number[]; focus: boolean };

const noteContentHeight = `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
  const panel = document.querySelector('.note-list');
  const rows = panel?.querySelector('.note-rows');
  resolve(panel ? Math.ceil(panel.getBoundingClientRect().height +
    (rows ? rows.scrollHeight - rows.clientHeight : 0)) : null);
})))`;

function relative(value: number, origin: number, size: number) {
  return Math.max(0, Math.min(size, Math.round(value - origin)));
}

export function createNotesPlacement(
  popup: NotesWindow,
  screen: Screen,
  platform: string,
  send: (surface: Surface) => void,
  popupBounds: (point: Point, area: Rectangle, height: number) => Rectangle,
  placeDropdown: PlaceDropdown,
) {
  const linux = platform === "linux";
  let revision = 0;
  let requested = "";
  let placed = "";
  let waitingForFocus = false;

  function desktopPoint(x: number, y: number) {
    const point = { x: Math.round(x), y: Math.round(y) };
    return linux ? screen.screenToDipPoint(point) : point;
  }

  function present(bounds: Rectangle) {
    const opening = !popup.isVisible();
    const focus = waitingForFocus;
    waitingForFocus = false;
    const key = JSON.stringify(bounds);
    if (opening || requested !== key) {
      requested = key;
      popup.setBounds(bounds);
    }
    if (opening) popup.show();
    if (focus) {
      popup.focus();
      if (linux) popup.webContents.focus();
    }
    if (linux) {
      const point = screen.dipToScreenPoint({ x: bounds.x, y: bounds.y });
      const scale = screen.getDisplayMatching(bounds).scaleFactor;
      const rect = [point.x, point.y, Math.round(bounds.width * scale), Math.round(bounds.height * scale)];
      const nativeKey = JSON.stringify(rect);
      if (opening || focus || placed !== nativeKey) {
        placed = nativeKey;
        send({ action: "surface", id: popup.getNativeWindowHandle().readUInt32LE(0), rect, focus });
      }
    }
  }

  return {
    async show(state: Snapshot, focus: boolean) {
      const current = ++revision;
      waitingForFocus ||= focus;
      if (state.mode === "editor") {
        const point = desktopPoint(...state.position);
        present(popupBounds(point, screen.getDisplayNearestPoint(point).workArea, 220));
        return;
      }

      const [x, y, width, height] = state.badgeRect ?? [...state.position, 0, 0];
      const top = desktopPoint(x + width / 2, y);
      const bottom = desktopPoint(x + width / 2, y + height);
      const area = screen.getDisplayNearestPoint(top).workArea;
      const measured = await popup.webContents.executeJavaScript(noteContentHeight).catch(() => null);
      if (current !== revision || popup.isDestroyed()) return;

      const content = typeof measured === "number" && measured > 0 ? Math.min(350, measured) : 350;
      const result = placeDropdown(
        relative(top.x, area.x, area.width),
        relative(top.y, area.y, area.height),
        relative(bottom.y, area.y, area.height),
        area.width, area.height, content,
      );
      present({
        x: area.x + result.x,
        y: area.y + result.y,
        width: result.width,
        height: result.height,
      });
    },
    hide() {
      ++revision;
      waitingForFocus = false;
      popup.hide();
    },
  };
}
