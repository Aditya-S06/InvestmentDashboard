import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const source = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

function loadOperatorFactory(environment = {}) {
  const adapters = [];
  const clients = [];
  class PrismaPg {
    constructor(options) { this.options = options; adapters.push(this); }
  }
  class PrismaClient {
    constructor(options) { this.options = options; clients.push(this); }
  }
  const context = {
    module: { exports: {} }, process: { env: environment },
    require(name) {
      if (name === '@prisma/client') return { PrismaClient };
      if (name === '@prisma/adapter-pg') return { PrismaPg };
      throw new Error(`Unexpected module: ${name}`);
    },
  };
  vm.runInNewContext(source('scripts/prisma-client.cjs'), context);
  return { create: context.module.exports.createPrismaClient, adapters, clients };
}

test('operator clients reject missing URLs before constructing a driver', () => {
  const factory = loadOperatorFactory();
  assert.throws(() => factory.create(), /Database connection URL is required/);
  assert.equal(factory.adapters.length, 0);
  assert.equal(factory.clients.length, 0);
});

test('operator clients use the requested role without disabling TLS checks', () => {
  const runtime = 'postgresql://runtime@127.0.0.1:1/sentinel';
  const identity = 'postgresql://identity@127.0.0.1:1/sentinel';
  const factory = loadOperatorFactory({ DATABASE_URL: runtime });
  const defaultClient = factory.create();
  const identityClient = factory.create(identity);
  assert.equal(defaultClient.options.adapter.options.connectionString, runtime);
  assert.equal(identityClient.options.adapter.options.connectionString, identity);
  assert.equal(identityClient.options.adapter.options.connectionTimeoutMillis, 5000);
  assert.equal('ssl' in identityClient.options.adapter.options, false);
});

test('Prisma CLI, adapter and client stay on one stable release', () => {
  const manifest = JSON.parse(source('package.json'));
  assert.equal(manifest.dependencies['@prisma/client'], manifest.devDependencies.prisma);
  assert.equal(manifest.dependencies['@prisma/adapter-pg'], manifest.devDependencies.prisma);
  assert.match(manifest.devDependencies.prisma, /^\d+\.\d+\.\d+$/);
});

test('Next and React dependency pairs stay aligned', () => {
  const manifest = JSON.parse(source('package.json'));
  assert.equal(manifest.dependencies.next, manifest.devDependencies['eslint-config-next']);
  assert.equal(manifest.dependencies.react, manifest.dependencies['react-dom']);
  assert.equal(manifest.devDependencies.tailwindcss, manifest.devDependencies['@tailwindcss/postcss']);
  assert.equal(manifest.scripts.dev, 'next dev --webpack');
  assert.match(manifest.scripts.build, /next build --webpack$/);
});

test('Prisma generation config does not automatically open dotenv files', () => {
  const config = source('prisma.config.ts');
  assert.doesNotMatch(config, /import\s+['"]dotenv\/config|\.config\s*\(|readFile/);
  assert.match(config, /process\.env\.DIRECT_URL \|\| process\.env\.DATABASE_URL/);
  const schema = source('prisma/schema.prisma');
  assert.doesNotMatch(schema, /\b(?:url|directUrl)\s*=\s*env\(/);
});

test('test runner has its Vite peer and TypeScript stays within parser support', () => {
  const manifest = JSON.parse(source('package.json'));
  assert.equal(manifest.devDependencies.vite, '^8.0.0');
  assert.equal(manifest.devDependencies.typescript, '>=5.2.2 <6.1.0');
});

test('unit tests transform JSX without changing the Next compiler configuration', () => {
  const config = source('vitest.config.ts');
  assert.match(config, /envDir:\s*false/);
  assert.match(config, /oxc:\s*\{\s*jsx:\s*\{\s*runtime:\s*'automatic'/);
  assert.equal(JSON.parse(source('tsconfig.json')).compilerOptions.jsx, 'preserve');
});

test('checkpoint fixture derives versioned budgets from the production policy', () => {
  const fixture = source('test/desk_fixture_checkpoint.py');
  assert.match(fixture, /from desk_policy import config_policy/);
  assert.match(fixture, /settings = dict\(config_policy\(value\['depth'\]\)/);
  assert.doesNotMatch(fixture, /desk_policy_version\s*=\s*\d/);
});

test('Tailwind only discovers classes in the declared UI sources', () => {
  const stylesheet = source('app/globals.css');
  assert.match(stylesheet, /@import "tailwindcss" source\(none\);/);
  assert.match(stylesheet, /@source "\.\.\/app";/);
  assert.match(stylesheet, /@source "\.\.\/components";/);
  assert.match(source('postcss.config.js'), /'@tailwindcss\/postcss'/);
});

test('upgraded UI exports and Array.at typecheck with the project compiler options', async () => {
  const { default: typescript } = await import('typescript');
  const config = JSON.parse(source('tsconfig.json'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const filename = fileURLToPath(new URL('./dependency-type-contract.tsx', import.meta.url)).replaceAll('\\', '/');
  const converted = typescript.convertCompilerOptionsFromJson(config.compilerOptions, root);
  assert.deepEqual(converted.errors, []);
  const options = { ...converted.options, incremental: false };
  const contract = `
    import { SquarePlay } from 'lucide-react';
    import type { ThemeProviderProps } from 'next-themes';
    import { ThemeProvider } from '../components/theme-provider';
    const props: ThemeProviderProps = { children: null, nonce: 'test-nonce' };
    const theme = <ThemeProvider {...props} />;
    const icon = <SquarePlay aria-hidden />;
    const last: number | undefined = [1, 2].at(-1);
  `;
  const host = typescript.createCompilerHost(options);
  const originalFileExists = host.fileExists.bind(host);
  host.fileExists = requested => requested.replaceAll('\\', '/') === filename || originalFileExists(requested);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (requested, languageVersion, onError, shouldCreateNewSourceFile) =>
    requested.replaceAll('\\', '/') === filename
      ? typescript.createSourceFile(filename, contract, languageVersion, true, typescript.ScriptKind.TSX)
      : originalGetSourceFile(requested, languageVersion, onError, shouldCreateNewSourceFile);
  const program = typescript.createProgram([filename], options, host);
  const diagnostics = typescript.getPreEmitDiagnostics(program).map(diagnostic =>
    typescript.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  assert.deepEqual(diagnostics, []);
});
