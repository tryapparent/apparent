import {
  preferenceParsers,
  type TreeNode,
} from "../../../shared/enablement/dependency-policy/runtime/preference-syntax.ts";
import type { Preference } from "./catalog.ts";

const rawWrites = new Set([
  "set_config_value_in",
  "set_experiment_in",
  "update_config_in",
  "update_config_allowed_in",
]);
const preferenceCalls = new Set([
  "read_preference",
  "preference_value",
  "write_preference",
  "edit_preference",
  "preference_state",
  "experiment_preference",
  "experiment_preference_in",
  "bindPreference",
]);
const rendererBridgeWriters = new Map([
  [
    "capture/desktop/ui/frontend/src/settings/labs/labs.tsx",
    "window.apparentLabs.save",
  ],
  [
    "capture/desktop/ui/frontend/src/settings/agents/agents.tsx",
    "window.apparentAgents.save",
  ],
]);

function boundAction(node: TreeNode): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      parent.type === "call_expression" &&
      nameOf(component(parent, "function")) === "bindPreference"
    )
      return true;
  }
  return false;
}

const experimentReads = new Set(["experiment", "experiment_enabled_in"]);
const component = (node: TreeNode | null, key: string) =>
  node?.childForFieldName(key);
const present = (node: TreeNode | null): node is TreeNode => node !== null;
const descendants = (node: TreeNode, types: string | string[]) =>
  node.descendantsOfType(types).filter(present);
const mutatorOwners = new Set(["shared/handoff/config_store.rs"]);
const compatibilityReaders = new Set([
  "shared/handoff/config_store.rs",
  "shared/handoff/mod.rs",
]);
const ownerTransactions = new Map([
  ["capture/desktop/settings/mod.rs:save_launch_at_login", "edit_preference"],
  [
    "capture/desktop/workflow/error_reporting.rs:set_enabled_admitted_in",
    "edit_preference",
  ],
  [
    "capture/desktop/workflow/storage_preferences.rs:update_policy",
    "edit_preference",
  ],
  ["composition/retention/mod.rs:set_preference", "edit_preference"],
  ["engine/diagnostics/performance/mod.rs:set_preference", "edit_preference"],
  [
    "engine/native/input/shortcut_preferences/mod.rs:save_shortcut_in_with",
    "edit_shortcut",
  ],
  [
    "engine/native/input/shortcut_preferences/mod.rs:set_shortcut_for_cli",
    "edit_shortcut",
  ],
  ["engine/recording/preferences/mod.rs:save", "edit_preference"],
  ["shared/handoff/capture_location.rs:set_in", "edit_preference"],
]);

function literal(node: TreeNode | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "raw_string_literal")
    return node.namedChildren.find((child) => child?.type === "string_content")
      ?.text;
  if (!["string_literal", "string", "template_string"].includes(node.type))
    return undefined;
  if (/^"[^"\\]*"$|^'[^'\\]*'$|^`[^`\\$]*`$/.test(node.text))
    return node.text.slice(1, -1);
  return undefined;
}

function isTest(node: TreeNode) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type !== "function_item" && parent.type !== "mod_item") continue;
    if (
      parent.type === "mod_item" &&
      /^(test|tests|test_support)$/.test(component(parent, "name")?.text ?? "")
    )
      return true;
    for (
      let previous = parent.previousNamedSibling;
      previous?.type === "attribute_item";
      previous = previous.previousNamedSibling
    ) {
      if (/^#\[\s*(?:test\b|cfg\s*\(\s*test\s*\))/.test(previous.text))
        return true;
    }
  }
  return false;
}

function nameOf(node: TreeNode | null | undefined): string | undefined {
  if (!node) return undefined;
  if (
    ["identifier", "property_identifier", "field_identifier"].includes(
      node.type,
    )
  )
    return node.text;
  return (
    component(node, "field")?.text ??
    component(node, "name")?.text ??
    component(node, "property")?.text
  );
}

function calls(node: TreeNode, name: string): boolean {
  return descendants(node, "call_expression").some(
    (call) => nameOf(component(call, "function")) === name,
  );
}

function ownerTransaction(
  root: TreeNode,
  call: TreeNode,
  path: string,
  owner: string,
): boolean {
  const editor = ownerTransactions.get(`${path}:${owner}`);
  if (!editor || !calls(call, editor)) return false;
  if (editor === "edit_preference") return true;
  const helper = descendants(root, "function_item").find(
    (item) => component(item, "name")?.text === editor && !isTest(item),
  );
  return helper !== undefined && calls(helper, "edit_preference");
}

function containingFunction(node: TreeNode) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ["function_item", "function_declaration", "method_definition"].includes(
        parent.type,
      )
    )
      return component(parent, "name")?.text ?? "<anonymous>";
  }
  return "<module>";
}

function guardedPaths(preferences: readonly Preference[]) {
  const known = new Map(
    preferences.map(({ id, pane }) => [id, pane ?? id.split(".")[0]]),
  );
  const aliases = new Map(
    preferences.flatMap(({ id, legacy }) =>
      legacy ? [[legacy.path, id] as const] : [],
    ),
  );
  return { known, aliases };
}

export async function sourceChecker(
  preferences: readonly Preference[],
  onBinding?: (id: string) => void,
) {
  const parsers = await preferenceParsers();
  const { known, aliases } = guardedPaths(preferences);
  const needles = [
    ...rawWrites,
    ...preferenceCalls,
    ...experimentReads,
    ...[...aliases.keys()]
      .filter((path) => path.includes("."))
      .map((path) => path.slice(path.lastIndexOf(".") + 1)),
  ];
  return (
    path: string,
    source: string,
  ): { failures: string[]; raw: string[] } => {
    if (
      !source.includes("window.apparent") &&
      !needles.some((needle) => source.includes(needle))
    )
      return { failures: [], raw: [] };
    const language = path.endsWith(".rs")
      ? "rs"
      : path.endsWith(".tsx")
        ? "tsx"
        : /\.[cm]?ts$/.test(path)
          ? "typescript"
          : "javascript";
    const parser = parsers.get(language);
    if (!parser) throw Error(`Missing ${language} syntax parser`);
    let tree = parser.parse(source);
    if (language === "rs" && tree?.rootNode.hasError) {
      const fallback = parsers.get("rsFallback")?.parse(source);
      if (fallback && !fallback.rootNode.hasError) {
        tree.delete();
        tree = fallback;
      } else fallback?.delete();
    }
    if (!tree) throw Error(`${path}: syntax parser returned no source tree`);
    const failures = new Set<string>();
    const raw: string[] = [];
    try {
      const root = tree.rootNode;
      const constants = new Map<string, string | null>();
      for (const node of descendants(root, [
        "const_item",
        "variable_declarator",
      ])) {
        const key = component(node, "name")?.text;
        const value = literal(component(node, "value"));
        if (key && value !== undefined)
          constants.set(key, constants.has(key) ? null : value);
      }
      const resolveKey = (node: TreeNode | null | undefined) =>
        literal(node) ?? constants.get(nameOf(node) ?? "") ?? undefined;
      const location = (node: TreeNode) =>
        `${path}:${node.startPosition.row + 1}`;
      const aliasUse = (node: TreeNode, key: string | undefined) => {
        if (key && aliases.has(key) && !compatibilityReaders.has(path))
          failures.add(
            `${location(node)}: legacy path ${key} bypasses ${aliases.get(key)}`,
          );
      };
      const expectedPane = path.match(/\/(labs|agents|permissions)\//)?.[1];
      const checkId = (node: TreeNode, id: string, pane?: string) => {
        if (!known.has(id))
          failures.add(`${location(node)}: unknown Settings preference ${id}`);
        else if (pane && known.get(id) !== pane)
          failures.add(`${location(node)}: ${id} cannot bind in ${pane}`);
      };
      if (path === "capture/desktop/settings/labs/mod.rs") {
        for (const binding of descendants(root, "match_arm")) {
          if (containingFunction(binding) !== "key") continue;
          const action = binding.childForFieldName("value");
          if (!action) continue;
          for (const target of [
            action,
            ...descendants(action, ["string_literal", "identifier"]),
          ]) {
            const id = resolveKey(target);
            if (id?.includes(".")) checkId(target, id, "labs");
          }
        }
      }
      for (const call of descendants(root, "call_expression")) {
        if (isTest(call)) continue;
        const target = component(call, "function");
        const name = nameOf(target);
        if (!name) continue;
        const args =
          component(call, "arguments")
            ?.namedChildren.filter(present)
            .filter((child) => !child.type.endsWith("comment")) ?? [];
        const first = resolveKey(args[0]);
        const second = resolveKey(args[1]);
        const rendererWrite = target?.text.replaceAll("?", "");
        if (
          !path.endsWith(".rs") &&
          rendererWrite &&
          /^window\.apparent\w*\.(?:save|change|reset)\w*\.?$/.test(
            rendererWrite,
          ) &&
          rendererBridgeWriters.get(path) !== rendererWrite &&
          !boundAction(call)
        ) {
          failures.add(
            `${location(call)}: Settings bridge write requires bindPreference`,
          );
        }
        if (name === "bindPreference") {
          if (!first || !second || !args[2]) {
            failures.add(
              `${location(call)}: bindPreference requires a literal pane, preference ID and action`,
            );
          }
          if (second) checkId(call, second, expectedPane ?? first);
          if (first && expectedPane && first !== expectedPane)
            failures.add(
              `${location(call)}: cannot declare a ${first} binding in ${expectedPane}`,
            );
          if (first && second && args[2] && known.get(second) === first) {
            onBinding?.(second);
          }
        } else if (preferenceCalls.has(name)) {
          const id = name === "experiment_preference" ? first : second;
          if (id) checkId(call, id, expectedPane);
        }
        if (rawWrites.has(name) && !mutatorOwners.has(path)) {
          const owner = containingFunction(call);
          if (
            (name === "update_config_in" ||
              name === "update_config_allowed_in") &&
            ownerTransaction(root, call, path, owner)
          )
            continue;
          const key =
            name === "set_experiment_in" && second
              ? `experiments.${second}`
              : second;
          if (name === "set_config_value_in" || name === "set_experiment_in")
            aliasUse(call, key);
          raw.push(
            `${path}\t${owner}\t${name}\t${name === "set_config_value_in" || name === "set_experiment_in" ? (key ?? "<computed>") : "<transaction>"}`,
          );
        }
        if (experimentReads.has(name)) {
          const key = name === "experiment" ? first : second;
          if (key) aliasUse(call, `experiments.${key}`);
        }
        if (name === "pointer" && first?.startsWith("/"))
          aliasUse(call, first.slice(1).replaceAll("/", "."));
        if (name === "get" && first) {
          const receiver =
            component(target ?? null, "value") ??
            component(target ?? null, "object");
          const group =
            nameOf(receiver) ??
            (receiver?.type === "index_expression"
              ? resolveKey(receiver.lastNamedChild)
              : undefined);
          if (group) aliasUse(call, `${group}.${first}`);
        }
      }
      for (const field of descendants(root, [
        "index_expression",
        "member_expression",
        "subscript_expression",
      ])) {
        if (isTest(field)) continue;
        const left = component(field, "object") ?? field.firstNamedChild;
        if (
          !left ||
          ![
            "index_expression",
            "field_expression",
            "member_expression",
            "subscript_expression",
          ].includes(left.type)
        )
          continue;
        const right = component(field, "property") ?? field.lastNamedChild;
        const group = nameOf(left) ?? resolveKey(left.lastNamedChild);
        const key =
          right?.type === "property_identifier"
            ? right.text
            : resolveKey(right);
        if (group && key) aliasUse(field, `${group}.${key}`);
      }
      return { failures: [...failures], raw };
    } finally {
      tree.delete();
    }
  };
}
