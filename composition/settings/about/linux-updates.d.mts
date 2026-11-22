type BendMaybe<T> = { $: "None" } | { $: "Some"; value: T };
export type BendList<T> =
  | { $: "Nil" }
  | { $: "Con"; head: T; tail: BendList<T> };
export type Asset = { $: "Asset"; index: number; name: string };
export type Release = {
  $: "Release";
  index: number;
  tag: string;
  draft: boolean;
  prerelease: boolean;
  published: BendMaybe<string>;
  assets: BendList<Asset>;
};

type Selection = {
  $: "Selection";
  release: number;
  image: number;
  checksum: number;
};

declare const policy: {
  supported_architecture(arch: string): boolean;
  select_release(
    channel: string,
    arch: string,
    releases: BendList<Release>,
  ): BendMaybe<Selection>;
  needs_channel_release(
    channel: string,
    id: string,
    installed: boolean,
    installedChannel: string,
    installedId: string,
    revision: string,
    modified: boolean,
  ): boolean;
};
export default policy;
