try {
  await import("../check.ts");
} catch {
  console.error(
    [
      "Staged checker could not load installed tools. From the repository root, run with Node 22.18+:",
      "  npm ci --ignore-scripts --prefix shared/enablement/dependency-policy",
      "If your staged changes need TypeScript checks, prepare the locked dependencies before committing:",
      "  node shared/enablement/dependency-policy/fast/setup.ts --staged",
    ].join("\n"),
  );
  process.exitCode = 1;
}
