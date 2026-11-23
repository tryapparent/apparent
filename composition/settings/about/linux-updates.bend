import Base

type Asset is Data:
  Asset{index: U32, name: String}

type Release is Data:
  Release{index: U32, tag: String, draft: Bool, prerelease: Bool, published: Maybe<&2, String>, assets: List<&2, Asset>}

type Selection is Data:
  Selection{release: U32, image: U32, checksum: U32}

type Ranked is Data:
  Stable{version: List<&2, U32>, selection: Selection}
  Main{published: String, selection: Selection}

def matches_asset(suffix: Bool, key: String, +name: String) -> Bool:
  match suffix:
    case False{}: String.eq(key, name)
    case True{}: Bool.and(String.starts_with(name, "Apparent-"), String.ends_with(name, key))

def found_asset(found: Bool, asset: Asset, rest: Unit -> Maybe<&2, Asset>) -> Maybe<&2, Asset>:
  match found:
    case True{}: Some{asset}
    case False{}: rest(Unit{})

def find_asset(+suffix: Bool, +key: String, assets: List<&2, Asset>) -> Maybe<&2, Asset>:
  match assets:
    case Nil{}: None{}
    case Con{Asset{index, +name}, tail}:
      found_asset(matches_asset(suffix, key, name), Asset{index, name}, unit => find_asset(suffix, key, tail))

def component(text: String) -> Maybe<&2, U32>:
  match text:
    case SCon{'+', rest}: U32.read(rest)
    case _: U32.read(text)

def parse_part(part: Maybe<&2, U32>, rest: U32 -> Maybe<&2, List<&2, U32>>) -> Maybe<&2, List<&2, U32>>:
  match part:
    case None{}: None{}
    case Some{value}: rest(value)

def version_parts(parts: List<&2, String>, acc: List<&2, U32>) -> Maybe<&2, List<&2, U32>>:
  match parts:
    case Nil{}: Some{List.reverse(&2, U32, acc)}
    case head <> tail:
      parse_part(component(head), value => version_parts(tail, value <> acc))

def pair(index: U32, image: Maybe<&2, Asset>, checksum: Maybe<&2, Asset>) -> Maybe<&2, Selection>:
  match image checksum:
    case Some{Asset{a, _}} Some{Asset{b, _}}: Some{Selection{index, a, b}}
    case _ _: None{}

def rank_stable(version: List<&2, U32>, choice: Maybe<&2, Selection>) -> Maybe<&2, Ranked>:
  match choice:
    case Some{selected}: Some{Stable{version, selected}}
    case None{}: None{}

def stable_selection(version: Maybe<&2, List<&2, U32>>, index: U32, +name: String, +assets: List<&2, Asset>) -> Maybe<&2, Ranked>:
  match version:
    case None{}: None{}
    case Some{parts}:
      rank_stable(parts, pair(index, find_asset(False{}, name, assets), find_asset(False{}, String.append(name, ".sha256"), assets)))

def stable_rank(index: U32, +version: String, suffix: String, assets: List<&2, Asset>) -> Maybe<&2, Ranked>:
  name = String.append("Apparent-", String.append(version, suffix))
  stable_selection(version_parts(String.split(version, '.'), Nil{}), index, name, assets)

def hex_digits(text: String) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{+head, tail}:
      Bool.and(Bool.or(Char.is_digit(head), String.contains("abcdef", SCon{Char.to_lower(head), SNil{}})), hex_digits(tail))

def hex_if(length_ok: Bool, sha: String) -> Bool:
  match length_ok:
    case True{}: hex_digits(sha)
    case False{}: False{}

def revision_sha(+sha: String) -> Bool:
  hex_if(Nat.is_eq(String.length(sha), 40n), sha)

def revision_if(prefix: Bool, tag: String) -> Bool:
  match prefix:
    case False{}: False{}
    case True{}: revision_sha(String.drop(tag, 14n))

def main_revision(+tag: String) -> Bool:
  revision_if(String.starts_with(tag, "linux-main-v2-"), tag)

def checksum_found(found: Maybe<&2, Asset>, rest: Unit -> Bool) -> Bool:
  match found:
    case Some{_}: True{}
    case None{}: rest(Unit{})

def complete_if(matches: Bool, name: String, assets: List<&2, Asset>, rest: Unit -> Bool) -> Bool:
  match matches:
    case True{}: checksum_found(find_asset(False{}, String.append(name, ".sha256"), assets), rest)
    case False{}: rest(Unit{})

def complete_main_asset(+assets: List<&2, Asset>, +suffix: String, remaining: List<&2, Asset>) -> Bool:
  match remaining:
    case Nil{}: False{}
    case Con{Asset{_, +name}, tail}:
      complete_if(matches_asset(True{}, suffix, name), name, assets, unit => complete_main_asset(assets, suffix, tail))

def rank_main(published: String, choice: Maybe<&2, Selection>) -> Maybe<&2, Ranked>:
  match choice:
    case Some{selected}: Some{Main{published, selected}}
    case None{}: None{}

def main_pair(eligible: Bool, index: U32, published: String, +suffix: String, +assets: List<&2, Asset>) -> Maybe<&2, Ranked>:
  match eligible:
    case False{}: None{}
    case True{}:
      rank_main(published, pair(index, find_asset(True{}, suffix, assets), find_asset(True{}, String.append(suffix, ".sha256"), assets)))

def main_rank(valid: Bool, index: U32, published: String, +suffix: String, +assets: List<&2, Asset>) -> Maybe<&2, Ranked>:
  match valid:
    case False{}: None{}
    case True{}:
      main_pair(complete_main_asset(assets, suffix, assets), index, published, suffix, assets)

def release_rank(main: Bool, suffix: String, release: Release) -> Maybe<&2, Ranked>:
  match main release:
    case False{} Release{index, SCon{'v', version}, False{}, False{}, Some{_}, assets}:
      stable_rank(index, version, suffix, assets)
    case True{} Release{index, tag, False{}, True{}, Some{published}, assets}:
      main_rank(main_revision(tag), index, published, suffix, assets)
    case _ _: None{}

def version_order(order: Cmp, rest: Unit -> Bool) -> Bool:
  match order:
    case GT{}: True{}
    case LT{}: False{}
    case EQ{}: rest(Unit{})

def newer_version(candidate: List<&2, U32>, current: List<&2, U32>) -> Bool:
  match candidate current:
    case Nil{} _: False{}
    case Con{_, _} Nil{}: True{}
    case Con{head, tail} Con{old, rest}:
      version_order(U32.cmp(head, old), unit => newer_version(tail, rest))

def newer(candidate: Ranked, current: Ranked) -> Bool:
  match candidate current:
    case Stable{v, _} Stable{old, _}: newer_version(v, old)
    case Main{published, _} Main{old, _}: String.is_gt(published, old)
    case _ _: False{}

def keep(replace: Bool, candidate: Ranked, current: Ranked) -> Maybe<&2, Ranked>:
  match replace:
    case True{}: Some{candidate}
    case False{}: Some{current}

def prefer(candidate: Maybe<&2, Ranked>, current: Maybe<&2, Ranked>) -> Maybe<&2, Ranked>:
  match candidate current:
    case Some{+next} Some{+previous}: keep(newer(next, previous), next, previous)
    case _ None{}: candidate
    case _ _: current

def selection(best: Maybe<&2, Ranked>) -> Maybe<&2, Selection>:
  match best:
    case Some{Stable{_, choice}}: Some{choice}
    case Some{Main{_, choice}}: Some{choice}
    case None{}: None{}

def latest(+main: Bool, +suffix: String, releases: List<&2, Release>, best: Maybe<&2, Ranked>) -> Maybe<&2, Selection>:
  match releases:
    case Nil{}: selection(best)
    case release <> tail: latest(main, suffix, tail, prefer(release_rank(main, suffix, release), best))

def supported_architecture(+arch: String) -> Bool:
  Bool.or(String.eq(arch, "x86_64"), String.eq(arch, "aarch64"))

def select_release(channel: String, arch: String, releases: List<&2, Release>) -> Maybe<&2, Selection>:
  latest(String.eq(channel, "main"), String.append("-linux-", String.append(arch, ".AppImage")), releases, None{})

def needs_channel_release(+channel: String, +id: String, installed: Bool, installed_channel: String, installed_id: String, revision: String, modified: Bool) -> Bool:
  match installed:
    case True{}: Bool.not(Bool.and(String.eq(channel, installed_channel), String.eq(id, installed_id)))
    case False{}: Bool.not(Bool.and(String.eq(channel, "main"), Bool.and(Bool.not(modified), String.eq(id, revision))))
