"""Read-only assistant retrieval, deep folder traversal and session lifecycle."""
import io
import json
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import server
from student_assistant import Assistant, FolderSearch


class FolderTests(unittest.TestCase):
    def test_deep_chain_continues_past_old_eighty_folder_limit(self):
        def listing(path):
            depth = int(path)
            return ([{'directory': str(depth + 1)}] if depth < 240 else []) + [
                {'id': str(depth), 'name': 'notes.txt', 'folder': path}]
        search = FolderSearch('0', 'notes')
        files = []
        for _ in range(100):
            page = search.page(listing, folders=5, results=7)
            files += page['files']
            if page['complete']:
                break
        self.assertTrue(page['complete'])
        self.assertEqual(len(files), 241)
        self.assertEqual(page['foldersVisited'], 241)

    def test_wide_folder_keeps_pending_results_and_breaks_cycles(self):
        search = FolderSearch('/', '')
        def listing(path):
            return [{'directory': '/'}, {'directory': '/nested'}] + [
                {'id': path + str(i), 'name': f'{i}.txt'} for i in range(105)]
        found = []
        while True:
            page = search.page(listing, folders=1, results=9)
            found.extend(item['id'] for item in page['files'])
            if page['complete']:
                break
        self.assertEqual(len(found), 210)
        self.assertEqual(len(set(found)), 210)
        self.assertEqual(search.visited, 2)

    def test_errors_and_cancellation_are_reported(self):
        search = FolderSearch('/', '')
        page = search.page(Mock(side_effect=RuntimeError('Disconnected')))
        self.assertEqual(page['errors'][0]['error'], 'Disconnected')
        search = FolderSearch('/', '')
        listing = Mock()
        page = search.page(listing, cancelled=lambda: True)
        self.assertFalse(page['complete'])
        self.assertTrue(page['cancelled'])
        listing.assert_not_called()


class AssistantTests(unittest.TestCase):
    def setUp(self):
        self.account = Mock(mail=True, username='test-user')
        self.session = SimpleNamespace(inst='uoa', account=self.account, ditlab=None, eclass=None,
                                       piazza=None, portal=None, assistant=None)
        self.assistant = Assistant(server, self.session)
        self.ec = Mock()
        self.ec.get_courses.return_value = [{'code': 'TEST', 'title': 'Algorithms'}]

    def test_recursive_eclass_search_registers_and_reads_nested_document(self):
        def details(code, tab, directory):
            level = int(directory or '0')
            return {'items': [{'dir': str(level + 1), 'name': f'Folder {level + 1}'}] if level < 130 else [
                {'name': 'exam.txt', 'url': 'https://eclass.uoa.gr/modules/document/file.txt'}]}
        self.ec.details.side_effect = details
        with patch.object(server, 'session_eclass', return_value=self.ec):
            action = {'tool': 'search_files', 'source': 'eclass', 'course': 'TEST', 'query': 'exam'}
            for _ in range(4):
                result = self.assistant.retrieve(action, {})
                if result['complete']:
                    break
                action = {'tool': 'search_files', 'cursor': result['cursor']}
            self.assertTrue(result['complete'])
            doc = result['files'][0]
            with patch.object(server, 'eclass_open', return_value=io.BytesIO(b'Exam topics: graphs and trees.')):
                refs = {}
                result = self.assistant.retrieve({'tool': 'document', 'id': doc['id']}, refs)
            self.assertIn('graphs', result['text'])
            self.assertIn(doc['id'], refs)
            self.assertEqual(doc['folder'], '130')

    def test_ditlab_deep_files_download_via_connected_session_only(self):
        ditlab = self.session.ditlab = Mock()
        ditlab.list.side_effect = lambda path: {'items': [
            {'name': 'nested', 'path': '/a/b/c', 'isDir': True}] if path == '/' else [
            {'name': 'past-exam.txt', 'path': '/a/b/c/past-exam.txt', 'isDir': False}]}
        result = self.assistant.retrieve({'tool': 'search_files', 'source': 'ditlab', 'query': 'exam'}, {})
        self.assertTrue(result['complete'])
        doc = result['files'][0]
        ditlab.open.return_value = io.BytesIO(b'Exam questions')
        text = self.assistant.retrieve({'tool': 'document', 'id': doc['id']}, {})
        self.assertEqual(text['text'], 'Exam questions')
        self.session.ditlab = None
        with self.assertRaisesRegex(ValueError, 'disconnected'):
            self.assistant.retrieve({'tool': 'document', 'id': doc['id']}, {})

    def test_unregistered_files_and_other_courses_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unknown document'):
            self.assistant.retrieve({'tool': 'document', 'id': '/etc/passwd'}, {})
        with patch.object(server, 'session_eclass', return_value=self.ec):
            with self.assertRaisesRegex(ValueError, 'enrolled'):
                self.assistant.retrieve({'tool': 'folder', 'source': 'eclass', 'course': 'OTHER'}, {})
        with self.assertRaises(server.ApiError):
            self.assistant.listing('ditlab', '', '/../secret') if self.session.ditlab else server.ditlab_path('/../secret')

    def test_mail_and_attachments_are_read_without_marking_seen(self):
        self.account.get_message.return_value = {'text': 'Hello student', 'subject': 'Assignment',
                                                'attachments': [{'name': 'assignment.txt'}]}
        refs = {}
        result = self.assistant.retrieve({'tool': 'mail_read', 'id': '123', 'source': 'inbox'}, refs)
        self.account.get_message.assert_called_once_with('inbox', '123', mark_seen=False)
        doc = result['attachments'][0]
        self.account.get_attachment.return_value = ('assignment.txt', b'Assignment details')
        result = self.assistant.retrieve({'tool': 'document', 'id': doc['id']}, refs)
        self.account.get_attachment.assert_called_once_with('inbox', '123', 0)
        self.assertEqual(result['text'], 'Assignment details')

    def test_document_pagination_is_explicit(self):
        text = 'x' * 50000
        page = self.assistant.chunk(text, 0)
        self.assertFalse(page['complete'])
        self.assertEqual(page['nextOffset'], 22000)
        end = self.assistant.chunk(text, 44000)
        self.assertTrue(end['complete'])
        self.assertIsNone(end['nextOffset'])

    def test_closing_session_clears_sources_and_kills_cli(self):
        proc = Mock()
        proc.poll.return_value = None
        job = {'status': 'running', 'proc': proc, 'cancel': threading.Event()}
        self.assistant.job = job
        self.assistant.files['secret'] = {}
        self.assistant.messages.append({'role': 'user', 'text': 'Private question'})
        self.assistant.cancel(clear=True, close=True)
        self.assertTrue(job['cancel'].is_set())
        proc.kill.assert_called_once()
        self.assertEqual(self.assistant.status()['messages'], [])
        self.assertEqual(self.assistant.files, {})
        with self.assertRaises(server.ApiError):
            self.assistant.ask('Next question')

    def test_model_requests_retrieval_then_answer_with_validated_sources(self):
        job = {'status': 'running', 'cancel': threading.Event(), 'activity': [], 'settings': {'provider': 'gemini'}}
        self.assistant.job = job
        def retrieve(action, refs, cancelled):
            self.assistant.reference(refs, 'deadlines', 'Deadlines', view='deadlines')
            return {'items': [{'title': 'Assignment', 'deadline': '2026-11-03'}]}
        self.assistant.retrieve = retrieve
        responses = [{'structured_output': {'answer': '', 'sources': [], 'actions': [{'tool': 'deadlines'}]}},
                     {'structured_output': {'answer': 'Assignment due November 3 [deadlines].',
                                            'sources': ['deadlines', 'invented'], 'actions': []}}]
        with patch.object(server, 'run_ai', side_effect=responses) as run:
            self.assistant._answer('What is due?', [], job)
        self.assertEqual(run.call_count, 2)
        self.assertIn('2026-11-03', run.call_args.args[0][1]['text'])
        message = self.assistant.messages[-1]
        self.assertEqual(message['provider'], 'gemini')
        self.assertEqual([ref['id'] for ref in message['sources']], ['deadlines'])
        self.assertFalse(self.assistant.status()['busy'])

    def test_unfinished_search_is_disclosed_even_if_model_omits_it(self):
        job = {'status': 'running', 'cancel': threading.Event(), 'activity': [], 'settings': {'provider': 'claude'}}
        self.assistant.job = job
        self.assistant.retrieve = Mock(return_value={'complete': False, 'cursor': 'remaining-folders', 'files': []})
        responses = [{'structured_output': {'answer': '', 'sources': [], 'actions': [{'tool': 'search_files'}]}},
                     {'structured_output': {'answer': 'Here is the result.', 'sources': [], 'actions': []}}]
        with patch.object(server, 'run_ai', side_effect=responses):
            self.assistant._answer('Find documents', [], job)
        self.assertIn('Περιορισμοί ελέγχου', self.assistant.messages[-1]['text'])

    def test_existing_study_source_browser_reaches_deep_folders(self):
        client = server.EclassClient(Mock(), 'https://eclass.example.test/')
        def details(code, tab, path):
            depth = int(path or '0')
            return {'items': [{'dir': str(depth+1), 'name': 'nested'}] if depth < 90 else [
                {'dir': None, 'name': 'exam.txt', 'url': 'https://eclass.example.test/courses/exam.txt'}]}
        client.details = details
        result = client.all_documents('TEST')
        self.assertEqual(result[0]['name'], 'exam.txt')
        self.assertEqual(result[0]['folder'].count('nested'), 90)

    def test_endpoint_requires_csrf_before_starting_job(self):
        handler = Mock()
        handler._require_csrf.side_effect = server.ApiError(403, 'Invalid request token')
        with self.assertRaises(server.ApiError):
            server.Handler.api_post_assistant(handler, {})
        handler._student_assistant.assert_not_called()


if __name__ == '__main__':
    unittest.main()
