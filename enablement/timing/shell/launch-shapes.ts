function isGuardedPrObserver(source: string): boolean {
  const lines = source.split("\n", 7);
  if (lines.length !== 6) return false;
  const [setup, job, expected, before, watch, after] = lines;
  if (
    setup !== "set -e" ||
    before !== after ||
    !/^job=\/tmp\/apparent-dev-[A-Za-z0-9][\w.-]*$/.test(job) ||
    !/^expected=[a-fA-F0-9]{40}$/.test(expected)
  )
    return false;
  const guard = before.match(
    /^test "\$\(gh pr view (?<pr>[1-9]\d*) -R (?<repo>[\w-]+\/[\w.-]+) --json headRefOid --jq \.headRefOid\)" = "\$expected"$/,
  )?.groups;
  const observer = watch.match(
    /^timeout [1-9]\d{0,8} gh pr checks (?<pr>[1-9]\d*) -R (?<repo>[\w-]+\/[\w.-]+) --watch --interval [1-9]\d{0,8} --fail-fast > "\$job\/pr-\k<pr>-checks\.log" 2>&1$/,
  )?.groups;
  return (
    !!guard &&
    !!observer &&
    guard.pr === observer.pr &&
    guard.repo === observer.repo
  );
}

function isExactRunObserver(lines: string[]): boolean {
  const command =
    /^python3 \/home\/[\w-]+\/\.hermes\/scripts\/gh_owned_wait\.py [1-9]\d* --repo [\w-]+\/[\w.-]+ --head [a-fA-F0-9]{40} --attempt [1-9]\d* --timeout [1-9]\d{0,8} --interval [1-9]\d{0,8} ?> "\$(?<job>j|job)\/[\w-]+\.log" 2>&1$/;
  const subshell = lines[1]?.match(/^\(umask 077; (.*)\)$/);
  if (
    lines.length === 2 &&
    /^j=\/tmp\/apparent-dev-[\w-][\w.-]*$/.test(lines[0])
  ) {
    return !!subshell && command.exec(subshell[1])?.groups?.job === "j";
  }
  return (
    lines.length === 5 &&
    lines[0] === "set -eu" &&
    lines[1] === "umask 077" &&
    /^job=\/tmp\/apparent-dev-[\w-][\w.-]*$/.test(lines[2]) &&
    /^cat "\$job\/[\w-]+\.log"$/.test(lines[3]) &&
    command.exec(lines[4])?.groups?.job === "job"
  );
}

function isVmStartProof(lines: string[]): boolean {
  if (lines.length !== 6 && lines.length !== 7) return false;
  const [setup, job, announce, driver, report, read, guard] = lines;
  const args = driver
    .match(
      /^APPARENT_BENCH_SURFACE=1 (?:bash record\/enablement\/performance\/run\.sh "\$PWD"|node enablement\/timing\/journey\/native\/run\.ts) (.+)$/,
    )?.[1]
    .split(" ");
  if (args?.length !== 6) return false;
  const [template, guest, image, checksum, model, output] = args;
  const jobInput =
    /^\/tmp\/apparent-dev-[\w-][\w.-]*\/(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/;
  return (
    setup === "set -eu" &&
    /^job=\$\(mktemp -d \/tmp\/apparent-dev-[\w-]+-XXXXXX\)$/.test(job) &&
    announce === "printf '%s\\n' \"$job\"" &&
    /^\/(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/.test(template) &&
    /^[\w-]+$/.test(guest) &&
    jobInput.test(image) &&
    image.endsWith(".AppImage") &&
    /^[a-fA-F0-9]{64}$/.test(checksum) &&
    jobInput.test(model) &&
    model.endsWith(".gguf") &&
    output === '"$job"' &&
    report ===
      'node record/enablement/performance/start-report.ts "$job/vm" > "$job/start.json"' &&
    read === 'cat "$job/start.json"' &&
    (guard === undefined ||
      guard ===
        "test -z \"$(rg --files --hidden \"$job/vm\" -g '*.ppm' -g '*-desktop.png' -g 'desktop.png')\"")
  );
}

export function wholeShellOperation(source: string): string | undefined {
  if (
    /^[ \t]*npx -y @nomac\/cli job job_[A-Za-z0-9][\w-]* --wait [1-9]\d{0,8}(?: > \/tmp\/apparent-dev-[\w-][\w.-]*\/(?:[\w-][\w.-]*\/)*[\w-][\w.-]* 2>&1)?[ \t]*\n?$/.test(
      source,
    )
  ) {
    return "native job observation";
  }
  if (isGuardedPrObserver(source)) return "CI observation";
  const lines = source.split("\n", 9);
  if (lines.at(-1) === "") lines.pop();
  if (isExactRunObserver(lines)) return "CI observation";
  if (isVmStartProof(lines)) return "isolated VM Start proof";
  const observer = source.match(
    /^[ \t]*timeout [1-9]\d* bash -c '([^'\n]+)'(?: > \/tmp\/(?:[\w-][\w.-]*\/)*[\w-][\w.-]* 2>&1)?[ \t]*\n?$/,
  );
  if (
    observer &&
    /^rc=0; for id in(?: [1-9]\d*)+; do gh run watch "\$id" -R [\w-]+\/[\w.-]+ --exit-status --compact --interval [1-9]\d* \|\| rc=1; done; exit "\$rc"$/.test(
      observer[1],
    )
  ) {
    return "CI observation";
  }
}
