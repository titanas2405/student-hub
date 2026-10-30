"""The project humanizer may change prose only: text files and comments, never code."""
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import project_humanizer as ph
import server

PY = '''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os  # noqa: F401

# This function is utilized in order to facilitate
# the computation of the total amount of values.
def total(values):
    s = "# not a comment"
    return sum(values)  # it returns the sum of all the values
# x = total([1, 2])
'''

JS = '''/**
 * Furthermore, this helper delves into the parsing of the user input.
 * @param {string} text the input
 */
function parse(text) {
  const re = /\\/*[a-z]+/g;  // a regex that looks like it opens a comment
  const url = "http://example.com/*not*/";
  return text.match(re); // returns all of the matches that were found
}
/* eslint-disable no-console */
'''


class SegmentTests(unittest.TestCase):
    def texts(self, path, content):
        return [(s[3], s[2]) for s in ph.segments_for(path, content)]

    def test_python_finds_prose_comments_only(self):
        self.assertEqual(self.texts("a.py", PY), [
            ("comment", "This function is utilized in order to facilitate\nthe computation of the total amount of values."),
            ("inline", "it returns the sum of all the values"),
        ])

    def test_c_like_skips_strings_regexes_and_directives(self):
        self.assertEqual(self.texts("a.js", JS), [
            ("comment", "Furthermore, this helper delves into the parsing of the user input.\n@param {string} text the input"),
            ("inline", "a regex that looks like it opens a comment"),
            ("inline", "returns all of the matches that were found"),
        ])

    def test_readme_is_one_document(self):
        self.assertEqual(self.texts("README.md", "# Title\n\nSome words here.\n"), [("document", "# Title\n\nSome words here.\n")])
        self.assertEqual(ph.file_kind("Makefile"), None)
        self.assertEqual(ph.file_kind("docs/README"), "text")


class RewriteTests(unittest.TestCase):
    def test_python_rewrite_keeps_code_and_layout(self):
        new, skipped = ph.rewrite("a.py", PY, {0: "Adds up the values.\nKept short on purpose.", 1: "sum of the values"})
        self.assertEqual(skipped, [])
        self.assertIn("\n# Adds up the values.\n# Kept short on purpose.\ndef total(values):\n", new)
        self.assertIn("return sum(values)  # sum of the values\n", new)
        self.assertEqual(ph.code_signature("a.py", new), ph.code_signature("a.py", PY))

    def test_js_doc_comment_keeps_stars_and_tags(self):
        new, skipped = ph.rewrite("a.js", JS, {0: "Parses what the user typed.\n@param {string} text the input"})
        self.assertEqual(skipped, [])
        self.assertTrue(new.startswith("/**\n * Parses what the user typed.\n * @param {string} text the input\n */\nfunction parse"))

    def test_unsafe_rewrites_are_refused(self):
        cases = {1: "fine */ x = 1; /*", 2: "two\nlines"}
        new, skipped = ph.rewrite("a.js", JS, cases)
        self.assertEqual(new, JS)
        self.assertEqual(len(skipped), 2)
        _, skipped = ph.rewrite("a.js", JS, {0: "Parses input."})       # dropped the @param tag
        self.assertIn("@tags changed", skipped[0])

    def test_document_code_blocks_and_links_must_survive(self):
        doc = "# App\n\nIt is important to note that you run it.\n\n```bash\npython3 app.py\n```\n\nSee [docs](https://x.org).\n"
        good = "# App\n\nRun it like this.\n\n```bash\npython3 app.py\n```\n\nSee [docs](https://x.org).\n"
        self.assertEqual(ph.rewrite("README.md", doc, {0: good}), (good, []))
        bad = good.replace("python3 app.py", "python app.py")
        new, skipped = ph.rewrite("README.md", doc, {0: bad})
        self.assertEqual(new, doc)
        self.assertIn("code blocks changed", skipped[0])

    def test_crlf_files_keep_crlf(self):
        src = "x = 1\r\n# This explains what the next line does in detail.\r\ny = 2\r\n"
        new, _ = ph.rewrite("a.py", src, {0: "Explains the next line.\nSecond line."})
        self.assertEqual(new, "x = 1\r\n# Explains the next line.\r\n# Second line.\r\ny = 2\r\n")


class FileTests(unittest.TestCase):
    def test_scan_lists_readme_first_and_skips_build_folders(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "src").mkdir()
            (root / "node_modules").mkdir()
            (root / "src" / "a.py").write_text(PY)
            (root / "node_modules" / "b.js").write_text(JS)
            (root / "README.md").write_text("# Project\n\nThis project is a tool for students.\n")
            (root / "data.bin").write_bytes(b"\0\1")
            self.assertEqual([f["path"] for f in ph.scan(root)], ["README.md", "src/a.py"])
            with self.assertRaises(ValueError):
                ph.safe_path(root, "../outside.md")


class JobTests(unittest.TestCase):
    def test_job_rewrites_then_applies_only_unchanged_files(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "README.md").write_text("# Tool\n\nIt is important to note that this tool helps students.\n")
            (root / "a.py").write_text(PY)
            calls = []

            def ai(content, cwd, settings, schema=None, **kw):
                import json
                segments = json.loads(content[1]["text"].split("\n", 1)[1])
                calls.append(segments)
                out = [{"id": s["id"], "text": s["text"].replace("It is important to note that this", "This")
                        .replace("it returns the sum of all the values", "sum of the values")} for s in segments]
                return {"structured_output": {"segments": out}}

            project = {"id": "p1", "path": str(root)}
            with patch.object(server, "run_ai", ai), patch.object(server, "ai_available", lambda: True), \
                    patch.object(server, "ai_settings", lambda: {}):
                jid = server.ProjectHumanizer.start(project, ["README.md", "a.py"], ["Be natural."])
                for _ in range(200):
                    if server.ProjectHumanizer.jobs[jid]["status"] != "running":
                        break
                    time.sleep(0.01)
            job = server.ProjectHumanizer.jobs[jid]
            self.assertEqual(job["status"], "done", job["error"])
            self.assertEqual(len(calls), 1)
            self.assertNotIn("def total", str(calls))                  # code is never sent
            self.assertEqual([f["changed"] for f in job["files"]], [True, True])
            (root / "a.py").write_text(PY + "\n")                       # the student edits a file meanwhile
            result = server.ProjectHumanizer.apply(jid, ["README.md", "a.py"])
            self.assertEqual(result, {"written": ["README.md"], "conflicts": ["a.py"]})
            self.assertEqual((root / "README.md").read_text(), "# Tool\n\nThis tool helps students.\n")
            self.assertEqual((root / "a.py").read_text(), PY + "\n")


if __name__ == "__main__":
    unittest.main()
