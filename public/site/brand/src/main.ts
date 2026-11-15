import { createDeckViewer } from './components/deck-viewer.ts';
import { slides } from './brand-slides.ts';
import { renderBrandDocument } from './brand-document.ts';
import '../../public/assets/brand-book/design-system/tokens/apparent.css';
import './brand-book.css';
import './brand-kit.css';

document.body.classList.add('brand-route');
document.title = 'apparent | Brand presentation';

const root = document.querySelector('#deck');
const parameters = new URLSearchParams(window.location.search);
const presentationMode = parameters.has('slides') || parameters.has('capture') || /^#slide-\d+$/.test(window.location.hash);

if (presentationMode) {
  createDeckViewer({
    root,
    slides,
    identity: 'apparent brand book',
    ariaLabel: 'apparent brand book',
  });
  if (!parameters.has('capture')) {
    const readingLink = document.createElement('a');
    readingLink.className = 'bb-reading-toggle';
    readingLink.href = '/brand/';
    readingLink.textContent = 'Brand guidelines';
    document.body.append(readingLink);
  }
} else {
  renderBrandDocument(root);
}

if (!presentationMode) {
  void import('./component-library.tsx').then(({ mountComponentLibrary }) => mountComponentLibrary());
}
