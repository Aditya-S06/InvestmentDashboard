"""Least-privilege environment for the nested transcript downloader.

Keep runtime names in sync with lib/subprocess-env.ts and the cron wrappers.
No application/provider keys or arbitrary interpreter loader settings belong here.
"""
import os

RUNTIME_KEYS = (
    "PATH", "SystemRoot", "WINDIR", "COMSPEC",
    "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
    "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "TMPDIR", "TMP", "TEMP",
    "LANG", "LC_ALL", "LC_CTYPE", "TZ", "PYTHONIOENCODING", "PYTHONUTF8", "PYTHONUNBUFFERED",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
)


def runtime_env(source=None, *, windows=None):
    source = os.environ if source is None else source
    windows = os.name == "nt" if windows is None else windows
    lookup = {key.upper(): value for key, value in source.items()} if windows else source
    env = {}
    for key in RUNTIME_KEYS:
        name = key.upper() if windows else key
        if name in lookup:
            env[name] = lookup[name]
    env["PYTHON_DOTENV_DISABLED"] = "1"
    return env
