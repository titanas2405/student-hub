"""Things that only break on Windows, checked on every platform."""
import ast
import io
import os
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import server
import student_tools

ROOT = Path(__file__).resolve().parents[1]
APP_FILES = sorted(p for p in ROOT.glob("*.py"))


def calls(path):
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Call):
            yield node


def name_of(call):
    f = call.func
    return f.attr if isinstance(f, ast.Attribute) else f.id if isinstance(f, ast.Name) else ""


class EncodingTests(unittest.TestCase):
    """Windows uses its own code page (cp1252/cp1253) unless told otherwise, which breaks Greek text."""

    def test_text_io_always_names_its_encoding(self):
        missing = []
        for path in APP_FILES:
            for call in calls(path):
                keywords = {k.arg for k in call.keywords}
                name = name_of(call)
                text_mode = any(k.arg == "text" and getattr(k.value, "value", None) is True for k in call.keywords)
                method = isinstance(call.func, ast.Attribute) and not (
                    isinstance(call.func.value, ast.Name) and call.func.value.id in ("project_humanizer", "ph"))
                if (name in ("read_text", "write_text") and method) or (name in ("Popen", "run") and text_mode):
                    if "encoding" not in keywords:
                        missing.append(f"{path.name}:{call.lineno} {name}()")
                builtin_open = (isinstance(call.func, ast.Name) and name == "open") or name == "fdopen"
                if builtin_open and len(call.args) >= 2 and isinstance(call.args[1], ast.Constant) \
                        and "b" not in str(call.args[1].value) and "encoding" not in keywords:
                    missing.append(f"{path.name}:{call.lineno} {name}()")
        self.assertEqual(missing, [], "text I/O without encoding=\"utf-8\"")

    def test_old_config_written_in_a_windows_code_page_still_loads(self):
        greek = '{"projects": [{"id": "p1", "name": "Εργασία"}]}'.encode("cp1253")
        with patch.object(server.locale, "getpreferredencoding", lambda *_: "cp1253"):
            path = Path(self.id().replace(".", "_") + ".json")
            try:
                path.write_bytes(greek)
                self.assertIn("Εργασία", server.read_text_file(path))
            finally:
                path.unlink()


class WindowsProgramTests(unittest.TestCase):
    def test_programs_are_found_in_program_files_when_not_on_path(self):
        with self.subTest("LibreOffice"), patch.object(student_tools.shutil, "which", lambda name: None), \
                patch.object(student_tools, "IS_WINDOWS", True), \
                patch.dict(os.environ, {"ProgramFiles": str(ROOT / "tests" / "_pf")}):
            folder = ROOT / "tests" / "_pf" / "LibreOffice" / "program"
            gs = ROOT / "tests" / "_pf" / "gs" / "gs10.04.0" / "bin"
            try:
                folder.mkdir(parents=True)
                gs.mkdir(parents=True)
                (folder / "soffice.exe").write_bytes(b"")
                (gs / "gswin64c.exe").write_bytes(b"")
                self.assertTrue(student_tools.find_program("soffice", "libreoffice").endswith("soffice.exe"))
                self.assertTrue(student_tools.ghostscript().endswith("gswin64c.exe"))
                self.assertIsNone(student_tools.find_program("pdfinfo"))
            finally:
                import shutil
                shutil.rmtree(ROOT / "tests" / "_pf", ignore_errors=True)

    def test_zip_backslash_paths_are_refused_on_every_platform(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            info = zipfile.ZipInfo("x")
            info.filename = info.orig_filename = "..\\evil.txt"
            z.writestr(info, b"bad")
        with self.assertRaises(student_tools.ToolError):
            student_tools.checked_zip(buf.getvalue())


class AICLITests(unittest.TestCase):
    def test_windows_installs_outside_path_are_found(self):
        import tempfile
        import ai_cli
        with tempfile.TemporaryDirectory() as home:
            home = Path(home)
            (home / ".local" / "bin").mkdir(parents=True)
            (home / ".local" / "bin" / "claude.exe").write_bytes(b"")
            (home / "npm").mkdir()
            (home / "npm" / "codex.cmd").write_bytes(b"")
            with patch.object(ai_cli.shutil, "which", lambda name: None), patch.object(ai_cli, "IS_WINDOWS", True), \
                    patch.object(ai_cli.Path, "home", lambda: home), patch.dict(os.environ, {"APPDATA": str(home)}):
                self.assertEqual(ai_cli.binary("claude"), str(home / ".local" / "bin" / "claude.exe"))
                self.assertEqual(ai_cli.binary("chatgpt"), str(home / "npm" / "codex.cmd"))
                self.assertEqual(ai_cli.binary("gemini"), str(home / ".local" / "bin" / "gemini.exe"))   # not installed


class StartupTests(unittest.TestCase):
    def test_server_does_not_look_up_its_network_name(self):
        with patch.object(server.socket, "getfqdn", side_effect=AssertionError("slow DNS lookup")):
            httpd = server.HubServer(("127.0.0.1", 0), server.Handler)
            httpd.server_close()
        self.assertEqual(httpd.server_name, "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
