"""Headless CLI adapters. No API keys or Python dependencies required."""
import base64
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import tempfile

PROVIDERS = {"claude": ("Claude", "claude"), "gemini": ("Gemini", "gemini"),
             "chatgpt": ("ChatGPT (Codex CLI)", "codex"),
             "antigravity": ("Google Antigravity CLI", "agy")}


def binary(provider):
    name = PROVIDERS[provider][1]
    if provider == "antigravity":
        override = os.environ.get("STUDENT_HUB_AGY")
        if override:
            return override
    installed = shutil.which(name)
    if installed:
        return installed
    if provider == "antigravity":
        if os.name == "nt":
            local_app_data = os.environ.get("LOCALAPPDATA")
            if local_app_data:
                return str(Path(local_app_data) / "agy" / "bin" / "agy.exe")
            return str(Path.home() / "AppData" / "Local" / "agy" / "bin" / "agy.exe")
        return str(Path.home() / ".local" / "bin" / name)
    return str(Path.home() / ".local" / "bin" / name)


def available(provider):
    return os.access(binary(provider), os.X_OK)


def validate(value, schema, path="response"):
    """Validate the JSON Schema subset used by Student Hub before consuming output."""
    kind = schema.get("type")
    valid = {"object": isinstance(value, dict), "array": isinstance(value, list),
             "string": isinstance(value, str), "number": isinstance(value, (int, float)) and not isinstance(value, bool),
             "integer": isinstance(value, int) and not isinstance(value, bool), "boolean": isinstance(value, bool)}
    if kind and not valid.get(kind, False):
        raise RuntimeError(f"Invalid AI JSON: {path} must be {kind}")
    if "enum" in schema and value not in schema["enum"]:
        raise RuntimeError(f"Invalid AI JSON: {path} has an unknown value")
    if isinstance(value, dict):
        if any(key not in value for key in schema.get("required", [])):
            raise RuntimeError(f"Invalid AI JSON: {path} is missing required fields")
        for key, item in value.items():
            if key in schema.get("properties", {}):
                validate(item, schema["properties"][key], f"{path}.{key}")
    if isinstance(value, list):
        for item in value:
            validate(item, schema.get("items", {}), path + "[]")


def strict_schema(schema):
    """Codex structured output requires every property to be required."""
    out = dict(schema)
    if out.get("type") == "object":
        out["properties"] = {k: strict_schema(v) for k, v in out.get("properties", {}).items()}
        out.update(additionalProperties=False, required=list(out["properties"]))
    if "items" in out:
        out["items"] = strict_schema(out["items"])
    return out


def run(content, settings, schema=None, on_text=None, on_proc=None, timeout=900):
    provider = settings["provider"]
    label = PROVIDERS[provider][0]
    if not available(provider):
        raise RuntimeError(f"Install and sign in to {label} first (see README).")
    # An empty private working directory avoids loading a project's instructions or files.
    with tempfile.TemporaryDirectory(prefix="student-hub-ai-") as work:
        folder = Path(work)
        pieces, images = [], []
        for block in content:
            if block.get("type") == "text":
                pieces.append(block["text"])
            elif block.get("type") == "image":
                path = folder / f"frame-{len(images)}.jpg"
                path.write_bytes(base64.b64decode(block["source"]["data"], validate=True))
                images.append(path)
                if provider == "gemini":
                    pieces.append(f"[Image attachment: {path.name}]")
                elif provider == "antigravity":
                    pieces.append(f"[Attached image file: {path}]")
        prompt = "\n\n".join(pieces)
        if schema and provider != "antigravity":
            prompt += "\n\nReturn ONLY a JSON object matching this schema, without Markdown fences:\n" + json.dumps(schema)
        if provider == "gemini":
            # Only our explicit image paths may expand as local-file references.
            prompt = prompt.replace("@", "\\@")
        env = {k: v for k, v in os.environ.items() if k != "GROQ_API_KEY"}
        schema_path = None
        if provider == "chatgpt":
            output = folder / "answer.txt"
            args = [binary(provider), "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral",
                    "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never",
                    "-c", 'approval_policy="never"', "-c", "features.shell_tool=false",
                    "-c", "features.apply_patch=false", "-c", "features.multi_agent=false",
                    "-c", "features.apps=false", "-c", "features.hooks=false",
                    "-c", 'web_search="disabled"',
                    "-o", str(output)]
            if settings.get("effort"):
                args += ["-c", 'model_reasoning_effort=' + json.dumps(settings["effort"])]
            if schema:
                schema_path = folder / "schema.json"
                schema_path.write_text(json.dumps(strict_schema(schema)))
                args += ["--output-schema", str(schema_path)]
            for path in images:
                args += ["--image", str(path)]
            args += ["-"]
        elif provider == "gemini":
            # Keep the user's OAuth login, override tool/MCP discovery for this process only.
            config = folder / "settings.json"
            config.write_text(json.dumps({"tools": {"core": [], "discoveryCommand": "", "callCommand": ""},
                                          "mcp": {"allowed": []}, "mcpServers": {},
                                          "admin": {"mcp": {"enabled": False}, "extensions": {"enabled": False}, "skills": {"enabled": False}},
                                          "general": {"enableAutoUpdate": False}, "hooks": {"enabled": False}}))
            env["GEMINI_CLI_SYSTEM_SETTINGS_PATH"] = str(config)
            args = [binary(provider), "--output-format", "json", "--extensions", "none", "-p",
                    "Answer using only the supplied context. Do not call tools." + "".join(f" @{path}" for path in images)]
        else:
            args = [binary(provider), "--sandbox", "--print-timeout", f"{timeout // 60}m",
                    "--output-format", "json", "-p",
                    "Answer using only the supplied context. Do not use tools, access other files, or perform actions. "
                    "If image files are attached, inspect only those exact files.\n\n" + prompt]
            if schema:
                schema_path = folder / "schema.json"
                schema_path.write_text(json.dumps(schema))
                args += ["--json-schema", str(schema_path)]
        if settings.get("model"):
            args += ["--model", settings["model"]]
        if provider == "antigravity" and settings.get("effort"):
            args += ["--effort", settings["effort"]]
        try:
            proc = subprocess.Popen(args, cwd=work, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True, env=env)
        except OSError as exc:
            if provider == "antigravity":
                raise RuntimeError("Google Antigravity CLI could not start. Install the build for this operating system and CPU architecture, or set STUDENT_HUB_AGY to its executable path.") from exc
            raise RuntimeError(f"{label} CLI could not start: {exc}") from exc
        if on_proc:
            on_proc(proc)
        try:
            stdout, stderr = proc.communicate(prompt, timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            proc.kill()
            proc.communicate()
            raise RuntimeError(f"{label} timed out; try again.") from exc
        if provider == "antigravity" and proc.returncode in (-signal.SIGILL, 0xC000001D):
            raise RuntimeError("Google Antigravity CLI is incompatible with this CPU (illegal instruction). Reinstall it with Google's official installer for this computer's operating system and architecture.")
        if proc.returncode:
            raise RuntimeError(f"{label}: {(stderr or stdout).strip()[-500:] or 'CLI failed; check login and model access.'}")
        model = settings.get("model") or label
        if provider == "chatgpt":
            answer = output.read_text() if output.is_file() else ""
        else:
            try:
                response = json.loads(stdout)
            except ValueError as exc:
                raise RuntimeError(f"{label} returned invalid CLI JSON") from exc
            if response.get("error"):
                raise RuntimeError(f"{label}: {str(response['error'])[:400]}")
            answer = response.get("response", "")
            if provider == "antigravity":
                if response.get("status") != "SUCCESS":
                    raise RuntimeError(f"{label}: {str(response.get('error') or response.get('status') or 'CLI failed')[:400]}")
                model = response.get("model") or model
            else:
                model = next(iter(response.get("stats", {}).get("models", {})), model)
        if not isinstance(answer, str) or not answer.strip():
            raise RuntimeError(f"{label} returned an empty answer")
        result = {"result": answer, "provider": provider, "modelUsage": {model: {}}}
        if schema:
            try:
                structured = response.get("structured_output") if provider == "antigravity" else None
                if structured is None:
                    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", answer.strip())
                    structured = json.loads(raw)
                result["structured_output"] = structured
            except ValueError as exc:
                raise RuntimeError(f"{label} returned invalid JSON; try again.") from exc
            validate(result["structured_output"], schema)
        elif on_text:
            on_text(answer)
        return result
