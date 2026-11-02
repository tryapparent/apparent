const text = v => typeof v === 'string' && Buffer.byteLength(v) <= 8192 && !v.includes('\0');
const pin = n => Number.isInteger(n) && n > 0 && n <= 100000;
function validCommand(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const fields = { draft: ['action', 'pin', 'text'], save: ['action', 'pin', 'text'],
    delete: ['action', 'pin'], edit: ['action', 'pin'], dismiss: ['action'], list: ['action'] }[v.action];
  return fields && Object.keys(v).length === fields.length && Object.keys(v).every(k => fields.includes(k)) &&
    (!fields.includes('pin') || pin(v.pin)) && (!fields.includes('text') || text(v.text));
}
function validSnapshot(v) {
  const note = n => n && pin(n.pin) && Number.isSafeInteger(n.t) && n.t >= 0 &&
    [n.x, n.y].every(p => Number.isFinite(p) && p >= 0 && p <= 1) && text(n.text);
  return v && ['badge', 'editor', 'list'].includes(v.mode) && (v.current === null || pin(v.current)) &&
    (v.badgePosition == null || (Array.isArray(v.badgePosition) && v.badgePosition.length === 2 && v.badgePosition.every(Number.isFinite))) &&
    Array.isArray(v.position) && v.position.length === 2 && v.position.every(Number.isFinite) &&
    Array.isArray(v.notes) && v.notes.length <= 100 && v.notes.every(note) &&
    Array.isArray(v.drafts) && v.drafts.length <= 100 && v.drafts.every(note) &&
    (v.error === null || typeof v.error === 'string');
}
function popupBounds(point, area, height) {
  const width = Math.min(332, area.width);
  return { x: Math.round(Math.max(area.x, Math.min(point.x + 12, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(point.y + 12, area.y + area.height - height))),
    width, height: Math.min(height, area.height) };
}
module.exports = { validCommand, validSnapshot, popupBounds };
