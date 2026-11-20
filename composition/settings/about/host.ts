import { nightlyDownload } from "./download.ts";

type AboutIdentity = { version?: string; mac?: boolean; nightly?: boolean };
type Host = {
  handle(
    name: string,
    listener: (event: unknown, ...values: unknown[]) => unknown,
  ): void;
  validate(event: unknown, extra: unknown[]): void;
  current(): boolean;
  read(): AboutIdentity | undefined;
  send(action: object): void;
  open(url: string): Promise<void>;
  copy(text: string): void;
};
const links = new Map([
  ["website", "https://app.tryapparent.com"],
  ["source", "https://github.com/tryapparent/apparent"],
  ["discord", "https://discord.gg/ZRGZwV32M"],
]);
const actions = new Set([
  "check-for-updates",
  "dismiss-update-check",
  "update-now",
  "update-later",
  "tour",
]);

export function bindAbout(host: Host) {
  host.handle("apparent:about-link", async (event, link, ...extra) => {
    host.validate(event, extra);
    if (!host.current() || typeof link !== "string")
      throw Error("Forbidden link");
    const state = host.read();
    if (link === "nightly" && state?.mac === true && state.nightly !== true)
      return host.open(await nightlyDownload());
    const url = links.get(link);
    if (!url) throw Error("Forbidden link");
    return host.open(url);
  });
  host.handle("apparent:about-copy-version", (event, ...extra) => {
    host.validate(event, extra);
    const version = host.read()?.version;
    if (!host.current() || typeof version !== "string" || !version)
      throw Error("Version unavailable");
    host.copy(`Apparent ${version}`);
  });
  host.handle("apparent:about-read", (event, ...extra) => {
    host.validate(event, extra);
    if (!host.current()) throw Error("Unavailable outside About");
    return host.read();
  });
  host.handle("apparent:about-action", (event, action, ...extra) => {
    host.validate(event, extra);
    if (!host.current() || !action || typeof action !== "object")
      throw Error("Forbidden About action");
    const request = action as Record<string, unknown>;
    const size = Object.keys(request).length;
    const simple =
      size === 1 &&
      typeof request.action === "string" &&
      actions.has(request.action);
    const channel =
      size === 3 &&
      request.action === "set" &&
      request.key === "updateChannel" &&
      (request.value === "stable" || request.value === "main");
    if (!simple && !channel) throw Error("Forbidden About action");
    host.send(request);
  });
}
