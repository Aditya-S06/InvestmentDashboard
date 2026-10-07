// Explicit operator-owned inputs only. Never discovers/copies .env or credentials.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRIVATE_FILES = [
  'lib/insights/access.ts',
  'lib/insights/config.ts',
  'lib/insights/context-builder.ts',
  'lib/insights/orchestrator.ts',
  'lib/insights/tools.ts',
  'lib/insights/rate-limit.ts',
  'lib/insights/harness/load-harness.ts',
  'lib/insights/harness/system.md',
  'lib/insights/harness/output.md',
  'app/api/insights/access/route.ts',
  'app/api/settings/apikeys/route.ts',
];
const SKILLS = 'lib/insights/harness/skills';

function regularPath(root, relative, directory = false) {
  let target = path.resolve(root);
  if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Bundle/root must not be a symlink');
  for (const part of relative.split('/')) {
    target = path.join(target, part);
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error(`Symlinks are not supported: ${relative}`);
  }
  const stat = fs.statSync(target);
  if (directory ? !stat.isDirectory() : !stat.isFile() || stat.size === 0) {
    throw new Error(`Missing or empty prerequisite: ${relative}`);
  }
  return target;
}

export function inventoryPrivate(root) {
  const files = [...PRIVATE_FILES];
  // Flat .md skill files match the existing harness template contract.
  const skillsDir = regularPath(root, SKILLS, true);
  const skills = fs.readdirSync(skillsDir).filter(name => name.endsWith('.md') && name.toLowerCase() !== 'readme.md');
  if (!skills.length) throw new Error('Private bundle needs its original harness skills');
  files.push(...skills.sort().map(name => `${SKILLS}/${name}`));
  for (const file of files) regularPath(root, file);
  return files;
}

export function checkPrivate(root) {
  const files = inventoryPrivate(root);
  for (const file of files.filter(name => name.endsWith('.ts'))) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    if (/\bTODO\b|Copy (?:this file )?to |Copy this file to /i.test(content)) {
      throw new Error(`Unfinished template: ${file}; supply the operator's implemented module`);
    }
  }
  return files;
}

export function provisionPrivate(root, source) {
  const files = checkPrivate(source);
  // Preflight every destination before writing; never replace existing private work.
  for (const file of files) {
    let parent = path.resolve(root);
    if (fs.lstatSync(parent).isSymbolicLink()) throw new Error('Target root must not be a symlink');
    for (const part of file.split('/').slice(0, -1)) {
      parent = path.join(parent, part);
      if (fs.lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Symlink destination: ${file}`);
    }
    if (fs.lstatSync(path.join(root, file), { throwIfNoEntry: false })) throw new Error(`Refusing to overwrite: ${file}`);
  }
  for (const file of files) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, file), target, fs.constants.COPYFILE_EXCL);
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, source, ...extra] = process.argv.slice(2);
    if (extra.length || !((mode === '--check' && !source) || (mode === '--from' && source))) {
      throw new Error('Usage: node scripts/provision-private.mjs --check | --from <private-bundle-directory>');
    }
    const files = mode === '--check' ? checkPrivate(process.cwd()) : provisionPrivate(process.cwd(), path.resolve(source));
    console.log(`Private prerequisites: ${files.length} files present. Presence/template checks only; validate operator behavior separately.`);
  } catch (error) {
    // Do not print file contents, environment values or stack traces.
    console.error(error.code ? `Private prerequisite filesystem error (${error.code}); see README provisioning instructions.` : error.message);
    process.exitCode = 1;
  }
}
