function controlButton(className, ariaLabel, text) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', ariaLabel);
  button.textContent = text;
  return button;
}

export function mountDeckShell({
  root,
  identity,
  ariaLabel,
  includeProcessToggle = false,
}) {
  const shell = document.createElement('div');
  shell.className = 'deck-shell';

  const topbar = document.createElement('header');
  topbar.className = 'topbar';
  const identityElement = document.createElement('div');
  identityElement.className = 'identity';
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.setAttribute('aria-hidden', 'true');
  identityElement.append(mark, document.createTextNode(identity));
  const count = document.createElement('div');
  count.className = 'slide-count';
  count.setAttribute('aria-live', 'polite');
  count.setAttribute('aria-atomic', 'true');
  topbar.append(identityElement, count);

  const stage = document.createElement('section');
  stage.className = 'stage';
  stage.tabIndex = 0;
  const processInstructions = includeProcessToggle
    ? ', down to open the design process, and up to return to the pitch'
    : '';
  stage.setAttribute(
    'aria-label',
    `${ariaLabel}. Use left and right arrow keys to navigate${processInstructions}.`,
  );
  const wrap = document.createElement('div');
  wrap.className = 'slide-wrap';
  wrap.dataset.slideReady = 'false';
  const mount = document.createElement('div');
  mount.className = 'slide-mount';
  wrap.append(
    mount,
    controlButton('tap-zone prev', 'Previous slide', ''),
    controlButton('tap-zone next', 'Next slide', ''),
  );
  stage.append(wrap);

  const controls = document.createElement('nav');
  controls.className = 'controls';
  controls.setAttribute('aria-label', 'Presentation controls');
  const previous = controlButton('control previous', 'Previous slide', '←');
  const next = controlButton('control next', 'Next slide', 'Next ');
  const arrow = document.createElement('span');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  next.append(arrow);
  controls.append(previous, next);
  if (includeProcessToggle) {
    const processToggle = controlButton('control process-toggle', 'Design process', 'Design process');
    processToggle.removeAttribute('aria-label');
    processToggle.setAttribute('aria-pressed', 'false');
    controls.append(processToggle);
  }
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = includeProcessToggle ? '← → navigate · ↓ process · ↑ pitch' : '← → navigate';
  controls.append(hint);

  const progress = document.createElement('div');
  progress.className = 'progress';
  progress.setAttribute('aria-hidden', 'true');
  progress.append(document.createElement('span'));
  shell.append(topbar, stage, controls, progress);
  root.replaceChildren(shell);
}
