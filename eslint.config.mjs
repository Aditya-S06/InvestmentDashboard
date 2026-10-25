import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    '.next/**', '.build/**', 'build/**', 'dist/**', 'out/**', 'coverage/**',
    '.tmp/**', '.venv/**', '.data/**', 'node_modules/**', 'TradingAgents/**',
    'project_oracle_v.5/**', 'lib/insights/harness/**', 'next-env.d.ts',
    '**/.env', '**/.env.*', '**/*.env', '**/secrets/**', '**/credentials.json',
    '**/secrets.json', 'conf/**', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx',
  ]),
]);
