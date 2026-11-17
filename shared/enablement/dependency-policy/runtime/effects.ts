import type { Edge } from "./contexts.ts";
import { domUse, nodeUse } from "./dom.ts";
import { context } from "./contexts.ts";
import ts from "typescript";
import { Snapshot, root, source, owner } from "../snapshot.ts";

export function effects(
  snapshot: Snapshot,
  pureErrors?: Set<string>,
  globals?: Edge[],
): Map<string, number> {
  const files = [...snapshot.files.keys()].filter((file) => source.test(file));
  const host: ts.CompilerHost = {
    ...snapshot.host,
    useCaseSensitiveFileNames: () => true,
    getSourceFile: (file, language) => {
      const text = snapshot.host.readFile(file);
      return text === undefined
        ? undefined
        : ts.createSourceFile(file, text, language, true);
    },
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCanonicalFileName: (file) => file,
    getNewLine: () => "\n",
    resolveModuleNames: (names, file) =>
      names.map(
        (name) =>
          ts.resolveModuleName(
            name,
            file,
            snapshot.options(snapshot.canonical(file)),
            snapshot.host,
          ).resolvedModule,
      ),
  };
  const program = ts.createProgram(
    files.map((file) => root + "/" + file),
    { allowJs: true, noLib: true },
    host,
  );
  const checker = program.getTypeChecker();
  const result = new Map<string, number>();
  function provenance(
    node: ts.Node,
    seen = new Set<ts.Node>(),
  ): string | undefined {
    if (seen.has(node)) return;
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return provenance(node.expression, seen);
    seen.add(node);
    if (ts.isAwaitExpression(node)) return provenance(node.expression, seen);
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression) &&
      node.moduleReference.expression.text === "react"
    )
      return "react";
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "react"
    )
      return "react";
    if (ts.isExportSpecifier(node)) {
      const declaration = node.parent.parent;
      if (
        declaration.moduleSpecifier &&
        ts.isStringLiteral(declaration.moduleSpecifier) &&
        declaration.moduleSpecifier.text === "react"
      )
        return (node.propertyName ?? node.name).text === "useEffect"
          ? "effect"
          : (node.propertyName ?? node.name).text === "default"
            ? "react"
            : undefined;
      return provenance(node.propertyName ?? node.name, seen);
    }
    if (ts.isImportSpecifier(node)) {
      const declaration = node.parent.parent.parent;
      if (
        ts.isStringLiteral(declaration.moduleSpecifier) &&
        declaration.moduleSpecifier.text === "react"
      )
        return (node.propertyName ?? node.name).text === "useEffect"
          ? "effect"
          : (node.propertyName ?? node.name).text === "default"
            ? "react"
            : undefined;
      const target = ts.resolveModuleName(
        declaration.moduleSpecifier.text,
        declaration.getSourceFile().fileName,
        snapshot.options(
          snapshot.canonical(declaration.getSourceFile().fileName),
        ),
        snapshot.host,
      ).resolvedModule;
      const module = target && program.getSourceFile(target.resolvedFileName);
      if (module) {
        const symbol = checker.getSymbolAtLocation(module);
        const exported =
          symbol &&
          checker
            .getExportsOfModule(symbol)
            .find(
              (symbol) => symbol.name === (node.propertyName ?? node.name).text,
            );
        for (const declaration of exported?.declarations ?? []) {
          const found = provenance(declaration, seen);
          if (found) return found;
        }
      }
    }
    if (ts.isImportClause(node) || ts.isNamespaceImport(node)) {
      const declaration = ts.isImportClause(node)
        ? node.parent
        : node.parent.parent;
      if (
        ts.isStringLiteral(declaration.moduleSpecifier) &&
        declaration.moduleSpecifier.text === "react"
      )
        return "react";
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression && ts.isStringLiteral(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined;
      if (name === "useEffect" && provenance(node.expression, seen) === "react")
        return "effect";
    }
    if (ts.isVariableDeclaration(node) && node.initializer)
      return provenance(node.initializer, seen);
    if (
      ts.isBindingElement(node) &&
      ts.isVariableDeclaration(node.parent.parent) &&
      node.parent.parent.initializer
    ) {
      const name = node.propertyName ?? node.name;
      if (
        name.getText() === "useEffect" &&
        provenance(node.parent.parent.initializer, seen) === "react"
      )
        return "effect";
    }
    if (ts.isIdentifier(node)) {
      let symbol = checker.getSymbolAtLocation(node);
      if (symbol) {
        for (const declaration of symbol.declarations ?? []) {
          const found = provenance(declaration, seen);
          if (found) return found;
        }
        if (symbol.flags & ts.SymbolFlags.Alias) {
          symbol = checker.getAliasedSymbol(symbol);
          for (const declaration of symbol.declarations ?? []) {
            const found = provenance(declaration, seen);
            if (found) return found;
          }
        }
      }
    }
  }
  for (const file of program.getSourceFiles()) {
    const name = snapshot.canonical(file.fileName);
    if (!owner(name)) continue;
    function visit(node: ts.Node) {
      if (globals) {
        const dom = domUse(node, checker);
        if (dom) globals.push({ from: name, spec: "dom:global/" + dom });
        const violation = nodeUse(node, checker);
        if (violation)
          globals.push({ from: name, spec: "node:global/" + violation });
      }
      if (pureErrors && context(name) === "pure") {
        const violation = domUse(node, checker);
        if (violation)
          pureErrors.add(name + ": pure logic uses DOM global " + violation);
      }
      if (
        provenance(node) === "effect" &&
        ((ts.isCallExpression(node.parent) &&
          node.parent.expression === node) ||
          ts.isIdentifier(node) ||
          ts.isImportSpecifier(node) ||
          ts.isExportSpecifier(node) ||
          ts.isVariableDeclaration(node) ||
          ts.isBindingElement(node) ||
          ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node))
      ) {
        let statement = node;
        while (
          statement.parent &&
          !ts.isSourceFile(statement.parent) &&
          !ts.isBlock(statement.parent)
        )
          statement = statement.parent;
        const key = name + ":" + statement.getText(file);
        result.set(key, (result.get(key) ?? 0) + 1);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  return result;
}
