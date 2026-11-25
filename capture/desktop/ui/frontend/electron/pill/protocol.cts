// @ts-nocheck -- preserved bounded Electron host; renderer and public view are typed.
'use strict';
const actions = new Set(['record','cancel','finish','whiteboard','notes','paste','copy-link','inspect','dismiss',
  'select-area','select-screen','select-iphone']);
function view(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !['hidden','selecting','recording','processing','completed'].includes(value.phase) ||
      !(value.noteCount == null || Number.isSafeInteger(value.noteCount) && value.noteCount >= 0 && value.noteCount <= 100) ||
      typeof value.clock !== 'string' || value.clock.length > 20 ||
      !(value.shareIndicator == null || ['none','uploading','retry','receipt'].includes(value.shareIndicator)) ||
      typeof value.label !== 'string' || value.label.length > 300 ||
      !(value.warning === null || typeof value.warning === 'string' && value.warning.length <= 300) ||
      !(value.inputWaveform == null || Array.isArray(value.inputWaveform) && value.inputWaveform.length === 24 && value.inputWaveform.every(level => Number.isFinite(level) && level >= 0 && level <= 1)) ||
      !(value.noteTip == null || value.phase === 'recording' && typeof value.noteTip === 'string' && value.noteTip.length <= 120) ||
      !(value.notice == null || typeof value.notice === 'string' && value.notice.length<=120) ||
      !(value.transcript == null || value.phase === 'recording' && ['starting','streaming','failed'].includes(value.transcript.state) && typeof value.transcript.text === 'string' && value.transcript.text.length <= 16384) ||
      typeof value.reducedMotion !== 'boolean' || typeof value.draggable !== 'boolean' ||
      !Array.isArray(value.actions) || value.actions.length > 10) throw Error('Invalid pill state');
  const seen = new Set();
  const controls = value.actions.map(a => {
    if (!a || !actions.has(a.id) || seen.has(a.id) || typeof a.label !== 'string' || a.label.length > 60 ||
        ['enabled','selected','primary'].some(k => typeof a[k] !== 'boolean')) throw Error('Invalid pill control');
    seen.add(a.id);
    return {id:a.id,label:a.label,enabled:a.enabled,selected:a.selected,primary:a.primary};
  });
  return {revision:value.revision,phase:value.phase,clock:value.clock,label:value.label,warning:value.warning,notice:value.notice??null,noteTip:value.noteTip??null,
    shareIndicator:value.shareIndicator??'none',reducedMotion:value.reducedMotion,draggable:value.draggable,inputWaveform:value.inputWaveform??null,noteCount:value.noteCount??0,
    transcript:value.transcript == null ? null : {state:value.transcript.state,text:value.transcript.text},actions:controls};
}
function command(current, revision, action) {
  if (!current || revision !== current.revision || !actions.has(action) ||
      !current.actions.some(a => a.id === action && a.enabled)) throw Error('Stale or unavailable pill action');
  return {revision,action};
}
function profile(appData) {
  const name = process.env.APPARENT_PROFILE === 'apparent-nightly' ? 'apparent-nightly-pill' : 'apparent-pill';
  return require('node:path').join(appData, name);
}
module.exports = {view,command,profile};
