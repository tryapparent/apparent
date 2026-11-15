export function createNativeSlide({ title, className = '', markup = '' }) {
  const slide = document.createElement('article');
  slide.className = ['slide', 'native-slide', className].filter(Boolean).join(' ');
  slide.setAttribute('role', 'group');
  slide.setAttribute('aria-label', title);
  slide.innerHTML = markup;
  return slide;
}
