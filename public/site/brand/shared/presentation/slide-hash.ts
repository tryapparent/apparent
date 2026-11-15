const HASH_PATTERN = /^#slide-(\d+)$/;

export function slideIndexFromHash(slideCount) {
  const match = window.location.hash.match(HASH_PATTERN);
  const requested = match ? Number(match[1]) - 1 : 0;
  return Math.max(0, Math.min(slideCount - 1, requested));
}
