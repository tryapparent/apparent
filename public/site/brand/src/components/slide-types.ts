export function imageSlide(title, source) {
  return Object.freeze({ kind: 'image', title, source });
}

// A native slide module exports a default function that returns an HTMLElement.
// Keeping this contract tiny makes a slide independently editable and hot-reloadable.
export function nativeSlide(title, load) {
  return Object.freeze({ kind: 'native', title, load });
}
