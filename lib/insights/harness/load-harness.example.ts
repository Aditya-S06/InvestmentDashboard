/**
 * Copy to load-harness.ts and customize prompt assembly.
 * load-harness.ts is gitignored and never committed.
 */
import 'server-only';

import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { InsightContext } from '../types';

const HARNESS_DIR = path.join(process.cwd(), 'lib', 'insights', 'harness');

export interface BuildSystemPromptOptions {
  /** Inject watchlist + snapshot into the system prompt. Default false. */
  includeWatchlist?: boolean;
}

export async function buildSystemPrompt(
  context: InsightContext,
  options: BuildSystemPromptOptions = {},
): Promise<string> {
  const includeWatchlist = options.includeWatchlist === true;
  const [system, output, skills] = await Promise.all([
    readHarnessFile('system.md'),
    readHarnessFile('output.md'),
    loadSkillFiles(),
  ]);

  const dashboardContext = includeWatchlist
    ? {
        watchlist: context.groupedWatchlist,
        macro: context.macro,
        watchlistSnapshot: context.watchlistSnapshot,
        watchlistAccess: 'enabled',
      }
    : {
        macro: context.macro,
        watchlistAccess: 'disabled_until_explicit_user_request',
        note: 'Do not call get_user_watchlist unless the user explicitly asks.',
      };

  const sections = [
    system,
    output ? `## Output formatting\n\n${output}` : '',
    skills ? `## Domain skills\n\n${skills}` : '',
    '## Current dashboard context',
    JSON.stringify(dashboardContext, null, 2),
  ].filter(Boolean);

  return sections.join('\n\n');
}

async function readHarnessFile(filename: string): Promise<string> {
  try {
    return (await readFile(path.join(HARNESS_DIR, filename), 'utf8')).trim();
  } catch {
    return '';
  }
}

async function loadSkillFiles(): Promise<string> {
  const skillsDir = path.join(HARNESS_DIR, 'skills');
  try {
    const entries = await readdir(skillsDir);
    const files = entries.filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md').sort();
    if (files.length === 0) return '';

    const contents = await Promise.all(
      files.map(async (file) => {
        const body = (await readFile(path.join(skillsDir, file), 'utf8')).trim();
        return body ? `### Skill: ${file.replace(/\.md$/i, '')}\n\n${body}` : '';
      }),
    );

    return contents.filter(Boolean).join('\n\n');
  } catch {
    return '';
  }
}
