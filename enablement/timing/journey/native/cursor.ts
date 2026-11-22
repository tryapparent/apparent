export function guestCursor(ssh: (command: string) => string) {
  const instances = JSON.parse(ssh("hyprctl -j instances"));
  const instance = instances[0]?.instance;
  if (instances.length !== 1 || !/^[a-z0-9_]+$/i.test(instance))
    throw Error("Expected the owned compositor");
  const base = "hyprctl -i " + instance + " ";
  const position = () =>
    JSON.parse(ssh(base + "-j cursorpos")) as { x: number; y: number };
  const place = ({ x, y }: ReturnType<typeof position>) => {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      x >= 1280 ||
      y < 0 ||
      y >= 800
    )
      throw Error("Unexpected cursor placement outside the owned display");
    ssh(base + `dispatch 'hl.dsp.cursor.move({ x = ${x}, y = ${y} })'`);
    const actual = position();
    if (x !== actual.x || y !== actual.y)
      throw Error("Cursor fixture did not apply");
  };
  function placeInDraft() {
    type Window = {
      title: string;
      at: [number, number];
      size: [number, number];
      mapped: boolean;
      hidden: boolean;
    };
    const windows = (JSON.parse(ssh(base + "-j clients")) as Window[]).filter(
      (window) => window.mapped && !window.hidden,
    );
    const drafts = windows.filter(
      (window) => window.title === "Apparent benchmark draft",
    );
    if (
      drafts.length !== 1 ||
      drafts[0].size.some((dimension) => dimension < 120)
    )
      throw Error("Expected one visible disposable draft");
    const draft = drafts[0];
    const overlays = windows.filter(
      (window) =>
        window !== draft &&
        window.title.startsWith("Apparent ") &&
        !/^Apparent (Ink |capture smoke )/.test(window.title),
    );
    const ratios = [0.85, 0.65, 0.5, 0.3, 0.15];
    for (const xRatio of ratios) {
      const x = Math.floor(draft.at[0] + draft.size[0] * xRatio);
      for (const yRatio of ratios) {
        const y = Math.floor(draft.at[1] + draft.size[1] * yRatio);
        if (
          overlays.some(
            (window) =>
              x >= window.at[0] &&
              x < window.at[0] + window.size[0] &&
              y >= window.at[1] &&
              y < window.at[1] + window.size[1],
          )
        )
          continue;
        place({ x, y });
        return;
      }
    }
    throw Error("No unoccluded area in the synthetic draft");
  }
  return { place, position, placeInDraft };
}
