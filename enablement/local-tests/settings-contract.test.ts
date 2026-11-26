import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogPaths,
  validateCatalog,
  type Preference,
} from "../ci/settings-contract/catalog.ts";
import {
  enforceBaseline,
  enforceBaselineShrink,
} from "../ci/settings-contract/check.ts";
import { settingsContractRequired } from "../../shared/enablement/ci/settings-inputs.ts";
import { sourceChecker } from "../ci/settings-contract/source.ts";
import { renderPreferenceIds } from "../ci/settings-contract/types.ts";

const picker = {
  id: "permissions.skipScreenSelection",
  label: "Skip screen selection",
  kind: "boolean",
  default: false,
  apply: "next-capture",
  legacy: { path: "experiments.chooseScreenEachTime", invert: true },
} satisfies Preference;

test("a moved control keeps its registered config ID and binds in its new pane", async () => {
  const moved = {
    ...picker,
    id: "labs.autoPasteDraft",
    pane: "handoff",
  } satisfies Preference;
  const catalog = validateCatalog([
    ["handoff/settings/preferences.json", [moved]],
  ]);
  assert.match(
    renderPreferenceIds(catalog),
    /"labs\.autoPasteDraft": "handoff"/,
  );
  const bindings: string[] = [];
  const inspect = await sourceChecker(catalog, (id) => bindings.push(id));
  const binding = 'bindPreference("handoff", "labs.autoPasteDraft", () => {});';
  assert.deepEqual(
    inspect("handoff/settings/auto-paste.tsx", binding).failures,
    [],
  );
  assert.deepEqual(bindings, [moved.id]);
  assert.match(
    inspect(
      "handoff/settings/auto-paste.tsx",
      binding.replace('"handoff"', '"labs"'),
    ).failures.join(),
    /cannot bind in labs/,
  );
});

test("catalog validates one registered ID and config path per preference", () => {
  const record = "record/settings/preferences.json";
  const onboarding = "onboarding/settings/preferences.json";
  assert.deepEqual(validateCatalog([[record, [picker]]]), [picker]);
  const general = { ...picker, id: "general.earlier", legacy: undefined };
  assert.deepEqual(
    validateCatalog([
      [record, [picker]],
      [onboarding, [general]],
    ]),
    [general, picker],
  );
  assert.throws(
    () =>
      validateCatalog([
        [record, [picker]],
        [onboarding, [picker]],
      ]),
    /claimed by/,
  );
  assert.throws(
    () =>
      validateCatalog([[record, [picker, { ...picker, id: "labs.other" }]]]),
    /claimed by/,
  );
  assert.throws(
    () =>
      validateCatalog([
        [record, [{ ...picker, legacy: { path: "permissions" } }]],
      ]),
    /overlap/,
  );
  assert.throws(
    () =>
      validateCatalog([
        [record, [{ ...picker, id: "experiments.chooseScreenEachTime" }]],
      ]),
    /ID or pane/,
  );
  assert.throws(
    () => validateCatalog([[record, [{ ...picker, default: "false" }]]]),
    /invalid default/,
  );
  assert.throws(
    () =>
      validateCatalog([[record, [{ ...picker, kind: "object", default: {} }]]]),
    /invalid legacy alias/,
  );
  assert.throws(
    () => validateCatalog([[record, [{ ...picker, choices: [true] }]]]),
    /invalid default/,
  );
});

test("production access uses declared preference IDs and the owning pane", async () => {
  const inspect = await sourceChecker([picker]);
  const path = "record/settings/permissions/settings.rs";
  const approved =
    'fn execute() { write_preference(path, "permissions.skipScreenSelection", value); }';
  assert.deepEqual(inspect(path, approved), { failures: [], raw: [] });
  assert.match(
    inspect(
      path,
      approved.replace("skipScreenSelection", "unknown"),
    ).failures.join(),
    /unknown Settings preference/,
  );
  assert.match(
    inspect("capture/desktop/settings/labs/mod.rs", approved).failures.join(),
    /cannot bind in labs/,
  );
  assert.match(
    inspect(
      "composition/settings/renderer/shell.tsx",
      'bindPreference("labs", "permissions.skipScreenSelection");',
    ).failures.join(),
    /cannot bind in labs/,
  );
  assert.match(
    inspect(
      "capture/desktop/settings/labs/mod.rs",
      `
    fn key(input: &str) { match input {
      "wrong" => Some(("permissions.skipScreenSelection", write_preference)),
      _ => None,
    }}
  `,
    ).failures.join(),
    /cannot bind in labs/,
  );
});

test("legacy access detects known direct calls, constants and nested lookup", async () => {
  const inspect = await sourceChecker([picker]);
  const path = "engine/recording/selection.rs";
  const result = inspect(
    path,
    `
    const OLD_KEY: &str = "chooseScreenEachTime";
    fn execute() {
      crate::shared::handoff::set_experiment_in(path, OLD_KEY, true);
      config["experiments"]["chooseScreenEachTime"];
      config.pointer("/experiments/chooseScreenEachTime");
      config.experiments.get(OLD_KEY).copied();
      experiment(OLD_KEY);
    }
    #[test]
    fn test_legacy() { set_experiment_in(path, OLD_KEY, true); }
  `,
  );
  assert.equal(result.failures.length, 5);
  assert.deepEqual(result.raw, [
    `${path}\texecute\tset_experiment_in\texperiments.chooseScreenEachTime`,
  ]);
  assert.match(
    inspect(
      "record/settings/example.ts",
      "const enabled = config.experiments?.chooseScreenEachTime;",
    ).failures.join(),
    /bypasses/,
  );
  assert.deepEqual(
    inspect(
      "engine/recording/select.rs",
      'fn execute() { println!("set_experiment_in(path, chooseScreenEachTime)"); }',
    ),
    { failures: [], raw: [] },
  );
});

test("raw config calls can only consume a remaining reviewed allowance", async () => {
  const inspect = await sourceChecker([picker]);
  const direct =
    'fn execute() { set_config_value_in(path, "newValue", value); }';
  const result = inspect("record/settings/write.rs", direct);
  assert.match(
    enforceBaseline(result.raw, []).join(),
    /Unregistered raw config writer/,
  );
  assert.deepEqual(enforceBaseline(result.raw, result.raw), []);
  assert.match(enforceBaseline([], result.raw).join(), /Remove superseded/);
  assert.match(enforceBaselineShrink(result.raw, []).join(), /Cannot add/);
  assert.deepEqual(enforceBaselineShrink([], result.raw), []);

  const adapter = "engine/diagnostics/performance/mod.rs";
  const transaction =
    'fn set_preference() { update_config_in(path, |config| edit_preference(config, "permissions.skipScreenSelection", value)); }';
  assert.deepEqual(inspect(adapter, transaction), { failures: [], raw: [] });
  assert.match(
    enforceBaseline(
      inspect(adapter, transaction.replace("edit_preference", "raw_edit")).raw,
      [],
    ).join(),
    /Unregistered raw config writer/,
  );

  const shortcuts = "engine/native/input/shortcut_preferences/mod.rs";
  const shortcutTransaction = `
    fn save_shortcut_in_with() {
      update_config_in(path, |config| edit_shortcut(config, value));
    }
    fn edit_shortcut(config: &mut Value, value: Value) {
      edit_preference(config, "permissions.skipScreenSelection", value);
    }
  `;
  assert.deepEqual(inspect(shortcuts, shortcutTransaction), {
    failures: [],
    raw: [],
  });
  assert.match(
    enforceBaseline(
      inspect(
        shortcuts,
        shortcutTransaction.replace("edit_preference", "raw_edit"),
      ).raw,
      [],
    ).join(),
    /Unregistered raw config writer/,
  );
});

test("catalog, UI binding, runtime, writer and guard edits select the contract", () => {
  for (const path of [
    ...catalogPaths,
    "composition/settings/renderer/shell.tsx",
    "shared/handoff/config_store.rs",
    "engine/recording/selection.rs",
    "record/settings/permissions/permission-policy.bend",
    "enablement/ci/settings-contract/check.ts",
    "enablement/local-tests/settings-contract.test.ts",
    "build.rs",
    ".github/workflows/checks.yml",
  ])
    assert.ok(settingsContractRequired([path]), path);
  assert.ok(settingsContractRequired(null));
  assert.equal(settingsContractRequired(["README.md"]), false);
});

test("a Settings binding requires a known literal in its pane and protects direct renderer writes", async () => {
  const bindings = new Set<string>();
  const inspect = await sourceChecker([picker], (id) => bindings.add(id));
  const renderer = "composition/settings/renderer/shell.tsx";
  const action = "() => window.apparentPermissions.save(false)";
  assert.match(
    inspect(renderer, action).failures.join(),
    /requires bindPreference/,
  );
  assert.match(
    inspect(renderer, `bindPreference(pane, key, ${action})`).failures.join(),
    /requires a literal pane/,
  );
  assert.match(
    inspect(
      renderer,
      `bindPreference("labs", "${picker.id}", ${action})`,
    ).failures.join(),
    /cannot bind in labs/,
  );
  assert.equal(bindings.size, 0);
  assert.deepEqual(
    inspect(
      renderer,
      `bindPreference("permissions", "${picker.id}", ${action})`,
    ).failures,
    [],
  );
  assert.deepEqual([...bindings], [picker.id]);
  assert.match(
    renderPreferenceIds([picker]),
    /"permissions\.skipScreenSelection": boolean;/,
  );
});
