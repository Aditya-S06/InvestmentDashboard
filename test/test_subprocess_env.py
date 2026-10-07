"""Offline boundary regression tests. All environment values are test sentinels."""
import builtins
import importlib
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from subprocess_env import RUNTIME_KEYS, runtime_env


class SubprocessEnvironmentTests(unittest.TestCase):
    def test_runtime_names_stay_in_sync_across_launchers(self):
        ts = (ROOT / "lib/subprocess-env.ts").read_text(encoding="utf-8")
        keys = re.findall(r"'([^']+)'", ts.split("const RUNTIME_KEYS = [")[1].split("] as const")[0])
        self.assertEqual(set(keys), set(RUNTIME_KEYS))
        youtube_keys = {
            "YOUTUBE_API_KEY", "OPENROUTER_API_KEY", "YOUTUBE_CACHE_DIR", "YOUTUBE_CHANNELS_FILE",
            "YOUTUBE_POLL_SINCE_DAYS", "YOUTUBE_RATE_LIMIT_PER_MIN", "YOUTUBE_SUMMARY_MODEL",
        }
        ps = (ROOT / "scripts/youtube_poll_cron.ps1").read_text(encoding="utf-8")
        ps_keys = re.findall(r"'([^']+)'", ps.split("$AllowedNames = @(")[1].split(")")[0])
        shell = (ROOT / "scripts/youtube_poll_cron.sh").read_text(encoding="utf-8")
        shell_keys = shell.split("for name in")[1].split("; do")[0].replace("\\", "").split()
        self.assertEqual(set(ps_keys), set(RUNTIME_KEYS) | youtube_keys)
        self.assertEqual(set(shell_keys), set(RUNTIME_KEYS) | youtube_keys)

    def test_runtime_allowlist(self):
        allowed = {
            "PATH": "/test/bin", "HOME": "/test/home", "TMPDIR": "/test/tmp",
            "XDG_CACHE_HOME": "/test/cache", "LANG": "C.UTF-8", "TZ": "UTC",
            "SSL_CERT_FILE": "/test/ca.pem", "https_proxy": "http://proxy.test:8080",
        }
        source = dict(allowed, DATABASE_URL="sentinel-db", DIRECT_URL="sentinel-direct",
                      NEXTAUTH_SECRET="sentinel-auth", WEBULL_APP_SECRET_PROD="sentinel-broker",
                      YOUTUBE_API_KEY="sentinel-youtube", OPENROUTER_API_KEY="sentinel-router",
                      OPENAI_API_KEY="sentinel-openai", FRED_API_KEY="sentinel-fred",
                      FUTURE_SECRET="sentinel-future", PYTHONPATH="/untrusted",
                      PYTHON_DOTENV_DISABLED="0")
        self.assertEqual(runtime_env(source, windows=False), dict(allowed, PYTHON_DOTENV_DISABLED="1"))
        self.assertEqual(runtime_env({}, windows=False), {"PYTHON_DOTENV_DISABLED": "1"})

    def test_windows_case_insensitivity(self):
        self.assertEqual(runtime_env({
            "Path": "test-bin", "SystemRoot": "test-windows", "Temp": "test-temp",
            "userprofile": "test-user", "LocalAppData": "test-cache", "nextauth_secret": "sentinel-auth",
        }, windows=True), {
            "PATH": "test-bin", "SYSTEMROOT": "test-windows", "TEMP": "test-temp",
            "USERPROFILE": "test-user", "LOCALAPPDATA": "test-cache", "PYTHON_DOTENV_DISABLED": "1",
        })

    def test_actual_ytdlp_boundary_drops_even_youtube_and_openrouter_keys(self):
        sentinels = {
            "PATH": "sentinel-path", "TEMP": "sentinel-temp", "SystemRoot": "sentinel-system",
            "YOUTUBE_API_KEY": "sentinel-youtube", "OPENROUTER_API_KEY": "sentinel-router",
            "DATABASE_URL": "sentinel-db", "DIRECT_URL": "sentinel-direct", "NEXTAUTH_SECRET": "sentinel-auth",
            "WEBULL_APP_SECRET_PROD": "sentinel-broker", "AWS_SECRET_ACCESS_KEY": "sentinel-aws",
        }
        with patch.dict(os.environ, sentinels, clear=True):
            youtube = importlib.import_module("youtube_ingest")
            with patch.object(youtube.tempfile, "TemporaryDirectory") as temp, \
                 patch.object(youtube.subprocess, "run") as launch, \
                 patch.object(youtube.os, "listdir", return_value=[]):
                temp.return_value.__enter__.return_value = "sentinel-temp-dir"
                launch.return_value = types.SimpleNamespace(returncode=0)
                self.assertIsNone(youtube.extract_transcript_ytdlp("test-video"))
                args, kwargs = launch.call_args
                self.assertEqual(args[0][:3], [sys.executable, "-m", "yt_dlp"])
                self.assertEqual(kwargs["env"], runtime_env())
                self.assertEqual(kwargs["timeout"], 90)
                self.assertNotIn("OPENROUTER_API_KEY", kwargs["env"])
                self.assertNotIn("YOUTUBE_API_KEY", kwargs["env"])

    def test_desk_blocks_transitive_dotenv_before_import_even_with_old_dotenv(self):
        # Simulate pre-1.2 dotenv, which ignores PYTHON_DOTENV_DISABLED entirely.
        dotenv = types.ModuleType("dotenv")
        dotenv.load_dotenv = Mock(side_effect=AssertionError("dotenv file load attempted"))
        original_loader = dotenv.load_dotenv
        dotenv.find_dotenv = Mock(return_value="synthetic-env-path")
        callbacks = types.ModuleType("langchain_core.callbacks")
        callbacks.BaseCallbackHandler = type("BaseCallbackHandler", (), {})
        rating = types.SimpleNamespace(RATING_REVIEW="REVIEW", RATINGS_5_TIER=[])
        graph = types.SimpleNamespace(TradingAgentsGraph=object)
        original_import = builtins.__import__
        imported = []

        def guarded_import(name, *args, **kwargs):
            if name.startswith("tradingagents."):
                if not imported:
                    # Execute the real vendored initializer: both dotenv calls
                    # must have been disabled by the application entry point.
                    runpy.run_path(str(ROOT / "TradingAgents/tradingagents/__init__.py"))
                imported.append(name)
                if name.endswith("rating"):
                    return rating
                if name.endswith("default_config"):
                    return types.SimpleNamespace(DEFAULT_CONFIG={})
                return graph
            return original_import(name, *args, **kwargs)

        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "sentinel-router"}, clear=True), \
             patch.dict(sys.modules, {"dotenv": dotenv, "langchain_core": types.ModuleType("langchain_core"),
                                      "langchain_core.callbacks": callbacks}), \
             patch("builtins.__import__", side_effect=guarded_import):
            runpy.run_path(str(ROOT / "scripts/trading_desk_runner.py"))
            self.assertEqual(len(imported), 3)
            original_loader.assert_not_called()
            self.assertEqual(dotenv.find_dotenv.call_count, 2)
            self.assertNotIn("DATABASE_URL", os.environ)
            self.assertEqual(os.environ["OPENROUTER_API_KEY"], "sentinel-router")

    def _exercise_poll_wrapper(self, shell, suffix, seed_channels=False):
        # A fake Python executable runs a JS fixture. No application Python,
        # credentials, channel configuration, or HTTP clients are executed.
        node = shutil.which("node")
        if not node:
            self.skipTest("Node is required for the harmless executable fixture")
        with tempfile.TemporaryDirectory(prefix="oracle-boundary-") as directory:
            fixture = Path(directory)
            (fixture / "scripts").mkdir()
            (fixture / "conf").mkdir()
            fake_bin = fixture / ".venv" / ("Scripts" if os.name == "nt" else "bin")
            fake_bin.mkdir(parents=True)
            shutil.copyfile(node, fake_bin / ("python.exe" if os.name == "nt" else "python"))
            if os.name != "nt":
                (fake_bin / "python").chmod(0o755)
            channels = "conf/channels with spaces.json"
            channel_fixture = "conf/youtube_channels.json.example" if seed_channels else channels
            (fixture / channel_fixture).write_text("[]", encoding="utf-8")
            (fixture / "scripts/youtube_ingest.py").write_text(
                "console.log(JSON.stringify({env: process.env, args: process.argv.slice(2)}));\n",
                encoding="utf-8",
            )
            wrapper = fixture / "scripts" / ("youtube_poll_cron." + suffix)
            wrapper.write_text((ROOT / "scripts" / wrapper.name).read_text(encoding="utf-8"), encoding="utf-8")
            system_root = os.environ.get("SystemRoot", "C:\\Windows")
            safe_env = {
                "PATH": os.pathsep.join([str(Path(node).parent), str(Path(shell).parent),
                                         str(Path(system_root) / "System32"), os.defpath]),
                "SystemRoot": system_root, "WINDIR": system_root,
                "HOME": directory, "USERPROFILE": directory, "TEMP": directory, "TMP": directory,
                "YOUTUBE_CHANNELS_FILE": channels, "YOUTUBE_API_KEY": "sentinel-youtube",
                "OPENROUTER_API_KEY": "sentinel-router", "YOUTUBE_SUMMARY_MODEL": "sentinel-model",
                "YOUTUBE_CACHE_DIR": "sentinel-cache", "YOUTUBE_RATE_LIMIT_PER_MIN": "17",
                "YOUTUBE_POLL_SINCE_DAYS": "4", "DATABASE_URL": "sentinel-db", "DIRECT_URL": "sentinel-direct",
                "NEXTAUTH_SECRET": "sentinel-auth", "WEBULL_APP_SECRET_PROD": "sentinel-broker",
                "OPENAI_API_KEY": "sentinel-openai", "FUTURE_SECRET": "sentinel-future",
                "PYTHON_DOTENV_DISABLED": "0",
            }
            args = [shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(wrapper)] if suffix == "ps1" else [shell, str(wrapper)]
            result = subprocess.run(args, cwd=fixture, env=safe_env, text=True, capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            expected_channels = "conf/youtube_channels.json" if seed_channels else channels
            self.assertEqual(payload["args"], ["poll", expected_channels])
            if seed_channels:
                self.assertEqual((fixture / expected_channels).read_text(encoding="utf-8"), "[]")
            env = {name.upper(): value for name, value in payload["env"].items()}
            for name in ("DATABASE_URL", "DIRECT_URL", "NEXTAUTH_SECRET", "WEBULL_APP_SECRET_PROD",
                         "OPENAI_API_KEY", "FUTURE_SECRET"):
                self.assertNotIn(name, env)
            for name in ("YOUTUBE_API_KEY", "OPENROUTER_API_KEY", "YOUTUBE_CHANNELS_FILE",
                         "YOUTUBE_CACHE_DIR", "YOUTUBE_RATE_LIMIT_PER_MIN", "YOUTUBE_POLL_SINCE_DAYS",
                         "YOUTUBE_SUMMARY_MODEL"):
                self.assertEqual(env[name], safe_env[name])
            self.assertEqual(env["PYTHON_DOTENV_DISABLED"], "1")

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell wrapper")
    def test_powershell_poll_boundary(self):
        shell = shutil.which("powershell")
        if not shell:
            self.skipTest("Windows PowerShell unavailable")
        self._exercise_poll_wrapper(shell, "ps1")

    def test_bash_poll_boundary(self):
        shell = r"C:\Program Files\Git\bin\bash.exe" if os.name == "nt" else shutil.which("bash")
        if not shell or not Path(shell).is_file():
            self.skipTest("Bash unavailable")
        self._exercise_poll_wrapper(shell, "sh")

    def test_bash_initial_channel_copy_uses_isolated_utilities(self):
        shell = r"C:\Program Files\Git\bin\bash.exe" if os.name == "nt" else shutil.which("bash")
        if not shell or not Path(shell).is_file():
            self.skipTest("Bash unavailable")
        self._exercise_poll_wrapper(shell, "sh", seed_channels=True)


if __name__ == "__main__":
    unittest.main()
