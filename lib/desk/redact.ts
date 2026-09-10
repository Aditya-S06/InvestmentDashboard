const SECRET_ENV_NAMES = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY'] as const;

function replaceAll(haystack: string, needle: string, replacement: string): string {
  if (!needle) return haystack;
  return haystack.split(needle).join(replacement);
}

/** Strip API keys and env dumps from logs / error strings. Never log spawn env. */
export function redactDeskSecrets(text: string, extraSecrets: string[] = []): string {
  if (!text) return text;
  let out = text;

  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name];
    if (value) out = replaceAll(out, value, `[${name}_REDACTED]`);
  }
  for (const value of extraSecrets) {
    if (value) out = replaceAll(out, value, '[REDACTED]');
  }

  out = out.replace(
    /\b(OPENROUTER_API_KEY|OPENAI_API_KEY)\s*[=:]\s*(['"]?)[^\s'"]*\2/g,
    '$1=[REDACTED]',
  );
  out = out.replace(
    /"(OPENROUTER_API_KEY|OPENAI_API_KEY)"\s*:\s*"[^"]*"/g,
    '"$1":"[REDACTED]"',
  );
  out = out.replace(
    /'(OPENROUTER_API_KEY|OPENAI_API_KEY)'\s*:\s*'[^']*'/g,
    "'$1':'[REDACTED]'",
  );
  return out;
}
