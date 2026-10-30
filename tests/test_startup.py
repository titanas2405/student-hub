"""Launch the actual local server to catch platform-specific startup failures."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request


class StartupTests(unittest.TestCase):
    def test_server_starts_and_serves_login_page(self):
        root = Path(__file__).resolve().parents[1]
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        with tempfile.TemporaryDirectory(prefix="student-hub-startup-") as data:
            env = os.environ.copy()
            env["STUDENT_HUB_PORT"] = str(port)
            if os.name == "nt":
                env.update(APPDATA=data, LOCALAPPDATA=data)
            else:
                env.update(XDG_CONFIG_HOME=data, XDG_CACHE_HOME=data, XDG_DATA_HOME=data)
            proc = subprocess.Popen([sys.executable, str(root / "server.py")], cwd=root, env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            try:
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    if proc.poll() is not None:
                        self.fail(f"server exited during startup: {proc.stderr.read()}")
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as response:
                            self.assertEqual(response.status, 200)
                            self.assertIn("Student Hub", response.read().decode("utf-8"))
                            break
                    except (urllib.error.URLError, TimeoutError):
                        time.sleep(0.1)
                else:
                    self.fail("server did not start within 10 seconds")
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
                if proc.stderr:
                    proc.stderr.close()


if __name__ == "__main__":
    unittest.main()
