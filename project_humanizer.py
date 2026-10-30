"""Humanizer for a project folder: rewrites only prose (README/Markdown/text files and code comments).

Code never goes through the AI. Each file is split into prose segments and everything else; only the segments are
sent, the rewrites are put back in the same places, and the result is rejected unless the code around them is
exactly what it was (re-tokenized for Python, re-scanned for C-like languages).
"""
import difflib
import hashlib
import io
import os
import re
import subprocess
import tokenize
from pathlib import Path

TEXT_EXTS = {".md", ".markdown", ".txt", ".rst"}
TEXT_NAMES = {"readme", "changelog", "contributing", "authors", "notes"}
C_LIKE_EXTS = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".java", ".c", ".h", ".cpp", ".cc", ".hpp", ".cs",
               ".go", ".rs", ".kt", ".swift", ".php", ".css", ".scss", ".dart", ".scala"}
JS_EXTS = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"}
SKIP_DIRS = {".git", "node_modules", "venv", ".venv", "env", "__pycache__", "dist", "build", "target", ".next",
             "vendor", ".idea", ".vscode", "coverage", ".mypy_cache", ".pytest_cache", ".gradle", "bin", "obj"}
MAX_FILE = 200_000
MAX_DOCUMENT = 40_000
MAX_FILES = 400

# Comments that tools read, or that aren't prose, are left alone.
DIRECTIVE_RE = re.compile(r"^\s*(eslint|prettier|@ts-|tslint|istanbul|jshint|global\s|noqa|type:|pylint|pragma|fmt:|"
                          r"isort|mypy|nolint|go:|#?region|#?endregion|-\*-|vim?:|@flow|@jsx|clang-format|NOLINT)", re.I)
LEGAL_RE = re.compile(r"copyright|spdx-license|@license|all rights reserved", re.I)
CODEISH_RE = re.compile(r"([;{}]\s*$)|(^\s*(if|for|while|return|def|class|import|from|const|let|var|function|print|"
                        r"public|private|static|#include)\b)|(^\s*[\w.\[\]]+\s*\(.*\)\s*$)|(^\s*[\w.]+\s*[+\-*/]?=[^=])")
WORD_RE = re.compile(r"[^\W\d_]{2,}")


def file_kind(path):
    p = Path(path)
    ext = p.suffix.lower()
    if ext in TEXT_EXTS or (not ext and p.name.lower() in TEXT_NAMES):
        return "text"
    if ext == ".py":
        return "python"
    if ext in C_LIKE_EXTS:
        return "c"
    return None


def is_prose(text):
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines or DIRECTIVE_RE.match(lines[0]) or LEGAL_RE.search(text):
        return False
    if sum(1 for line in lines if CODEISH_RE.search(line)) * 2 > len(lines):    # mostly commented-out code
        return False
    return len(WORD_RE.findall(text)) >= 3


# ---------- segments ----------
# A segment is (start, end, text, kind, rebuild): content[start:end] is replaced by rebuild(new_text).
# kind is "document" (a whole text file), "comment" (may span lines) or "inline" (must stay on one line).

def _line_group(content, comments):
    """Joins full-line comments on consecutive lines, at the same indent and with the same marker, into one segment."""
    segments, run = [], []
    nl = "\r\n" if "\r\n" in content else "\n"

    def flush():
        if not run:
            return
        indent, marker = run[0]["indent"], run[0]["marker"]
        start, end = run[0]["line_start"], run[-1]["end"]
        bodies = [c["body"] for c in run]
        text = "\n".join(b[1:] if b.startswith(" ") else b for b in bodies)

        def rebuild(new, indent=indent, marker=marker):
            return nl.join(indent + marker + (" " + line if line.strip() else "") for line in new.strip("\n").split("\n"))
        segments.append((start, end, text, "comment", rebuild))
        run.clear()

    for c in comments:
        if c["full"] and run and run[-1]["full"] and c["line"] == run[-1]["line"] + 1 \
                and c["indent"] == run[-1]["indent"] and c["marker"] == run[-1]["marker"]:
            run.append(c)
            continue
        flush()
        if c["full"]:
            run.append(c)
        else:
            body = c["body"]
            lead = body[:len(body) - len(body.lstrip())]
            trail = body[len(body.rstrip()):]

            def rebuild(new, marker=c["marker"], lead=lead or " ", trail=trail):
                return marker + lead + new.strip() + trail
            segments.append((c["start"], c["end"], body.strip(), "inline", rebuild))
    flush()
    return segments


def _line_info(content, start, marker_len):
    line_start = content.rfind("\n", 0, start) + 1
    before = content[line_start:start]
    return {"line_start": line_start, "indent": before, "full": not before.strip(), "line": content.count("\n", 0, start)}


def python_segments(content):
    comments = []
    offsets = [0]
    for line in content.splitlines(keepends=True):
        offsets.append(offsets[-1] + len(line))
    for tok in tokenize.generate_tokens(io.StringIO(content).readline):
        if tok.type != tokenize.COMMENT:
            continue
        row, col = tok.start
        if row <= 2 and (tok.string.startswith("#!") or re.search(r"coding[:=]", tok.string)):
            continue
        start = offsets[row - 1] + col
        marker = re.match(r"#+", tok.string).group()
        info = _line_info(content, start, len(marker))
        comments.append(dict(info, start=start, end=start + len(tok.string), marker=marker, body=tok.string[len(marker):]))
    return comments


def c_comments(content, js=False):
    """Line (//) and block (/* */) comments, skipping strings, template literals and (for JS) regex literals."""
    out, i, n = [], 0, len(content)
    prev = ""                                   # last significant code character, for the regex heuristic
    while i < n:
        ch = content[i]
        nxt = content[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            end = content.find("\n", i)
            end = n if end < 0 else end
            if end > i and content[end - 1] == "\r":
                end -= 1
            out.append({"type": "line", "start": i, "end": end})
            i = end
        elif ch == "/" and nxt == "*":
            end = content.find("*/", i + 2)
            if end < 0:
                raise ValueError("unterminated block comment")
            out.append({"type": "block", "start": i, "end": end + 2})
            i = end + 2
        elif ch in "\"'`":
            j = i + 1
            while j < n and content[j] != ch:
                if content[j] == "\\":
                    j += 1
                elif content[j] == "\n" and ch != "`":
                    break                       # unterminated plain string: stop at the line end
                j += 1
            i, prev = j + 1, ch
        elif js and ch == "/" and (not prev or prev in "(,=:[!&|?{};+-*%<>~^" or
                                   re.search(r"\b(return|typeof|case|in|of|yield|await)\s*$", content[max(0, i - 12):i])):
            j, in_class = i + 1, False
            while j < n and content[j] != "\n":
                if content[j] == "\\":
                    j += 1
                elif content[j] == "[":
                    in_class = True
                elif content[j] == "]":
                    in_class = False
                elif content[j] == "/" and not in_class:
                    break
                j += 1
            i, prev = j + 1, "/"
        else:
            if not ch.isspace():
                prev = ch
            i += 1
    return out


def _block_segment(content, c):
    raw = content[c["start"] + 2:c["end"] - 2]
    doc = raw.startswith("*") and not raw.startswith("**")
    body = raw[1:] if doc else raw
    opener = "/**" if doc else "/*"
    if "\n" not in body:
        lead = body[:len(body) - len(body.lstrip())] or " "
        trail = body[len(body.rstrip()):] or " "
        return (c["start"], c["end"], body.strip(), "inline", lambda new: opener + lead + new.strip() + trail + "*/")
    lines = body.split("\n")
    first, middle, last = lines[0], lines[1:-1], lines[-1]
    if first.strip() or last.strip(" \t*\r") or not middle:
        return None                             # text on the opening/closing line: unusual layout, leave it
    cr = "\r" if first.endswith("\r") else ""
    middle = [line.rstrip("\r") for line in middle]
    prefixes = [re.match(r"[ \t]*(\*[ \t]?)?", line).group() for line in middle]
    template = next((p for p, line in zip(prefixes, middle) if line.strip(" \t*")), prefixes[0])
    if not template.strip():
        template = re.match(r"[ \t]*", template).group()
    text = "\n".join(line[len(p):] for p, line in zip(prefixes, middle)).strip("\n")

    def rebuild(new):
        rows = [(template + line) if line.strip() else template.rstrip() for line in new.strip("\n").split("\n")]
        return opener + first + "\n" + (cr + "\n").join(rows) + cr + "\n" + last + "*/"
    return (c["start"], c["end"], text, "comment", rebuild)


def c_segments(content, js=False):
    line_comments, segments = [], []
    for c in c_comments(content, js):
        if c["type"] == "block":
            seg = _block_segment(content, c)
            if seg:
                segments.append(seg)
        else:
            info = _line_info(content, c["start"], 2)
            marker = re.match(r"//+", content[c["start"]:c["end"]]).group()
            line_comments.append(dict(info, start=c["start"], end=c["end"], marker=marker,
                                      body=content[c["start"] + len(marker):c["end"]]))
    return sorted(segments + _line_group(content, line_comments), key=lambda s: s[0])


def segments_for(path, content):
    kind = file_kind(path)
    if kind == "text":
        if len(content) > MAX_DOCUMENT or not content.strip():
            return []
        return [(0, len(content), content, "document", lambda new: new)]
    if kind == "python":
        segs = _line_group(content, python_segments(content))
    elif kind == "c":
        segs = c_segments(content, Path(path).suffix.lower() in JS_EXTS)
    else:
        return []
    return [s for s in segs if is_prose(s[2])]


# ---------- checks ----------
FENCE_RE = re.compile(r"^(```|~~~).*?^\1", re.M | re.S)
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
URL_RE = re.compile(r"\]\(([^)\s]+)|https?://[^\s)>\]]+")
TAG_RE = re.compile(r"(?<![\w@])@\w+")
MARKER_RE = re.compile(r"\b(TODO|FIXME|XXX|HACK|NOTE)\b")


def _same(pattern, a, b):
    return sorted(m.group() for m in pattern.finditer(a)) == sorted(m.group() for m in pattern.finditer(b))


def check_segment(kind, old, new, ext):
    """Returns a reason the rewrite can't be used, or ""."""
    if not new.strip():
        return "empty rewrite"
    if kind == "inline" and "\n" in new.strip():
        return "a one-line comment became several lines"
    if kind in ("inline", "comment") and ("*/" in new or "/*" in new):
        return "comment markers in the rewrite"
    if kind in ("inline", "comment") and any(line.rstrip().endswith("\\") for line in new.split("\n")) and ext != ".py":
        return "a line ends with a backslash"
    for pattern, what in ((FENCE_RE, "code blocks"), (INLINE_CODE_RE, "inline code"), (URL_RE, "links"),
                          (TAG_RE, "@tags"), (MARKER_RE, "TODO/FIXME markers")):
        if not _same(pattern, old, new):
            return f"{what} changed"
    if kind == "document" and old.count("\n#") != new.count("\n#"):
        return "headings changed"
    return ""


def code_signature(path, content):
    """What must not change: the code with comments taken out."""
    kind = file_kind(path)
    if kind == "python":
        return [(t.type, t.string) for t in tokenize.generate_tokens(io.StringIO(content).readline)
                if t.type not in (tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT)]
    if kind == "c":
        out, last = [], 0
        for c in c_comments(content, Path(path).suffix.lower() in JS_EXTS):
            out.append(content[last:c["start"]])
            last = c["end"]
        out.append(content[last:])
        return re.sub(r"\s+", " ", " ".join(out)).strip()
    return None


# ---------- files ----------
def read_text(path):
    data = Path(path).read_bytes()
    if b"\0" in data[:4096]:
        raise ValueError("binary file")
    return data.decode("utf-8")


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def list_files(root, git=None):
    """Candidate files, relative to root: git's own list (respects .gitignore) or a walk that skips build folders."""
    root = Path(root)
    names = []
    if git and (root / ".git").is_dir():
        try:
            out = subprocess.run([git, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=root,
                                 capture_output=True, timeout=30, check=True).stdout
            names = [n for n in out.decode("utf-8", "replace").split("\0") if n]
        except (OSError, subprocess.SubprocessError):
            names = []
    if not names:
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith("."))
            for f in sorted(files):
                names.append(str((Path(dirpath) / f).relative_to(root)))
    out = []
    for name in names:
        if any(part in SKIP_DIRS for part in Path(name).parts[:-1]) or not file_kind(name):
            continue
        p = root / name
        if p.is_symlink() or not p.is_file() or p.stat().st_size > MAX_FILE:
            continue
        out.append(name.replace(os.sep, "/"))
        if len(out) >= MAX_FILES:
            break
    readme = lambda n: (0 if Path(n).name.lower().startswith("readme") else 1, n.count("/"), n.lower())
    return sorted(out, key=readme)


def safe_path(root, name):
    root = Path(root).resolve()
    p = (root / name).resolve()
    if root not in p.parents or not file_kind(p.name) or (root / name).is_symlink():
        raise ValueError(f"not a project file: {name}")
    return p


def scan(root, git=None):
    files = []
    for name in list_files(root, git):
        try:
            content = read_text(Path(root) / name)
            segs = segments_for(name, content)
        except (ValueError, UnicodeDecodeError, SyntaxError, tokenize.TokenError, OSError):
            continue
        if segs:
            files.append({"path": name, "kind": "text" if file_kind(name) == "text" else "comments",
                          "segments": len(segs), "chars": sum(len(s[2]) for s in segs)})
    return files


def rewrite(path, content, new_texts):
    """content with segment i replaced by new_texts[i] (None keeps it). Returns (new_content, skipped reasons)."""
    segs = segments_for(path, content)
    ext = Path(path).suffix.lower()
    pieces, last, skipped = [], 0, []
    for i, (start, end, text, kind, rebuild) in enumerate(segs):
        new = new_texts.get(i)
        pieces.append(content[last:start])
        reason = "" if new is None or new.strip() == text.strip() else check_segment(kind, text, new, ext)
        if new is None or new.strip() == text.strip() or reason:
            if reason:
                skipped.append(f"{text.strip().splitlines()[0][:60]}… : {reason}")
            pieces.append(content[start:end])
        else:
            if kind == "document":
                new = new.strip("\n") + ("\n" if content.endswith("\n") else "")
                if "\r\n" in content:
                    new = new.replace("\r\n", "\n").replace("\n", "\r\n")
            pieces.append(rebuild(new))
        last = end
    pieces.append(content[last:])
    result = "".join(pieces)
    if result != content and code_signature(path, result) != code_signature(path, content):
        return content, skipped + ["the code around the comments would change, so nothing was rewritten"]
    return result, skipped


def diff(path, before, after):
    return "".join(difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True),
                                        f"a/{path}", f"b/{path}", n=2))
