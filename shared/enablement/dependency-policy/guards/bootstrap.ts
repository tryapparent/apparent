try {
  await import("../check.ts");
} catch {
  console.error(
    "Staged checker could not load installed tools; run npm ci --ignore-scripts --prefix shared/enablement/dependency-policy with Node 22.18+ before committing",
  );
  process.exitCode = 1;
}
