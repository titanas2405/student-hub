"""Tests for local tools, including real PDF processing when programs are installed."""
import io
import json
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import server
import student_tools as tools


def sample_pdf(text='Student Hub test', count=1):
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               f'<< /Type /Pages /Count {count} /Kids [{" ".join(f"{4+i*2} 0 R" for i in range(count))}] >>'.encode(),
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    for i in range(count):
        stream = f'BT /F1 18 Tf 50 740 Td ({text} page {i+1}) Tj ET'.encode()
        objects.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents {5+i*2} 0 R >>'.encode(),
                        b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream'])
    result = b'%PDF-1.4\n'
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += f'{index} 0 obj\n'.encode() + obj + b'\nendobj\n'
    xref = len(result)
    result += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
    result += b''.join(f'{offset:010} 00000 n \n'.encode() for offset in offsets[1:])
    result += f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return result


def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in entries:
            info = zipfile.ZipInfo(name)
            info.filename = name     # keep the name exactly: on Windows ZipInfo would turn "a\\b" into "a/b"
            if name.endswith('/'):
                info.external_attr = 0o40775 << 16 | 0x10
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    return output.getvalue()


class ArchiveToolsTests(unittest.TestCase):
    def test_nested_unicode_and_empty_files(self):
        source = archive([('notes/', b''), ('notes/μάθημα.txt', 'Ελληνικά'.encode()), ('notes/empty.txt', b'')])
        listing, _, _ = tools.process('zip-list', [('notes.zip', source)], {})
        self.assertEqual(len(listing['entries']), 3)
        result, mime, name = tools.process('zip-entry', [('notes.zip', source)], {'entry': 'notes/μάθημα.txt'})
        self.assertEqual(result.decode(), 'Ελληνικά')
        self.assertEqual(name, 'μάθημα.txt')
        self.assertEqual(mime, 'application/octet-stream')
        self.assertEqual(tools.process('zip-entry', [('notes.zip', source)], {'entry': 'notes/empty.txt'})[0], b'')

    def test_unsafe_paths_duplicates_and_missing_entries(self):
        for name in ('../secret', '/etc/passwd', 'a/../../secret', 'a\\b', 'C:/bad', 'a/./b'):
            with self.subTest(name=name), self.assertRaises(tools.ToolError):
                tools.checked_zip(archive([(name, b'bad')]))
        with self.assertRaises(tools.ToolError):
            tools.process('zip-entry', [('safe.zip', archive([('safe.txt', b'safe')]))], {'entry': '../other'})
        with self.assertRaises(tools.ToolError):
            tools.checked_zip(b'invalid archive')

    def test_archive_expansion_and_entry_limits(self):
        source = archive([('a', b'a' * 100)])
        with patch.object(tools, 'MAX_EXTRACTED', 50), self.assertRaises(tools.ToolError):
            tools.checked_zip(source)
        with self.assertRaises(tools.ToolError):
            tools.checked_zip(archive([(f'{i}.txt', b'') for i in range(2001)]))

    def test_symlinks_are_rejected(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as z:
            link = zipfile.ZipInfo('link')
            link.create_system = 3
            link.external_attr = 0o120777 << 16
            z.writestr(link, '/etc/passwd')
        with self.assertRaises(tools.ToolError):
            tools.checked_zip(output.getvalue())


class PdfToolsTests(unittest.TestCase):
    def test_page_ranges_preserve_requested_order(self):
        self.assertEqual(tools.page_selection('3, 1-2, 2', 3), [3, 1, 2, 2])
        for value in ('', '0', '4', '2-1', '1;rm', '1,', '-1'):
            with self.subTest(value=value), self.assertRaises(tools.ToolError):
                tools.page_selection(value, 3)

    @unittest.skipUnless(all(shutil.which(p) for p in ('pdfinfo', 'pdfunite', 'pdfseparate', 'pdftotext', 'gs')), 'PDF programs not installed')
    def test_real_merge_split_and_compress(self):
        first, second = sample_pdf('First', 2), sample_pdf('Second')
        merged, mime, _ = tools.process('merge', [('a.pdf', first), ('b.pdf', second)], {})
        self.assertEqual(mime, 'application/pdf')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'merged.pdf'
            path.write_bytes(merged)
            self.assertEqual(tools.pdf_pages(path), 3)
        selected, _, _ = tools.process('split', [('merged.pdf', merged)], {'pages': '3,1'})
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'selected.pdf'
            path.write_bytes(selected)
            text = tools.run(['pdftotext', str(path), '-']).decode()
        self.assertLess(text.index('Second'), text.index('First'))
        self.assertNotIn('First page 2', text)
        compressed, _, _ = tools.process('compress', [('a.pdf', first)], {'quality': 'ebook'})
        self.assertTrue(compressed.startswith(b'%PDF-'))
        self.assertLessEqual(len(compressed), len(first))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'compressed.pdf'
            path.write_bytes(compressed)
            self.assertIn('First', tools.run(['pdftotext', str(path), '-']).decode())

    def test_missing_program_and_invalid_upload(self):
        with patch.object(tools.shutil, 'which', return_value=None), self.assertRaises(tools.ToolError) as error:
            tools.run(['gs', '-h'])
        self.assertEqual(error.exception.status, 503)
        for operation, files in [('merge', [('one.pdf', b'%PDF-')]), ('compress', [('bad.pdf', b'not a PDF')]), ('compress', [])]:
            with self.subTest(operation=operation), self.assertRaises(tools.ToolError):
                tools.process(operation, files, {})



class ToolRouteTests(unittest.TestCase):
    def setUp(self):
        self.handler = object.__new__(server.Handler)
        self.handler._session = lambda: SimpleNamespace(csrf='token')
        self.handler.headers = {'Content-Type': 'multipart/form-data; boundary=test-boundary', 'X-CSRF-Token': 'token'}
        self.handler._json, self.handler._send = Mock(), Mock()
        self.handler.body = (b'--test-boundary\r\nContent-Disposition: form-data; name="files"; filename="notes.zip"\r\nContent-Type: application/zip\r\n\r\n' +
                             archive([('notes.txt', b'notes')]) + b'\r\n--test-boundary--\r\n')

    def test_multipart_archive_upload(self):
        self.handler.api_post_tools_process({'op': ['zip-list']})
        result = self.handler._json.call_args.args[1]
        self.assertEqual(result['entries'][0]['path'], 'notes.txt')

    def test_csrf_rejected_before_processing(self):
        self.handler.headers['X-CSRF-Token'] = 'bad'
        with patch.object(tools, 'process') as process, self.assertRaises(server.ApiError) as error:
            self.handler.api_post_tools_process({'op': ['zip-list']})
        self.assertEqual(error.exception.status, 403)
        process.assert_not_called()


if __name__ == '__main__':
    unittest.main()
