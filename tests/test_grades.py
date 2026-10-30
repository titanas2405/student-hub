"""Grade reader regressions using sanitized portal HTML/JSON, without university requests."""
import json
import unittest
from unittest.mock import Mock

import server


class GradeReaderTests(unittest.TestCase):
    def test_portal_and_course_parsers_coexist(self):
        page = '<table><tr><th>Μάθημα</th><th>Βαθμός</th><th>ECTS</th></tr><tr><td>Algorithms</td><td>8,5</td><td>6</td></tr></table>'
        grades = server.parse_grades_html(page)
        self.assertEqual(grades[0]['grade'], 8.5)
        self.assertEqual(grades[0]['ects'], 6)
        tables = server.page_tables(page, 'https://eclass.example.test/')
        self.assertEqual(tables[0]['rows'][1]['cells'][0]['text'], 'Algorithms')

    def test_base_url_and_template_links_in_navigation(self):
        page = '''<base href="/"><a href="student/grades/list_diploma?p=profile">Η Καρτέλα μου</a>
          <a href="https://other.test/grades">Grades</a><a href="logout">Grades logout</a>
          <template><a href="${url}">Grades</a></template>
          <script>const markup = '<a href="fake">Grades</a>';</script>'''
        cas = Mock(sso_host='sso.example.test')
        client = server.PortalClient(cas, 'https://portal.example.test/')
        client.landing = ('https://portal.example.test/student/dashboard', page)
        cas.open.return_value = ('https://portal.example.test/student/grades/list_diploma?p=profile', 'text/html', '<table></table>')
        pages = client.candidate_pages()
        self.assertEqual(len(pages), 2)
        cas.open.assert_called_once_with('https://portal.example.test/student/grades/list_diploma?p=profile', None)

    def test_myuni_uses_unitron_json_and_grading_scale(self):
        conf = server.INSTITUTIONS['uoa']['grades']
        self.assertEqual(conf['kind'], 'unitron')
        cas = Mock(sso_host='sso.uoa.gr')
        client = server.PortalClient(cas, conf['start'], conf['kind'])
        client.landing = (conf['start'], '<meta name="_csrf" content="test-csrf"><table id="student_grades_diploma"></table>')
        row = {'courseCode': 'TEST101', 'title': 'Algorithms', 'grade': 0.8, 'gradingScaleId': 'scale',
               'ects': 6, 'semesterId': {'title': '3ο Εξάμηνο'}, 'idFather': None,
               'isPassed': True, 'isCountInDiploma': True}
        payloads = {'diploma': [row], 'all': [row], 'avg': 8.25,
                    'scales': [{'id': 'scale', 'minNumber': 0, 'maxNumber': 10, 'step': 0.5}], 'program': []}
        def respond(url, **kwargs):
            key = server.UNITRON_KEYS[url.removeprefix(conf['start'])]
            self.assertEqual(kwargs['headers']['X-CSRF-TOKEN'], 'test-csrf')
            return url, 'application/json', json.dumps(payloads[key])
        cas.open.side_effect = respond
        courses, extra = client.grades()
        self.assertEqual(courses[0]['grade'], 8)
        self.assertTrue(courses[0]['passed'])
        self.assertEqual(courses[0]['semester'], 3)
        self.assertEqual(extra['official'], 8.25)
        self.assertEqual(cas.open.call_count, len(server.UNITRON_API))
        self.assertEqual(server.summarize_grades(courses)['stats']['ects'], 6)

    def test_unitron_fallback_does_not_treat_base_scale_as_ten_point_grade(self):
        cas = Mock(sso_host='sso.example.test')
        client = server.PortalClient(cas, 'https://portal.example.test/', 'unitron')
        row = {'courseCode': 'TEST', 'title': 'Algorithms', 'grade': 0.8, 'idFather': None}
        client.api_json = Mock(return_value=[(server.UNITRON_API['diploma'], None, 'HTTP 404'),
                                            (server.UNITRON_API['all'], [row], '')])
        courses, _ = client.grades()
        self.assertEqual(courses[0]['grade'], 8)
        client.api_json.assert_called_once()

    def test_unrecognized_unitron_response_falls_back_without_parser_crash(self):
        client = server.PortalClient(Mock(sso_host='sso.example.test'), 'https://portal.example.test/', 'unitron')
        client.api_json = Mock(return_value=[])
        client.landing = ('https://portal.example.test/', '<table id="student_grades_diploma"></table>')
        self.assertEqual(client.grades(), ([], {}))
        client.api_json.assert_called_once()


class UnitronProfileTests(unittest.TestCase):
    # Minimal, sanitized version of the MyUni capture: JavaScript chooses a profile
    # before grade APIs can return JSON. No real student IDs or CSRF tokens here.
    LANDING = '''<meta name="_csrf" content="initial-token">
      <meta name="_csrf_header" content="X-CSRF-TOKEN">
      <script>var studentProfiles; function setActiveProfile() {}</script>'''

    def test_profile_is_activated_before_any_grade_api(self):
        cas = Mock(sso_host='sso.uoa.gr')
        start = 'https://my-uni.uoa.gr/'
        cas.through.return_value = start, 'text/html', self.LANDING
        activated = False
        def respond(url, data=None, **kwargs):
            nonlocal activated
            if url.endswith('api/person/profiles'):
                if kwargs.get('method') == 'PUT':
                    self.assertEqual(json.loads(data), {'id': 'student-profile', 'type': 'student'})
                    self.assertEqual(kwargs['headers']['X-CSRF-TOKEN'], 'initial-token')
                    self.assertIn('application/json', kwargs['headers']['Content-Type'])
                    activated = True
                    return url, 'application/json', '{"id":"student-profile"}'
                return url, 'application/json', '{"studentProfiles":[{"id":"student-profile"}],"teacherProfiles":[]}'
            self.assertTrue(activated, 'Protected pages/APIs were read before profile activation')
            if '?p=' in url:
                return url, 'text/html', '<meta content="active-token" name="_csrf"><table id="student_grades_diploma"></table>'
            self.assertEqual(kwargs['headers']['X-CSRF-TOKEN'], 'active-token')
            key = server.UNITRON_KEYS[url[len(start):]]
            data = {'diploma': [{'idFather': None, 'courseCode': 'TEST101', 'title': 'Algorithms',
                                 'grade': 0.8, 'isPassed': True, 'ects': 6}],
                    'all': [], 'scales': [], 'program': [], 'avg': 8}
            return url, 'application/json', json.dumps(data[key])
        cas.open.side_effect = respond
        client = server.PortalClient(cas, start, 'unitron')
        courses, extra = client.grades()
        self.assertEqual(courses[0]['grade'], 8)
        self.assertEqual(extra['official'], 8)
        self.assertEqual(cas.open.call_count, 8)  # profiles GET, activation PUT, selected page, five APIs
        client.login()
        self.assertEqual(cas.open.call_count, 8)  # no repeated profile activation
        cas.through.assert_called_once_with(start)

    def test_multiple_profiles_are_not_selected_arbitrarily(self):
        cas = Mock(sso_host='sso.uoa.gr')
        cas.through.return_value = 'https://my-uni.uoa.gr/', 'text/html', self.LANDING
        cas.open.return_value = 'https://my-uni.uoa.gr/api/person/profiles', 'application/json', json.dumps(
            {'studentProfiles': [{'id': 'one'}, {'id': 'two'}]})
        client = server.PortalClient(cas, 'https://my-uni.uoa.gr/', 'unitron')
        with self.assertRaises(server.ApiError) as error:
            client.login()
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(cas.open.call_count, 1)
        self.assertIsNone(client.landing)

    def test_selection_failure_is_not_cached_as_success(self):
        cas = Mock(sso_host='sso.uoa.gr')
        cas.through.return_value = 'https://my-uni.uoa.gr/', 'text/html', self.LANDING
        cas.open.side_effect = [('url', 'application/json', '{"studentProfiles":[{"id":"one"}]}'),
                                ('url', 'text/html', '<html>login</html>')]
        client = server.PortalClient(cas, 'https://my-uni.uoa.gr/', 'unitron')
        with self.assertRaises(server.ApiError):
            client.login()
        self.assertIsNone(client.landing)

    def test_html_api_responses_produce_actionable_error(self):
        client = server.PortalClient(Mock(sso_host='sso.uoa.gr'), 'https://my-uni.uoa.gr/', 'unitron')
        client.landing = ('https://my-uni.uoa.gr/?p=selected', '<table></table>')
        client.api_json = Mock(return_value=[('feign/student/grades/diploma', None, '<html>profile selection</html>')])
        with self.assertRaises(server.ApiError) as error:
            client.grades()
        self.assertEqual(error.exception.status, 502)
        self.assertIn('JSON', str(error.exception))

    def test_cas_sends_json_put_without_form_encoding(self):
        cas = server.CasSession('https://sso.example.test/login', 'test-user', 'test-password')
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"id":"selected"}'
        response.headers.get_content_type.return_value = 'application/json'
        cas.opener = Mock()
        cas.opener.open.return_value = response
        payload = b'{"id":"selected","type":"student"}'
        cas.open('https://portal.example.test/api/person/profiles', data=payload, method='PUT',
                 headers={'Content-Type': 'application/json'})
        request = cas.opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), 'PUT')
        self.assertEqual(request.data, payload)
        self.assertEqual(request.get_header('Content-type'), 'application/json')


if __name__ == '__main__':
    unittest.main()
