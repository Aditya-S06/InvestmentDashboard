import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

function routes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? routes(path.join(dir, entry.name)) : entry.name === 'route.ts' ? [path.join(dir, entry.name)] : []);
}
it('keeps every custom mutation export behind the shared request guard', () => {
  const failures: string[] = [];
  let protectedRoutes = 0;
  const methods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  for (const file of routes('app/api')) {
    if (file.includes(path.join('api', 'auth'))) continue; // NextAuth validates its own CSRF tokens.
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const exported of statement.exportClause.elements) if (methods.has(exported.name.text)) {
          if (statement.moduleSpecifier?.getText(source) !== "'@/lib/security/api-key-routes'") failures.push(file);
          else protectedRoutes++;
        }
      }
      if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (ts.isFunctionDeclaration(statement) && statement.name && methods.has(statement.name.text)) failures.push(file);
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (!methods.has(declaration.name.getText(source))) continue;
        if (!declaration.initializer || !ts.isCallExpression(declaration.initializer)
          || declaration.initializer.expression.getText(source) !== 'withMutationProtection') failures.push(file);
        else protectedRoutes++;
      }
    }
  }
  expect(failures).toEqual([]);
  expect(protectedRoutes).toBeGreaterThan(25);
});
