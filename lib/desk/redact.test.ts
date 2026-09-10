import { afterEach, describe, expect, it } from 'vitest';
import { redactDeskSecrets } from '@/lib/desk/redact';

describe('redactDeskSecrets', () => {
  const previousOpenRouter = process.env.OPENROUTER_API_KEY;
  const previousOpenAi = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (previousOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouter;
    if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAi;
  });

  it('redacts env values and assignment dumps', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-secret-value';
    process.env.OPENAI_API_KEY = 'sk-openai-secret';

    const text = [
      'failed sk-or-secret-value',
      'OPENROUTER_API_KEY=sk-or-other',
      'OPENAI_API_KEY: sk-openai-secret',
      '{"OPENROUTER_API_KEY":"dumped"}',
    ].join('\n');

    const redacted = redactDeskSecrets(text);
    expect(redacted).not.toContain('sk-or-secret-value');
    expect(redacted).not.toContain('sk-openai-secret');
    expect(redacted).not.toContain('sk-or-other');
    expect(redacted).not.toContain('dumped');
    expect(redacted).toContain('[OPENROUTER_API_KEY_REDACTED]');
    expect(redacted).toContain('OPENROUTER_API_KEY=[REDACTED]');
  });

  it('redacts extra secrets such as a per-user OpenRouter key', () => {
    const redacted = redactDeskSecrets('Authorization Bearer user-key-123456', ['user-key-123456']);
    expect(redacted).not.toContain('user-key-123456');
    expect(redacted).toContain('[REDACTED]');
  });
});
