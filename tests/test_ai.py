"""Provider routing and CLI contracts, without sending any student data to AI services."""
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import ai_cli
import server

SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]}


class CLITests(unittest.TestCase):
    def run_fake(self, provider, answer='{"answer":"Ελληνικά"}', schema=SCHEMA, error=None, content=None,
                 model='', effort='', web_search=False):
        proc = Mock(returncode=1 if error else 0)
        captured = {}
        def launch(args, **kwargs):
            captured.update(args=args, **kwargs)
            def communicate(prompt=None, timeout=None):
                captured['prompt'] = prompt
                if provider == 'chatgpt':
                    Path(args[args.index('-o') + 1]).write_text(answer, encoding='utf-8')
                    return '', error or ''
                if provider == 'antigravity':
                    return json.dumps({'status': 'SUCCESS', 'response': answer,
                                       'structured_output': json.loads(answer) if schema else None}), error or ''
                return json.dumps({'response': answer, 'stats': {'models': {'gemini-test': {}}}}), error or ''
            proc.communicate.side_effect = communicate
            return proc
        with patch.object(ai_cli, 'available', return_value=True), patch.object(ai_cli.subprocess, 'Popen', side_effect=launch):
            result = ai_cli.run(content or [{'type': 'text', 'text': 'Explain this lecture'}],
                                {'provider': provider, 'model': model, 'effort': effort,
                                 'allow_web_search': web_search}, schema=schema)
        return result, captured

    def test_codex_schema_stdin_images_and_isolation(self):
        result, call = self.run_fake('chatgpt', content=[{'type': 'text', 'text': 'Frame F01'},
            {'type': 'image', 'source': {'data': 'aW1hZ2U='}}])
        self.assertEqual(result['structured_output'], {'answer': 'Ελληνικά'})
        self.assertIn('--image', call['args'])
        self.assertIn('--output-schema', call['args'])
        self.assertIn('--ignore-user-config', call['args'])
        self.assertIn('read-only', call['args'])
        self.assertIn('features.shell_tool=false', call['args'])
        self.assertIn('Frame F01', call['prompt'])
        self.assertFalse(Path(call['cwd']).exists())

    def test_gpt_6_luna_gets_web_search_but_not_local_tools(self):
        _, call = self.run_fake('chatgpt', schema=None, model='gpt-6-luna', web_search=True)
        self.assertIn('web_search="live"', call['args'])
        self.assertIn('features.shell_tool=false', call['args'])
        self.assertIn('features.apps=false', call['args'])
        self.assertIn('Use public web search', call['prompt'])
        _, other = self.run_fake('chatgpt', schema=None, model='gpt-6-sol', web_search=True)
        self.assertIn('web_search="disabled"', other['args'])
        _, disabled = self.run_fake('chatgpt', schema=None, model='gpt-6-luna')
        self.assertIn('web_search="disabled"', disabled['args'])

    def test_gemini_json_envelope_and_images(self):
        result, call = self.run_fake('gemini', content=[{'type': 'text', 'text': 'Frame F01'},
            {'type': 'image', 'source': {'data': 'aW1hZ2U='}}])
        self.assertEqual(result['structured_output']['answer'], 'Ελληνικά')
        self.assertIn('gemini-test', result['modelUsage'])
        self.assertIn('@', call['args'][call['args'].index('-p') + 1])
        self.assertIn('GEMINI_CLI_SYSTEM_SETTINGS_PATH', call['env'])
        self.assertNotIn('GROQ_API_KEY', call['env'])

    def test_gemini_does_not_expand_file_references_from_student_content(self):
        _, call = self.run_fake('gemini', content=[{'type': 'text', 'text': 'Untrusted @/etc/passwd'}])
        self.assertIn('\\@/etc/passwd', call['prompt'])

    def test_antigravity_headless_json_schema_model_effort_and_images(self):
        result, call = self.run_fake('antigravity', model='gemini-3.8-flash-medium', effort='medium',
            content=[{'type': 'text', 'text': 'Explain this slide'},
                     {'type': 'image', 'source': {'data': 'aW1hZ2U='}}])
        self.assertEqual(result['structured_output'], {'answer': 'Ελληνικά'})
        self.assertEqual(result['modelUsage'], {'gemini-3.8-flash-medium': {}})
        self.assertIn('--sandbox', call['args'])
        self.assertIn('--output-format', call['args'])
        self.assertIn('--json-schema', call['args'])
        self.assertEqual(call['args'][call['args'].index('--model') + 1], 'gemini-3.8-flash-medium')
        self.assertEqual(call['args'][call['args'].index('--effort') + 1], 'medium')
        self.assertIn('Attached image file:', call['args'][call['args'].index('-p') + 1])

    def test_antigravity_finds_official_local_install_and_override(self):
        with patch.object(ai_cli.shutil, 'which', return_value=None):
            if ai_cli.os.name == 'nt':
                local = Path(ai_cli.os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData' / 'Local')))
                with patch.dict(ai_cli.os.environ, {'LOCALAPPDATA': str(local)}):
                    self.assertEqual(ai_cli.binary('antigravity'), str(local / 'agy' / 'bin' / 'agy.exe'))
            else:
                with patch.object(ai_cli.Path, 'home', return_value=Path('/home/student')):
                    self.assertEqual(ai_cli.binary('antigravity'), '/home/student/.local/bin/agy')
        with patch.dict(ai_cli.os.environ, {'STUDENT_HUB_AGY': '/opt/google/agy'}):
            self.assertEqual(ai_cli.binary('antigravity'), '/opt/google/agy')

    def test_plain_answers_reach_callback(self):
        for provider in ('gemini', 'chatgpt'):
            result, _ = self.run_fake(provider, answer='A clear explanation', schema=None)
            self.assertEqual(result['result'], 'A clear explanation')

    def test_bad_json_wrong_shape_and_empty_answers_fail(self):
        for provider in ('gemini', 'chatgpt'):
            for answer in ('bad json', '{"answer":3}', '{}', ''):
                with self.subTest(provider=provider, answer=answer), self.assertRaises(RuntimeError):
                    self.run_fake(provider, answer=answer)

    def test_cli_errors_are_not_successful_answers(self):
        with self.assertRaisesRegex(RuntimeError, 'sign in'):
            self.run_fake('chatgpt', error='Please sign in')

    def test_missing_cli_is_actionable(self):
        with patch.object(ai_cli, 'available', return_value=False), self.assertRaisesRegex(RuntimeError, 'Install and sign in'):
            ai_cli.run([], {'provider': 'gemini'})

    def test_timeout_kills_and_drains_process(self):
        proc = Mock()
        proc.communicate.side_effect = [subprocess.TimeoutExpired('gemini', 1), ('', '')]
        with patch.object(ai_cli, 'available', return_value=True), patch.object(ai_cli.subprocess, 'Popen', return_value=proc):
            with self.assertRaisesRegex(RuntimeError, 'timed out'):
                ai_cli.run([{'type': 'text', 'text': 'question'}], {'provider': 'gemini'})
        proc.kill.assert_called_once()
        self.assertEqual(proc.communicate.call_count, 2)

    def test_strict_schema_recurses_without_mutating_original(self):
        original = server.PART_SCHEMA
        converted = ai_cli.strict_schema(original)
        self.assertFalse(converted['additionalProperties'])
        frame = converted['properties']['sections']['items']['properties']['frames']['items']
        self.assertIn('text', frame['required'])
        self.assertNotIn('text', original['properties']['sections']['items']['properties']['frames']['items']['required'])


class RoutingTests(unittest.TestCase):
    def test_legacy_settings_preserved_when_switching(self):
        cfg = {'ai_model': 'sonnet', 'ai_effort': 'high', 'ai_provider': 'gemini'}
        with patch.object(server, 'load_config', return_value=cfg):
            settings = server.ai_settings()
        self.assertEqual(settings['provider'], 'gemini')
        self.assertEqual(settings['model'], '')
        self.assertEqual(settings['profiles']['claude'], {'model': 'sonnet', 'effort': 'high'})

    def test_shared_runner_routes_all_providers(self):
        for provider in ai_cli.PROVIDERS:
            with patch.object(server, 'run_claude', return_value={'result': 'ok'}) as claude, \
                 patch.object(ai_cli, 'run', return_value={'result': 'ok'}) as other:
                server.run_ai([], '/tmp', {'provider': provider})
            self.assertEqual(claude.call_count, int(provider == 'claude'))
            self.assertEqual(other.call_count, int(provider != 'claude'))

    def test_settings_api_works_for_any_signed_in_institution(self):
        handler = Mock()
        handler._read_json.return_value = {'provider': 'gemini', 'model': 'gemini-custom', 'effort': ''}
        with patch.object(server, 'load_config', return_value={}), patch.object(server, 'save_config') as save:
            server.Handler.api_post_ai_settings(handler, {})
        handler._session.assert_called_once()
        handler._uniflix_session.assert_not_called()
        self.assertEqual(save.call_args.args[0]['ai_profiles']['gemini']['model'], 'gemini-custom')

    def test_settings_reject_invalid_provider_model_and_effort(self):
        for body in ({'provider': 'invalid'}, {'provider': []}, {'provider': 'chatgpt', 'model': 'x\n--bad'},
                     {'provider': 'gemini', 'effort': 'high'}, {'provider': 'chatgpt', 'model': []}):
            handler = Mock()
            handler._read_json.return_value = body
            with self.subTest(body=body), self.assertRaises(server.ApiError):
                server.Handler.api_post_ai_settings(handler, {})

    def test_switching_chat_provider_keeps_full_history(self):
        chat = {'session': 'old-claude-session', 'provider': 'claude', 'messages': [
            {'role': 'user', 'text': 'Earlier question'}, {'role': 'assistant', 'text': 'Earlier answer'},
            {'role': 'user', 'text': 'Follow-up'}]}
        job = {'status': 'running', 'pending': '', 'proc': None, 'settings': {'provider': 'gemini'}}
        server.Chat.jobs['test'] = job
        with patch.object(server.Chat, '_context', return_value='transcript and previous conversation') as context, \
             patch.object(server.Chat, '_save'), patch.object(server, 'run_ai', return_value={'result': 'Answer'}) as run:
            server.Chat._answer('test', job, chat, 'Course', 'Lecture')
        context.assert_called_once()
        self.assertEqual(len(context.call_args.args[-1]), 2)
        self.assertNotIn('resume', run.call_args.kwargs)
        self.assertEqual(chat['messages'][-1]['provider'], 'gemini')
        self.assertEqual(chat['provider'], 'gemini')

    def test_calendar_does_not_silently_call_claude(self):
        session = SimpleNamespace()
        with patch.object(server, '_brief_key', return_value='test'), \
             patch.object(server, 'ai_settings', return_value={'provider': 'chatgpt'}), \
             patch.object(server.threading, 'Thread') as thread:
            server.GoogleCalendar.start(session)
        thread.assert_not_called()
        self.assertIn('.ics', server.GoogleCalendar.jobs.pop('test')['error'])


if __name__ == '__main__':
    unittest.main()
