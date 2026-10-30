"""Project access for the assistant: only switched-on permissions, only inside the project, only allowed types."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import project_access as pa
import server
from student_assistant import Assistant


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.root = base / "proj"
        self.root.mkdir()
        (self.root / "main.py").write_bytes(b"print('hi')\n")
        (self.root / "notes.md").write_bytes(b"# Notes\n")
        (self.root / "image.png").write_bytes(b"\x89PNG\0")
        (self.root / ".git").mkdir()
        (self.root / ".git" / "config.md").write_text("x")
        (base / "secret.txt").write_text("not yours")
        self.backups = base / "backups"

    def tearDown(self):
        self.tmp.cleanup()

    def access(self, *perms, types=None):
        return pa.ProjectAccess(self.root, set(perms), types or pa.DEFAULT_TYPES, self.backups)

    def test_permissions_are_enforced(self):
        a = self.access("read")
        self.assertEqual(a.read("main.py")["text"], "print('hi')\n")
        for call in (lambda: a.write("main.py", "x"), lambda: a.delete("main.py"), lambda: a.run("echo hi")):
            with self.assertRaises(PermissionError):
                call()
        with self.assertRaises(PermissionError):
            self.access("write").read("main.py")

    def test_paths_stay_inside_the_project_and_out_of_git(self):
        a = self.access("read", "write", "delete")
        for bad in ("../secret.txt", "/etc/passwd", ".git/config.md", "sub/../../secret.txt"):
            with self.assertRaises(ValueError, msg=bad):
                a.read(bad)
        try:
            os.symlink(Path(self.tmp.name) / "secret.txt", self.root / "link.txt")
        except OSError:                          # Windows without permission to create links
            pass
        else:
            with self.assertRaises(ValueError):
                a.read("link.txt")
        self.assertNotIn(".git/config.md", [f["path"] for f in a.files()["files"]])

    def test_file_types_limit_every_operation(self):
        a = self.access("read", "write", "delete", types=[".md"])
        self.assertEqual(a.read("notes.md")["text"], "# Notes\n")
        for call in (lambda: a.read("main.py"), lambda: a.write("new.py", "x"), lambda: a.delete("main.py")):
            with self.assertRaisesRegex(ValueError, "not allowed"):
                call()
        listed = {f["path"]: f["allowed"] for f in a.files()["files"]}
        self.assertEqual((listed["notes.md"], listed["main.py"]), (True, False))
        self.assertEqual(pa.parse_types("py, .md Makefile"), [".py", ".md", "Makefile"])
        self.assertEqual(pa.parse_types(".py *"), ["*"])

    def test_write_replace_delete_back_up_the_old_file(self):
        a = self.access("read", "write", "delete")
        a.write("src/app/util.py", "def f():\n    return 1\n")
        self.assertTrue((self.root / "src/app/util.py").is_file())
        r = a.write("main.py", "print('hello')", replace="print('hi')")
        self.assertEqual((self.root / "main.py").read_text(), "print('hello')\n")
        self.assertEqual(Path(r["backup"]).read_text(), "print('hi')\n")
        with self.assertRaisesRegex(ValueError, "exactly once"):
            a.write("main.py", "x", replace="missing")
        r = a.delete("notes.md")
        self.assertFalse((self.root / "notes.md").exists())
        self.assertEqual(Path(r["backup"]).read_text(), "# Notes\n")
        self.assertEqual([c["action"] for c in a.changes], ["created", "edited", "deleted"])

    def test_binary_files_are_not_read(self):
        with self.assertRaisesRegex(ValueError, "Binary"):
            self.access("read", types=["*"]).read("image.png")

    def test_commands_run_in_the_project_and_report_output(self):
        a = self.access("read", "run")
        r = a.run(f'"{sys.executable}" -c "import os; print(os.listdir())"')
        self.assertEqual(r["exitCode"], 0)
        self.assertIn("main.py", r["output"])
        self.assertEqual(a.changes[-1]["action"], "ran")

    def test_custom_arguments(self):
        self.assertEqual(pa.parse_args('--model sonnet --append-system-prompt "be brief"'),
                         ["--model", "sonnet", "--append-system-prompt", "be brief"])
        with self.assertRaisesRegex(ValueError, "sets these itself"):
            pa.parse_args("--output-format text")
        with self.assertRaises(ValueError):
            pa.parse_args('"unclosed')


class ImportTests(unittest.TestCase):
    def test_ditlab_file_is_copied_into_the_project_only_with_write(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "proj"
            root.mkdir()
            ditlab = Mock()
            ditlab.list.return_value = {"items": [{"name": "exam 2024/Ιούνιος.pdf", "path": "/OS/exam.pdf", "isDir": False}]}
            ditlab.open.side_effect = lambda url: __import__("io").BytesIO(b"%PDF-1.4 exam")
            session = SimpleNamespace(inst="uoa", account=Mock(mail=False), ditlab=ditlab, eclass=None,
                                      piazza=None, portal=None, assistant=None)
            assistant = Assistant(server, session)
            found = assistant.retrieve({"tool": "search_files", "source": "ditlab", "query": "exam"}, {})
            doc = found["files"][0]["id"]
            assistant.access = pa.ProjectAccess(root, {"read"}, [".py"], Path(d) / "b")
            with self.assertRaises(PermissionError):
                assistant.retrieve({"tool": "project_import", "id": doc}, {})
            assistant.access = pa.ProjectAccess(root, {"read", "write"}, [".py"], Path(d) / "b")
            r = assistant.retrieve({"tool": "project_import", "id": doc}, {})
            self.assertEqual(r["path"], "course-material/exam 2024_Ιούνιος.pdf")      # a PDF, though only .py is allowed
            self.assertEqual((root / r["path"]).read_bytes(), b"%PDF-1.4 exam")
            with self.assertRaisesRegex(ValueError, "already exists"):
                assistant.retrieve({"tool": "project_import", "id": doc}, {})
            with self.assertRaisesRegex(ValueError, "outside the project"):
                assistant.retrieve({"tool": "project_import", "id": doc, "path": "../stolen.pdf"}, {})
            with self.assertRaisesRegex(ValueError, "Unknown document"):
                assistant.retrieve({"tool": "project_import", "id": "/etc/passwd"}, {})
            self.assertEqual(assistant.access.changes, [{"action": "imported", "path": r["path"]}])


class ChatTests(unittest.TestCase):
    def test_chat_writes_and_runs_only_with_access_and_lists_changes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "proj"
            root.mkdir()
            session = SimpleNamespace(inst="uoa", account=Mock(mail=False), ditlab=None, eclass=None,
                                      piazza=None, portal=None, assistant=None)
            assistant = Assistant(server, session)
            replies = iter([
                {"answer": "", "sources": [], "actions": [
                    {"tool": "project_write", "path": "hello.py", "content": "print('hello')\n", "query": ""},
                    {"tool": "project_run", "query": f'"{sys.executable}" hello.py'}]},
                {"answer": "Done: created hello.py and ran it.", "sources": [], "actions": []},
            ])
            prompts = []

            def run_ai(content, cwd, settings, schema=None, on_proc=None, **kw):
                prompts.append((content[0]["text"], content[1]["text"], settings))
                return {"structured_output": next(replies), "modelUsage": {"m": {}}}

            access = pa.ProjectAccess(root, {"read", "write", "run"}, pa.DEFAULT_TYPES, Path(d) / "b")
            with patch.object(server, "run_ai", run_ai), patch.object(server, "ai_available", lambda: True), \
                    patch.object(server, "ai_settings", lambda: {"provider": "claude"}):
                assistant.ask("Make a hello world and run it", access, "proj", ["--model", "sonnet"])
                for _ in range(500):
                    if not assistant.status()["busy"]:
                        break
                    time.sleep(0.01)
            status = assistant.status()
            self.assertEqual(status["error"], "")
            answer = status["messages"][-1]["text"]
            self.assertIn("Νέο αρχείο: `hello.py`", answer)
            self.assertIn("(κωδικός εξόδου 0)", answer)
            self.assertIn("hello", prompts[1][1])                       # the command's output went back to the AI
            self.assertIn("PROJECT ACCESS IS ON", prompts[0][0])
            self.assertNotIn("read-only retrieval tools for the student's connected accounts.", prompts[0][0])
            self.assertNotIn("reading arbitrary local files", prompts[0][0])
            self.assertIn('"allowed": ["read", "run", "write"]', prompts[0][1])
            self.assertNotIn("project_delete", prompts[0][0])            # not switched on, not offered
            self.assertEqual(prompts[0][2]["extra_args"], ["--model", "sonnet"])
            self.assertEqual((root / "hello.py").read_text(), "print('hello')\n")

            assistant.access = None                                      # access switched off again
            with self.assertRaisesRegex(ValueError, "access is off"):
                assistant.retrieve({"tool": "project_read", "path": "hello.py"}, {})


if __name__ == "__main__":
    unittest.main()
