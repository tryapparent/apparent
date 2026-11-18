const pageSize = 3;

export function visibleDestinations<T>(choices: readonly T[], index: number) {
  const start = Math.max(0, Math.min(index - 1, choices.length - pageSize));
  const rows = choices.slice(start, start + pageSize);
  const next = start + rows.length;
  return { start, rows, moreIndex: next < choices.length ? next : null };
}

export function computerLabels(values: readonly unknown[]) {
  const labels = values.map((value, index) => {
    const label = typeof value === "string" ? value.trim() : "";
    const networkAddress =
      /^(?:https?:\/\/|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$|\[?[\da-f]*:[\da-f:]+(?:%[a-z0-9]+)?\]?(?::\d+)?$)/i;
    return label && !networkAddress.test(label)
      ? label
      : `Computer ${index + 1}`;
  });
  const occupied = new Set(labels);
  const assigned = new Set<string>();
  return labels.map((label, index) => {
    if (labels.indexOf(label) === labels.lastIndexOf(label)) return label;

    let suffix = index + 1;
    let candidate = `${label} (${suffix})`;
    while (occupied.has(candidate) || assigned.has(candidate)) {
      candidate = `${label} (${++suffix})`;
    }
    assigned.add(candidate);
    return candidate;
  });
}
