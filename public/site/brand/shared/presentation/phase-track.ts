export function addPhaseTrack({
  slide,
  phases,
  activePhaseIndex,
  hidden = false,
  onSelect,
}) {
  if (hidden
    || !phases.length
    || activePhaseIndex < 0
    || slide instanceof HTMLImageElement
    || slide.classList.contains('blank-opening-slide')) return;

  const track = document.createElement('nav');
  track.className = 'slide-phase-track';
  track.setAttribute('aria-label', 'Pitch narrative');
  phases.forEach((phase, index) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'slide-phase-tile';
    tile.setAttribute('aria-label', phase.label);
    tile.title = phase.label;
    tile.classList.toggle('is-active', index === activePhaseIndex);
    tile.classList.toggle('is-complete', index < activePhaseIndex);
    if (index === activePhaseIndex) {
      tile.setAttribute('aria-current', 'step');
      const label = document.createElement('span');
      label.className = 'slide-phase-label';
      label.textContent = phase.label;
      tile.append(label);
    }
    tile.addEventListener('click', (event) => {
      event.stopPropagation();
      onSelect(phase);
    });
    track.append(tile);
  });
  slide.append(track);
}
