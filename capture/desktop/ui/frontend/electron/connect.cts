export function admitConnect(settings: boolean, pane: string | undefined) {
  if (settings && pane !== "general") throw Error("Unavailable outside General");
}
