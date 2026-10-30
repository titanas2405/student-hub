"""What the assistant may do inside one project folder, when the student switches it on in the chat.

Every operation stays inside the project root (no "..", no symlinks out, never .git), only touches the file
types the student allowed, and backs up a file before it is overwritten or deleted.
"""
import os
import shlex
import shutil
import signal
import subprocess
import time
from pathlib import Path

PERMISSIONS = ("read", "write", "delete", "run")
DEFAULT_TYPES = [".py", ".ipynb", ".js", ".mjs", ".ts", ".jsx", ".tsx", ".java", ".c", ".h", ".cpp", ".hpp", ".cs",
                 ".go", ".rs", ".kt", ".swift", ".php", ".rb", ".sh", ".html", ".css", ".scss", ".json", ".yml", ".yaml",
                 ".toml", ".xml", ".sql", ".csv", ".md", ".txt", ".gitignore", "Makefile", "Dockerfile"]
SKIP_DIRS = {".git", "node_modules", "venv", ".venv", "__pycache__", ".mypy_cache", ".pytest_cache"}
MAX_READ = 2_000_000
MAX_WRITE = 1_000_000
CHUNK = 22_000
RUN_TIMEOUT = 300
RUN_OUTPUT = 20_000
# Arguments the app sets itself; overriding them would break how answers are read back.
RESERVED_ARGS = {"-p", "--print", "--output-format", "--input-format", "--json-schema", "--output-schema", "-o",
                 "--output-last-message", "--resume", "--session-id", "--verbose"}


def parse_types(text):
    """'.py, .md Makefile' -> ['.py', '.md', 'Makefile']; '*' allows every text file."""
    items = [t.strip() for t in str(text or "").replace(",", " ").split() if t.strip()]
    out = []
    for t in items[:80]:
        if t == "*":
            return ["*"]
        if len(t) > 40 or "/" in t or "\\" in t:
            raise ValueError(f"Not a file type: {t}")
        if not t.startswith(".") and t[0].islower() and "." not in t:
            t = "." + t                                 # "py" -> ".py"; names such as Makefile stay as written
        out.append(t)
    return list(dict.fromkeys(out))


def parse_args(text):
    """Custom CLI arguments, split like a shell would, without running a shell."""
    try:
        args = shlex.split(str(text or ""))
    except ValueError as exc:
        raise ValueError(f"Custom arguments: {exc}") from None
    if len(args) > 30 or any(len(a) > 300 for a in args):
        raise ValueError("Custom arguments: at most 30 arguments of up to 300 characters")
    bad = [a for a in args if a.split("=", 1)[0] in RESERVED_ARGS]
    if bad:
        raise ValueError(f"Student Hub sets these itself: {', '.join(bad)}")
    return args


class ProjectAccess:
    def __init__(self, root, permissions, types, backups):
        self.root = Path(root).resolve()
        if not self.root.is_dir():
            raise ValueError("This project has no folder on this computer; open it from Projects first")
        self.permissions = {p for p in PERMISSIONS if p in permissions}
        self.types = list(types or DEFAULT_TYPES)
        self.backups = Path(backups)
        self.stamp = time.strftime("%Y%m%d-%H%M%S")
        self.changes = []

    def need(self, permission):
        if permission not in self.permissions:
            raise PermissionError(f"The student hasn't allowed '{permission}' for this project")

    def allowed_type(self, path):
        return "*" in self.types or path.name in self.types or any(
            t.startswith(".") and path.name.endswith(t) for t in self.types)

    def path(self, rel, must_exist=True):
        rel = str(rel or "").strip().replace("\\", "/").lstrip("/")
        if not rel:
            raise ValueError("Give a file path relative to the project folder")
        target = (self.root / rel)
        resolved = target.resolve()
        if resolved != self.root and self.root not in resolved.parents:
            raise ValueError("That path is outside the project")
        if ".git" in resolved.relative_to(self.root).parts:
            raise ValueError("The .git folder is off limits")
        if must_exist and not resolved.is_file():
            raise ValueError(f"No such file: {rel}")
        if not self.allowed_type(resolved):
            raise ValueError(f"File type not allowed in the assistant's access settings: {resolved.name}")
        return resolved

    def rel(self, path):
        return path.relative_to(self.root).as_posix()

    # ---- read
    def files(self, query="", offset=0):
        self.need("read")
        terms = str(query or "").casefold().split()
        found = []
        for dirpath, dirs, names in os.walk(self.root):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
            for name in sorted(names):
                p = Path(dirpath) / name
                rel = self.rel(p)
                if p.is_symlink() or not all(t in rel.casefold() for t in terms):
                    continue
                found.append({"path": rel, "size": p.stat().st_size, "allowed": self.allowed_type(p)})
            if len(found) > 5000:
                break
        page = found[offset * 300:(offset + 1) * 300]
        return {"root": self.root.name, "files": page, "total": len(found),
                "nextOffset": offset + 1 if (offset + 1) * 300 < len(found) else None}

    def read(self, rel, offset=0):
        self.need("read")
        p = self.path(rel)
        data = p.read_bytes()
        if len(data) > MAX_READ:
            raise ValueError("File is larger than 2 MB")
        if b"\0" in data[:8192]:
            raise ValueError("Binary file; only text files can be read")
        text = data.decode("utf-8", "replace")
        end = min(len(text), offset + CHUNK)
        return {"path": self.rel(p), "text": text[offset:end], "offset": offset, "totalCharacters": len(text),
                "nextOffset": end if end < len(text) else None, "complete": end >= len(text)}

    # ---- write / delete
    def backup(self, p):
        dest = self.backups / self.stamp / self.rel(p)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dest)
        return str(dest)

    def write(self, rel, content, replace=""):
        """Writes the whole file, or with `replace` swaps that exact text (it must occur once) for `content`."""
        self.need("write")
        p = self.path(rel, must_exist=bool(replace))
        if len(content.encode("utf-8")) > MAX_WRITE:
            raise ValueError("Content is larger than 1 MB")
        existed = p.is_file()
        if replace:
            old = p.read_text(encoding="utf-8")
            count = old.count(replace)
            if count != 1:
                raise ValueError(f"The text to replace occurs {count} times in {self.rel(p)}; it must occur exactly once")
            content = old.replace(replace, content)
        if existed and p.read_text(encoding="utf-8", errors="replace") == content:
            return {"path": self.rel(p), "unchanged": True}
        backup = self.backup(p) if existed else None
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(f".{p.name}.hub-tmp")
        tmp.write_text(content, encoding="utf-8", newline="")
        if existed:
            shutil.copymode(p, tmp)
        os.replace(tmp, p)
        action = "edited" if existed else "created"
        self.changes.append({"action": action, "path": self.rel(p)})
        return {"path": self.rel(p), action: True, "backup": backup}

    def delete(self, rel):
        self.need("delete")
        p = self.path(rel)
        backup = self.backup(p)
        p.unlink()
        self.changes.append({"action": "deleted", "path": self.rel(p)})
        return {"path": self.rel(p), "deleted": True, "backup": backup}

    # ---- commands
    def run(self, command, cancelled=lambda: False, on_proc=None):
        self.need("run")
        command = str(command or "").strip()
        if not command or len(command) > 2000:
            raise ValueError("Give a command of up to 2,000 characters")
        env = {k: v for k, v in os.environ.items() if k != "GROQ_API_KEY"}
        posix = os.name != "nt"
        proc = subprocess.Popen(command, shell=True, cwd=self.root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, env=env, start_new_session=posix)
        proc.hub_group = posix                     # kill() may stop the whole process group
        if on_proc:
            on_proc(proc)
        started = time.time()
        timed_out = False
        try:
            out, _ = proc.communicate(timeout=RUN_TIMEOUT)
        except subprocess.TimeoutExpired:
            timed_out = True
            self.kill(proc)
            out, _ = proc.communicate()
        text = out.decode("utf-8", "replace")
        if len(text) > RUN_OUTPUT:
            text = text[:RUN_OUTPUT // 2] + "\n… [output shortened] …\n" + text[-RUN_OUTPUT // 2:]
        self.changes.append({"action": "ran", "path": command[:200], "exit": proc.returncode})
        return {"command": command, "exitCode": proc.returncode, "output": text, "timedOut": timed_out,
                "cancelled": cancelled(), "seconds": round(time.time() - started, 1)}

    @staticmethod
    def kill(proc):
        if proc.poll() is not None:
            return
        try:
            if getattr(proc, "hub_group", False) is True:
                os.killpg(proc.pid, signal.SIGKILL)       # the shell and everything it started
            else:
                proc.kill()
        except OSError:
            proc.kill()
