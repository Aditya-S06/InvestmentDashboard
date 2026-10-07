/** Explicit runtime support only; never forward arbitrary Python/Node loader settings. */
const RUNTIME_KEYS = [
  // Executable/DLL lookup, home/cache directories, and temporary files.
  'PATH', 'SystemRoot', 'WINDIR', 'COMSPEC',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'TMPDIR', 'TMP', 'TEMP',
  // Python text streams and date/locale behavior.
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'PYTHONIOENCODING', 'PYTHONUTF8', 'PYTHONUNBUFFERED',
  // All children use HTTP. Proxy URLs may contain required proxy credentials.
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
] as const;

export function runtimeEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  // Next's ambient types require NODE_ENV, but this is a Python environment.
  const env = {} as NodeJS.ProcessEnv;
  for (const key of RUNTIME_KEYS) {
    // Windows environment names are case-insensitive (Path, SYSTEMROOT, etc.).
    // Emit one spelling so Node cannot select a different duplicate at spawn.
    if (platform === 'win32' && Object.keys(env).some((name) => name.toLowerCase() === key.toLowerCase())) continue;
    const sourceKey = platform === 'win32'
      ? Object.keys(source).find((name) => name.toLowerCase() === key.toLowerCase())
      : key;
    const value = sourceKey === undefined ? undefined : source[sourceKey];
    if (value !== undefined) env[key] = value;
  }
  // A library import must not refill the environment from the application's .env.
  env.PYTHON_DOTENV_DISABLED = '1';
  return env;
}
