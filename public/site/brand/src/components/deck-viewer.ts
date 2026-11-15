import { mountDeckShell } from '../../shared/presentation/deck-shell.ts';
import { addPhaseTrack } from '../../shared/presentation/phase-track.ts';
import { slideIndexFromHash } from '../../shared/presentation/slide-hash.ts';

function setNextLabel(button, label) {
  button.textContent = `${label} `;
  const arrow = document.createElement('span');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  button.append(arrow);
}

export function createDeckViewer({
  root,
  slides,
  processSlides = {},
  phases = [],
  identity = 'apparent',
  ariaLabel = 'Presentation slide',
}) {
  if (!root) throw new Error('Deck root element is required.');
  if (!slides.length) throw new Error('At least one slide is required.');

  mountDeckShell({ root, identity, ariaLabel, includeProcessToggle: true });
  root.dataset.slideCount = String(slides.length);
  const captureMode = new URLSearchParams(window.location.search).has('capture');
  if (captureMode) {
    document.documentElement.classList.add('capture-mode');
  }

  const wrap = root.querySelector('.slide-wrap');
  const mount = root.querySelector('.slide-mount');
  const count = root.querySelector('.slide-count');
  const previous = root.querySelector('.control.previous');
  const next = root.querySelector('.control.next');
  const processToggle = root.querySelector('.control.process-toggle');
  const progress = root.querySelector('.progress span');
  let active = slideIndexFromHash(slides.length);
  const processViewStorageKey = `deck-process-view:${window.location.pathname}`;
  let processMode = false;
  if (!captureMode) {
    try {
      processMode = sessionStorage.getItem(processViewStorageKey) === 'design-process';
    } catch {
      processMode = false;
    }
  }
  let processActive = 0;
  const processPositionStorageKey = `deck-process-positions:${window.location.pathname}`;
  let processPositions = new Map();
  try {
    processPositions = new Map(
      Object.entries(JSON.parse(sessionStorage.getItem(processPositionStorageKey) || '{}'))
        .map(([slideIndex, stepIndex]) => [Number(slideIndex), Number(stepIndex)]),
    );
  } catch {
    processPositions = new Map();
  }
  let renderToken = 0;

  function saveProcessPosition(slideIndex, stepIndex) {
    processPositions.set(slideIndex, stepIndex);
    try {
      sessionStorage.setItem(processPositionStorageKey, JSON.stringify(Object.fromEntries(processPositions)));
    } catch {
      // Session storage may be unavailable in hardened or embedded browser contexts.
    }
  }

  function rememberedProcessPosition(slideIndex) {
    const processHistory = processSlides[slideIndex + 1] || [];
    const remembered = processPositions.get(slideIndex) ?? 0;
    return Math.max(0, Math.min(processHistory.length - 1, remembered));
  }

  function saveProcessView() {
    if (captureMode) return;
    try {
      sessionStorage.setItem(processViewStorageKey, processMode ? 'design-process' : 'pitch');
    } catch {
      // Session storage may be unavailable in hardened or embedded browser contexts.
    }
  }

  function addInSlidePhaseTrack(slide, activePhaseIndex) {
    addPhaseTrack({
      slide,
      phases,
      activePhaseIndex,
      hidden: captureMode || processMode,
      onSelect: (phase) => {
        processMode = false;
        processActive = 0;
        void render(phase.start - 1);
      },
    });
  }

  async function render(index, updateHash = true) {
    const token = ++renderToken;
    active = Math.max(0, Math.min(slides.length - 1, index));
    const processHistory = processSlides[active + 1] || [];
    if (!processHistory.length) processMode = false;
    processActive = Math.max(0, Math.min(processHistory.length - 1, processActive));
    const definition = processMode ? processHistory[processActive] : slides[active];
    wrap.dataset.slideReady = 'false';

    let slide;
    if (definition.kind === 'image') {
      slide = new Image();
      slide.className = 'slide image-slide';
      slide.alt = processMode
        ? `${definition.title}: design process ${processActive + 1} of ${processHistory.length} for slide ${active + 1}`
        : `${definition.title}: slide ${active + 1} of ${slides.length}`;
      slide.decoding = 'sync';
      slide.src = definition.source;
      if (!slide.complete) {
        await new Promise((resolve, reject) => {
          slide.addEventListener('load', resolve, { once: true });
          slide.addEventListener('error', reject, { once: true });
        });
      }
    } else if (definition.kind === 'native') {
      const module = await definition.load();
      slide = await module.default();
      if (!(slide instanceof HTMLElement)) {
        throw new TypeError(`${processMode ? 'Design-process' : 'Native'} slide ${active + 1} must return an HTMLElement.`);
      }
    } else {
      throw new TypeError(`Unknown slide kind: ${definition.kind}`);
    }

    if (token !== renderToken) return;
    const activeSlideNumber = active + 1;
    const activePhaseIndex = phases.findIndex((phase) => (
      activeSlideNumber >= phase.start && activeSlideNumber <= phase.end
    ));
    addInSlidePhaseTrack(slide, activePhaseIndex);
    mount.replaceChildren(slide);
    count.textContent = processMode
      ? `Slide ${active + 1} · Design process ${processActive + 1} of ${processHistory.length}`
      : `Slide ${active + 1} of ${slides.length}`;
    previous.disabled = processMode
      ? active === 0 && processActive === 0
      : active === 0;
    next.disabled = processMode
      ? active === slides.length - 1 && processActive === processHistory.length - 1
      : active === slides.length - 1;
    setNextLabel(
      next,
      processMode && processActive === processHistory.length - 1 ? 'Next slide process' : 'Next',
    );
    processToggle.disabled = !processHistory.length;
    processToggle.setAttribute('aria-pressed', String(processMode));
    processToggle.textContent = processMode ? 'Back to pitch' : 'Design process';
    progress.style.width = processMode
      ? `${((processActive + 1) / processHistory.length) * 100}%`
      : `${((active + 1) / slides.length) * 100}%`;
    wrap.dataset.slideReady = 'true';
    root.dataset.activeSlide = String(active + 1);
    root.dataset.view = processMode ? 'design-process' : 'pitch';
    if (processMode) saveProcessPosition(active, processActive);
    saveProcessView();
    if (updateHash) history.replaceState(null, '', `#slide-${active + 1}`);
  }

  const navigate = (delta) => {
    if (processMode) {
      const activeProcessHistory = processSlides[active + 1] || [];
      if (delta > 0 && processActive === activeProcessHistory.length - 1) {
        if (active === slides.length - 1) return Promise.resolve();
        active += 1;
        processActive = 0;
        return render(active);
      }
      if (delta < 0 && processActive === 0) {
        if (active === 0) return Promise.resolve();
        active -= 1;
        const previousHistory = processSlides[active + 1] || [];
        processActive = Math.max(0, previousHistory.length - 1);
        return render(active);
      }
      processActive += delta;
      return render(active, false);
    }
    processActive = 0;
    return render(active + delta);
  };
  previous.addEventListener('click', () => navigate(-1));
  next.addEventListener('click', () => navigate(1));
  root.querySelector('.tap-zone.prev').addEventListener('click', () => navigate(-1));
  root.querySelector('.tap-zone.next').addEventListener('click', () => navigate(1));
  processToggle.addEventListener('click', () => {
    if (!(processSlides[active + 1] || []).length) return;
    processMode = !processMode;
    if (processMode) processActive = rememberedProcessPosition(active);
    render(active, false);
  });
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const isEditable = target instanceof Element
      && (target.matches('input, textarea, select, [contenteditable="true"]')
        || target.closest('[contenteditable="true"]'));
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditable) return;

    if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault();
      navigate(1);
    }
    if (['ArrowLeft', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      navigate(-1);
    }
    if (event.key === 'Home') {
      event.preventDefault();
      render(0);
    }
    if (event.key === 'End') {
      event.preventDefault();
      render(slides.length - 1);
    }
    if (event.key === 'ArrowDown' && !processMode && (processSlides[active + 1] || []).length) {
      event.preventDefault();
      processMode = true;
      processActive = rememberedProcessPosition(active);
      render(active, false);
    }
    if (event.key === 'ArrowUp' && processMode) {
      event.preventDefault();
      processMode = false;
      render(active, false);
    }
  });

  window.addEventListener('hashchange', () => {
    processMode = false;
    processActive = 0;
    render(slideIndexFromHash(slides.length));
  });
  if (processMode) {
    if ((processSlides[active + 1] || []).length) {
      processActive = rememberedProcessPosition(active);
    } else {
      processMode = false;
    }
  }
  render(active);

  // A small stable interface for visual-QA scripts and local debugging.
  window.deck = Object.freeze({
    get activeSlide() { return active + 1; },
    get slideCount() { return slides.length; },
    get view() { return processMode ? 'design-process' : 'pitch'; },
    show(slideNumber) { return render(slideNumber - 1); },
    toggleDesignProcess() {
      if (!(processSlides[active + 1] || []).length) return Promise.resolve();
      processMode = !processMode;
      if (processMode) processActive = rememberedProcessPosition(active);
      return render(active, false);
    },
  });
}
