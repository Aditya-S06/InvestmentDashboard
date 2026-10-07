import { describe, expect, it } from 'vitest';
import { runtimeEnv } from './subprocess-env';

describe('runtime environment allowlist', () => {
  it('keeps Linux runtime settings and rejects credentials and loader injection', () => {
    const source = {
      PATH: '/test/bin', HOME: '/test/home', TMPDIR: '/test/tmp', XDG_CACHE_HOME: '/test/cache',
      LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', LC_CTYPE: 'C.UTF-8', TZ: 'UTC',
      SSL_CERT_FILE: '/test/ca.pem', SSL_CERT_DIR: '/test/certs',
      REQUESTS_CA_BUNDLE: '/test/ca.pem', CURL_CA_BUNDLE: '/test/ca.pem',
      https_proxy: 'http://proxy.test:8080', NO_PROXY: 'localhost',
      PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1',
    };
    const env = runtimeEnv({
      ...source, DATABASE_URL: 'sentinel-db', DIRECT_URL: 'sentinel-direct',
      NEXTAUTH_SECRET: 'sentinel-auth', WEBULL_APP_SECRET: 'sentinel-broker',
      OPENROUTER_API_KEY: 'sentinel-router', YOUTUBE_API_KEY: 'sentinel-youtube',
      OPENAI_API_KEY: 'sentinel-openai', AWS_SECRET_ACCESS_KEY: 'sentinel-aws',
      FUTURE_SECRET: 'sentinel-future', PYTHONPATH: '/untrusted', PYTHONHOME: '/untrusted',
      NODE_OPTIONS: '--require=untrusted', PYTHON_DOTENV_DISABLED: '0',
    }, 'linux');
    expect(env).toEqual({ ...source, PYTHON_DOTENV_DISABLED: '1' });
  });

  it('normalizes Windows casing without duplicate names', () => {
    expect(runtimeEnv({
      Path: 'C:\\test\\bin', SYSTEMROOT: 'C:\\Windows', windir: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe', Temp: 'C:\\test\\tmp',
      userprofile: 'C:\\test\\user', APPDATA: 'C:\\test\\roaming',
      LOCALAPPDATA: 'C:\\test\\local', HOMEDRIVE: 'C:', HOMEPATH: '\\test\\user',
      https_proxy: 'http://proxy.test:8080', nextauth_secret: 'sentinel-auth',
    }, 'win32')).toEqual({
      PATH: 'C:\\test\\bin', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows',
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe', TEMP: 'C:\\test\\tmp',
      USERPROFILE: 'C:\\test\\user', APPDATA: 'C:\\test\\roaming',
      LOCALAPPDATA: 'C:\\test\\local', HOMEDRIVE: 'C:', HOMEPATH: '\\test\\user',
      HTTPS_PROXY: 'http://proxy.test:8080', PYTHON_DOTENV_DISABLED: '1',
    });
  });

  it('does not fall back to parent values for an empty source', () => {
    expect(runtimeEnv({}, 'linux')).toEqual({ PYTHON_DOTENV_DISABLED: '1' });
    expect(runtimeEnv({ PATH: '', TEMP: undefined, Path: 'wrong-case' }, 'linux'))
      .toEqual({ PATH: '', PYTHON_DOTENV_DISABLED: '1' });
  });
});
