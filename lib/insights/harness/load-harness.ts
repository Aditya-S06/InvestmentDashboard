import 'server-only';

import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { InsightContext } from '../types';

const HARNESS_DIR = path.join(process.cwd(), 'lib', 'insights', 'harness');

export async function buildSystemPrompt(context: InsightContext): Promise<string> {
  const [system, output, skills] = await Promise.all([
    readHarnessFile('system.md'),
    readHarnessFile('output.md'),
    loadSkillFiles(),
  ]);

  const sections = [
    system,
    output ? `## Output formatting\n\n${output}` : '',
    skills ? `## Domain skills\n\n${skills}` : '',
    '## Current dashboard context',
    JSON.stringify(
      {
        watchlist: context.groupedWatchlist,
        macro: context.macro,
        watchlistSnapshot: context.watchlistSnapshot,
      },
      null,
      2,
    ),
    'If the user asks for high-potential stocks, research enough to return 5-10 picks when possible. Include whether each pick is already in the watchlist.',
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
