// Desktop presentation only. Events arrive after the Engine Store admits a
// request; failed writes never transition the editor away from recoverable text.
export type Event =
  | { kind: 'open'; pin: number; position: [number, number] }
  | { kind: 'edit'; pin: number }
  | { kind: 'list' | 'save' | 'delete' | 'dismiss' | 'outside' }
  | { kind: 'embedded'; value: boolean }
  | { kind: 'badge'; rect: [number, number, number, number] };
export type Presentation = {
  mode: 'badge' | 'editor' | 'list'; current: number | null;
  position: [number, number]; badgeRect: [number, number, number, number] | null;
  embedded: boolean; focusRevision: number;
};
export type Note = { pin: number; t: number; x: number; y: number; text: string };
export type StoreSnapshot = { events: Event[]; notes: Note[]; drafts: Note[]; error: string | null };
export function projectSnapshot(state: Presentation, snapshot: StoreSnapshot) {
  if (!validEvents(snapshot.events)) throw Error('Invalid notes presentation events');
  return { ...snapshot.events.reduce(transition, state), notes: snapshot.notes,
    drafts: snapshot.drafts, error: snapshot.error };
}
export function initialPresentation(position: [number, number]): Presentation {
  return { mode: 'badge', current: null, position, badgeRect: null, embedded: false, focusRevision: 0 };
}
export function transition(state: Presentation, event: Event): Presentation {
  switch (event.kind) {
    case 'open': return { ...state, mode: 'editor', current: event.pin, position: event.position, focusRevision: state.focusRevision + 1 };
    case 'edit': return { ...state, mode: 'editor', current: event.pin, focusRevision: state.focusRevision + 1 };
    case 'list': {
      const rect = state.embedded && state.badgeRect;
      return { ...state, mode: 'list', position: rect ? [rect[0] + rect[2], rect[1] + rect[3]] : state.position,
        focusRevision: state.focusRevision + 1 };
    }
    case 'save': case 'dismiss': case 'outside': return { ...state, mode: 'badge' };
    case 'delete': return { ...state, mode: 'list' };
    case 'embedded': return { ...state, embedded: event.value };
    case 'badge': return { ...state, badgeRect: event.rect };
  }
}
export function validEvents(value: unknown): value is Event[] {
  const tuple = (v: unknown, length: number) => Array.isArray(v) && v.length === length && v.every(Number.isFinite);
  return Array.isArray(value) && value.length <= 1024 && value.every(e => {
    if (!e || typeof e !== 'object') return false;
    const keys = Object.keys(e).sort().join(',');
    switch (e.kind) {
      case 'open': return keys === 'kind,pin,position' && Number.isInteger(e.pin) && e.pin > 0 && e.pin <= 100000 && tuple(e.position, 2);
      case 'edit': return keys === 'kind,pin' && Number.isInteger(e.pin) && e.pin > 0 && e.pin <= 100000;
      case 'list': case 'save': case 'delete': case 'dismiss': case 'outside': return keys === 'kind';
      case 'embedded': return keys === 'kind,value' && typeof e.value === 'boolean';
      case 'badge': return keys === 'kind,rect' && tuple(e.rect, 4);
      default: return false;
    }
  });
}

type WorkArea = { x: number; y: number; width: number; height: number };
export function popupBounds(point: { x: number; y: number }, area: WorkArea, height: number) {
  const width = Math.min(332, area.width);
  return { x: Math.round(Math.max(area.x, Math.min(point.x + 12, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(point.y + 12, area.y + area.height - height))),
    width, height: Math.min(height, area.height) };
}
export function badgeBounds(rect: [number, number, number, number], area: WorkArea) {
  const [x, y, width, height] = rect;
  let bx = x + width + 6, by = y;
  if (bx + 150 > area.x + area.width) {
    bx = x - 156;
    if (bx < area.x) { bx = x + (width - 150) / 2; by = y + height + 6; }
  }
  return { x: Math.round(Math.max(area.x, Math.min(bx, area.x + area.width - 150))),
    y: Math.round(Math.max(area.y, Math.min(by, area.y + area.height - 44))) };
}
