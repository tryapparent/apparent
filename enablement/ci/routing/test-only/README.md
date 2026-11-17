# Test-only CI qualification

The qualifier tests exercise committed Git ranges and the real selection and
admission commands. They preserve conservative routing when the input history,
imports, referring files, or file modes fall outside the audited boundary.

The admitted test-only range also exercises the CI test command inventory.
Bun must discover both the root and Connect contract suites and exclude
product tests. The disposable root and Connect suites mark execution, and an
unrelated product suite fails if discovered. This replaces the command-spelling
assertion. The existing requirement for unfiltered commands still applies, so
a name filter that selects only the canaries cannot pass the test.

The coverage adds no test declaration and preserves all 19 qualifier cases.
Its new fixture lines are justified by independently checking real discovery
for each owner and verifying product exclusion. Historical destination fixture
and Mac reference work already landed separately in #1404 and #1410.
