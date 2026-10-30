"""Local document and archive tools. Uses Python's standard library and optional CLI tools."""
import io
import re
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

MAX_UPLOAD = 50 * 1024 * 1024
MAX_EXTRACTED = 200 * 1024 * 1024


class ToolError(Exception):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def capabilities():
    return {"gs": bool(ghostscript()), **{name: bool(find_program(name))
            for name in ('pdfunite', 'pdfseparate', 'pdfinfo')}}


# Where Windows installers put programs without adding them to PATH.
WINDOWS_PLACES = {
    "soffice": ["LibreOffice/program/soffice.exe"],
    "libreoffice": ["LibreOffice/program/soffice.exe"],
    "gswin64c": ["gs/*/bin/gswin64c.exe"],
    "gswin32c": ["gs/*/bin/gswin32c.exe"],
    "pdfinfo": ["poppler*/Library/bin/pdfinfo.exe", "poppler*/bin/pdfinfo.exe", "Microsoft/WinGet/Packages/*Poppler*/poppler*/Library/bin/pdfinfo.exe"],
    "pdfunite": ["poppler*/Library/bin/pdfunite.exe", "poppler*/bin/pdfunite.exe", "Microsoft/WinGet/Packages/*Poppler*/poppler*/Library/bin/pdfunite.exe"],
    "pdfseparate": ["poppler*/Library/bin/pdfseparate.exe", "poppler*/bin/pdfseparate.exe", "Microsoft/WinGet/Packages/*Poppler*/poppler*/Library/bin/pdfseparate.exe"],
    "pdftotext": ["poppler*/Library/bin/pdftotext.exe", "poppler*/bin/pdftotext.exe", "Microsoft/WinGet/Packages/*Poppler*/poppler*/Library/bin/pdftotext.exe"],
}


IS_WINDOWS = os.name == "nt"


def find_program(*names):
    """A program on PATH, or on Windows in its usual install folder under Program Files."""
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    if IS_WINDOWS:
        roots = {os.environ.get(k) for k in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA")} - {None}
        for name in names:
            for pattern in WINDOWS_PLACES.get(name, []):
                for root in sorted(roots):
                    hits = sorted(Path(root).glob(pattern), reverse=True)        # newest version first
                    if hits:
                        return str(hits[0])
    return None


def ghostscript():
    """Find Ghostscript under its Unix or Windows executable name."""
    return find_program("gs", "gswin64c", "gswin32c")


def run(args, timeout=90):
    program = find_program(args[0])
    if not program:
        raise ToolError(f"Install {args[0]} on the computer running Student Hub to enable this tool", 503)
    args = [program, *args[1:]]
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise ToolError('Processing took too long. Try a smaller file', 504)
    except OSError:
        raise ToolError(f"Couldn't start {args[0]}", 503)
    if result.returncode:
        raise ToolError("Couldn't process this file. Check that it opens normally and isn't encrypted or damaged")
    return result.stdout


def pdf_pages(path):
    output = run(['pdfinfo', str(path)]).decode('utf-8', 'replace')
    match = re.search(r'^Pages:\s+(\d+)', output, re.M)
    if not match or not 1 <= int(match[1]) <= 300:
        raise ToolError('Choose a PDF with at most 300 pages')
    return int(match[1])


def page_selection(value, total):
    pages = []
    if not value.strip() or len(value) > 2000:
        raise ToolError('Enter pages such as 1-3, 5, 8-10', 400)
    for token in value.split(','):
        match = re.fullmatch(r'\s*(\d+)(?:\s*-\s*(\d+))?\s*', token)
        if not match:
            raise ToolError('Enter pages such as 1-3, 5, 8-10', 400)
        start, end = int(match[1]), int(match[2] or match[1])
        if not 1 <= start <= end <= total:
            raise ToolError(f'Page numbers must be between 1 and {total}', 400)
        pages.extend(range(start, end + 1))
        if len(pages) > 300:
            raise ToolError('Select at most 300 pages', 400)
    return pages


def checked_zip(data):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        entries = archive.infolist()
        if len(entries) > 2000 or sum(e.file_size for e in entries) > MAX_EXTRACTED:
            raise ToolError('ZIP files may contain at most 2,000 entries and 200 MB of extracted data')
        seen = set()
        for entry in entries:
            name = entry.orig_filename          # as stored: on Windows zipfile turns "a\\b" into "a/b" in .filename
            parts = name.rstrip('/').split('/')
            if (name.startswith('/') or '\\' in name or any(p in ('', '.', '..') for p in parts)
                    or any(ord(c) < 32 for c in name) or ':' in name or name in seen):
                raise ToolError('This ZIP contains unsafe or duplicate file paths')
            if entry.flag_bits & 1:
                raise ToolError('Password-protected ZIP files are not supported')
            if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA):
                raise ToolError('This ZIP uses an unsupported compression format')
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ToolError('ZIP files containing symbolic links are not supported')
            seen.add(name)
        return archive
    except (zipfile.BadZipFile, OSError, ValueError):
        raise ToolError('Choose a valid ZIP file')


def process(operation, files, fields):
    """Return (bytes or JSON-compatible dict, MIME type, download filename)."""
    if not files or len(files) > 20:
        raise ToolError('Choose between 1 and 20 files', 400)
    if any(not data for _, data in files) or sum(len(data) for _, data in files) > MAX_UPLOAD:
        raise ToolError('Choose nonempty files totalling at most 50 MB', 413)
    if operation in ('zip-list', 'zip-entry'):
        if len(files) != 1:
            raise ToolError('Choose one ZIP file', 400)
        with checked_zip(files[0][1]) as archive:
            if operation == 'zip-list':
                return {'entries': [{'path': e.filename, 'size': e.file_size, 'directory': e.is_dir()}
                                    for e in archive.infolist()]}, 'application/json', ''
            name = fields.get('entry', '')
            try:
                entry = archive.getinfo(name)
                if entry.is_dir():
                    raise ToolError('Choose a file rather than a directory', 400)
                with archive.open(entry) as stream:
                    result = stream.read(MAX_EXTRACTED + 1)
                if len(result) > MAX_EXTRACTED:
                    raise ToolError('This extracted file is too large', 413)
                return result, 'application/octet-stream', PurePosixPath(name).name
            except (KeyError, zipfile.BadZipFile, RuntimeError, EOFError, OSError, NotImplementedError):
                raise ToolError("Couldn't extract this ZIP entry")
    if operation not in ('compress', 'merge', 'split'):
        raise ToolError('Unknown tool', 400)
    if operation != 'merge' and len(files) != 1 or operation == 'merge' and len(files) < 2:
        raise ToolError('Choose at least two PDFs to merge, or one file for other tools', 400)
    with tempfile.TemporaryDirectory(prefix='student-hub-tools-') as folder:
        root = Path(folder)
        paths = []
        total_pages = 0
        for index, (name, data) in enumerate(files):
            if not data.startswith(b'%PDF-'):
                raise ToolError('Choose PDF files', 400)
            path = root / f'input-{index}.pdf'
            path.write_bytes(data)
            paths.append(path)
            total_pages += pdf_pages(path)
        if total_pages > 300:
            raise ToolError('Choose at most 300 PDF pages in total')
        output = root / 'result.pdf'
        if operation == 'merge':
            run(['pdfunite', *map(str, paths), str(output)])
        elif operation == 'split':
            pages = page_selection(fields.get('pages', ''), total_pages)
            run(['pdfseparate', '-f', str(min(pages)), '-l', str(max(pages)), str(paths[0]), str(root / 'page-%d.pdf')])
            if len(pages) == 1:
                output.write_bytes((root / f'page-{pages[0]}.pdf').read_bytes())
            else:
                run(['pdfunite', *[str(root / f'page-{p}.pdf') for p in pages], str(output)])
        elif operation == 'compress':
            preset = fields.get('quality', 'ebook')
            if preset not in ('screen', 'ebook', 'printer'):
                raise ToolError('Invalid compression quality', 400)
            run([ghostscript(), '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pdfwrite',
                 '-dCompatibilityLevel=1.4', '-dPDFSETTINGS=/' + preset,
                 '-sOutputFile=' + str(output), str(paths[0])])
            if output.is_file() and output.stat().st_size >= len(files[0][1]):
                return files[0][1], 'application/pdf', 'original.pdf'
        if not output.is_file() or not output.read_bytes().startswith(b'%PDF-'):
            raise ToolError("Couldn't produce a PDF from this file")
        if output.stat().st_size > MAX_EXTRACTED:
            raise ToolError('The output is too large. Try fewer pages', 413)
        return output.read_bytes(), 'application/pdf', {'compress': 'compressed.pdf', 'merge': 'merged.pdf', 'split': 'extracted-pages.pdf'}[operation]
