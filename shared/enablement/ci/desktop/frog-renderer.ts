type Change = {
  path: string;
  status: string;
  oldMode: string;
  newMode: string;
};
const presentation =
  /^onboarding\/renderer\/frog\/(desktop\.css|desktop\.tsx|sprite\.tsx|lily\.png|couch-hops\.png)$/;
const boundary = /\b(?:import|export|require)\b[^\n]*|url\([^)]*\)/g;

export function frogRendererRange(
  paths: string[] | null,
  delta: Change[] | null,
  read: (path: string) => [string, string],
): boolean {
  if (!paths?.length || delta?.length !== paths.length) return false;
  return delta.every(({ path, status, oldMode, newMode }) => {
    if (
      !presentation.test(path) ||
      status !== "M" ||
      oldMode !== "100644" ||
      newMode !== "100644"
    )
      return false;
    if (!/\.(tsx|css)$/.test(path)) return true;
    try {
      const [before, after] = read(path);
      return (
        JSON.stringify(before.match(boundary)) ===
        JSON.stringify(after.match(boundary))
      );
    } catch {
      return false;
    }
  });
}
