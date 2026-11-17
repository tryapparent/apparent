import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";

const library = ts.createSourceFile(
  "lib.dom.d.ts",
  readFileSync(
    new URL("../node_modules/typescript/lib/lib.dom.d.ts", import.meta.url),
    "utf8",
  ),
  ts.ScriptTarget.Latest,
  true,
);
const names = new Set<string>();
for (const statement of library.statements) {
  if (ts.isVariableStatement(statement))
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)) &&
    statement.name
  )
    names.add(statement.name.text);
}
const privileged = new Set([
  "process",
  "Buffer",
  "require",
  "__filename",
  "__dirname",
  "global",
]);
export const domUse = (node: ts.Node, checker: ts.TypeChecker) =>
  globalUse(node, checker, names);
export const nodeUse = (node: ts.Node, checker: ts.TypeChecker) =>
  globalUse(node, checker, privileged);
function globalUse(
  node: ts.Node,
  checker: ts.TypeChecker,
  inventory: Set<string>,
): string | undefined {
  if (!ts.isIdentifier(node) || !inventory.has(node.text)) return;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    if (
      !ts.isIdentifier(parent.expression) ||
      parent.expression.text !== "globalThis" ||
      checker.getSymbolAtLocation(parent.expression)?.declarations?.length
    )
      return;
  }
  if (ts.isPropertyAssignment(parent) && parent.name === node) return;
  const symbol = ts.isShorthandPropertyAssignment(parent)
    ? checker.getShorthandAssignmentValueSymbol(parent)
    : checker.getSymbolAtLocation(node);
  if (symbol?.declarations?.length) return;
  let statement = node;
  while (
    statement.parent &&
    !ts.isSourceFile(statement.parent) &&
    !ts.isBlock(statement.parent)
  )
    statement = statement.parent;
  return (
    node.text +
    ":" +
    createHash("sha256").update(statement.getText()).digest("hex")
  );
}
