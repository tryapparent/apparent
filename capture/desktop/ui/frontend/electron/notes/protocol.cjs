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
  return v && (v.embedded == null || typeof v.embedded === 'boolean') && ['badge', 'editor', 'list'].includes(v.mode) && (v.current === null || pin(v.current)) &&
    (v.badgeRect == null || (Array.isArray(v.badgeRect) && v.badgeRect.length === 4 && v.badgeRect.every(Number.isFinite))) &&
    Array.isArray(v.position) && v.position.length === 2 && v.position.every(Number.isFinite) &&
    Array.isArray(v.notes) && v.notes.length <= 100 && v.notes.every(note) &&
    Array.isArray(v.drafts) && v.drafts.length <= 100 && v.drafts.every(note) &&
    (v.error === null || typeof v.error === 'string');
}
const { popupBounds, badgeBounds } = require('./presentation.cjs');
module.exports = { validCommand, validSnapshot, popupBounds, badgeBounds };
