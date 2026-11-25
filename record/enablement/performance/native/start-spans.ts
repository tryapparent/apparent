type Trace = {
  appRelativeSpans?: unknown[];
  desktopMarksMs?: { recording_start_ms?: number };
};

export function startupSpans(trace: Trace, retainedLog: () => string) {
  if (trace.appRelativeSpans?.length) return trace.appRelativeSpans;

  const sections = retainedLog().split(
    /^START_METRIC recording_start_ms=([\d.]+)$/gm,
  );
  const recordedStart = trace.desktopMarksMs?.recording_start_ms;
  if (!Number.isFinite(recordedStart)) return [];
  const relevant = [];
  for (let index = 1; index < sections.length; index += 2) {
    if (Number(sections[index]) === recordedStart) {
      relevant.push(
        ...sections[index + 1].matchAll(
          /recording startup stages: (\[[^\n]*\])/g,
        ),
      );
    }
  }
  const matchingMarkers = sections.filter(
    (section, index) => index % 2 === 1 && Number(section) === recordedStart,
  );
  if (matchingMarkers.length !== 1 || relevant.length !== 1) return [];
  const spans: unknown = JSON.parse(relevant[0][1]);
  return Array.isArray(spans) ? spans : [];
}
