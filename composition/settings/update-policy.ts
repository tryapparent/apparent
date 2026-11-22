import policy, {
  type Asset,
  type BendList,
  type Release,
} from "./about/linux-updates.mjs";

export type UpdateIdentity = { channel: "stable" | "main"; id: string };
export interface UpdateFacts {
  candidate: UpdateIdentity;
  installed: UpdateIdentity | null;
  revision: string | null;
  modified: boolean;
}

type ReleaseFacts = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: { name: string }[];
};

function bendList<T>(items: T[]): BendList<T> {
  return items.reduceRight<BendList<T>>(
    (tail, head) => ({ $: "Con", head, tail }),
    { $: "Nil" },
  );
}

export function selectRelease(
  channel: UpdateIdentity["channel"],
  arch: string,
  releases: ReleaseFacts[],
) {
  if (!policy.supported_architecture(arch)) return { kind: "unsupported" };
  const selected = policy.select_release(
    channel,
    arch,
    bendList(
      releases.map<Release>((release, index) => ({
        $: "Release",
        index,
        tag: release.tag_name,
        draft: release.draft,
        prerelease: release.prerelease,
        published:
          release.published_at === null
            ? { $: "None" }
            : { $: "Some", value: release.published_at },
        assets: bendList(
          release.assets.map<Asset>(({ name }, index) => ({
            $: "Asset",
            index,
            name,
          })),
        ),
      })),
    ),
  );
  if (selected.$ === "None") return { kind: "noRelease" };
  const { release, image, checksum } = selected.value;
  return { kind: "selected", release, image, checksum };
}

export function needsChannelRelease(facts: UpdateFacts): boolean {
  const { candidate, installed } = facts;
  if (!["stable", "main"].includes(candidate.channel) || !candidate.id) {
    throw Error("Invalid update target");
  }
  return policy.needs_channel_release(
    candidate.channel,
    candidate.id,
    installed !== null,
    installed?.channel ?? "",
    installed?.id ?? "",
    facts.revision ?? "",
    facts.modified,
  );
}
