"""Direct Piazza feed behavior, without sending credentials or requests to Piazza."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import parse_qs

import server


class PiazzaClientTests(unittest.TestCase):
    def setUp(self):
        self.client = server.PiazzaClient()
        self.status = {"id": "student", "networks": [
            {"id": "class123", "name": "Algorithms", "term": "Fall 2026"},
            {"id": "class456", "name": "Databases"},
        ]}

    def test_login_uses_separate_credentials_then_fetches_classes(self):
        with patch.object(self.client, "_open", side_effect=[
            'var CSRF_TOKEN = "token123";', '<html>signed in</html>',
            json.dumps({"result": self.status}),
        ]) as remote:
            self.client.login("piazza@example.test", "piazza-password")
        form = parse_qs(remote.call_args_list[1].args[1].decode())
        self.assertEqual(form["csrf_token"], ["token123"])
        self.assertEqual(form["email"], ["piazza@example.test"])
        self.assertEqual(form["password"], ["piazza-password"])
        self.assertEqual([c["id"] for c in self.client.classes], ["class123", "class456"])
        self.assertNotIn("password", self.client.__dict__)
        self.assertNotIn("piazza-password", repr(self.client.__dict__))

    def test_feed_is_course_scoped_cached_and_paginated(self):
        self.client.classes = self.status["networks"]
        row = {"id": "post123", "subject": "<b>Exam date</b>", "type": "note",
               "content_snipet": "<p>Friday</p><script>bad()</script>", "is_new": True}
        with patch.object(self.client, "rpc", return_value={"feed": [row], "more": True}) as rpc:
            first = self.client.feed("class123")
            self.assertEqual(first["items"][0]["title"], "Exam date")
            self.assertEqual(first["items"][0]["snippet"], "Friday")
            self.assertTrue(first["items"][0]["unread"])
            self.assertTrue(first["more"])
            self.client.feed("class123")
            self.assertEqual(rpc.call_count, 1)
            self.client.feed("class123", 50)
            self.assertEqual(rpc.call_args.args[1]["offset"], 50)
            self.assertEqual(rpc.call_args.args[1]["nid"], "class123")
            with self.assertRaises(server.ApiError) as denied:
                self.client.feed("not-enrolled")
            self.assertEqual(denied.exception.status, 404)

    def test_refresh_reloads_classes_and_feed(self):
        self.client.classes = self.status["networks"]
        with patch.object(self.client, "rpc", side_effect=[self.status, {"feed": [], "more": False}]) as rpc:
            result = self.client.feed("class123", refresh=True)
        self.assertEqual([c.args[0] for c in rpc.call_args_list], ["user.status", "network.get_my_feed"])
        self.assertFalse(result["more"])

    def test_post_includes_answers_and_followups_as_plain_text(self):
        self.client.classes = self.status["networks"]
        post = {"type": "question", "history": [{"subject": "Exam", "content": "<p>When?</p>"}],
                "children": [{"type": "i_answer", "history": [{"content": "<p>Friday</p>"}]},
                             {"type": "followup", "subject": "Which room?", "children": [
                                 {"type": "feedback", "subject": "Room 1"}]}]}
        with patch.object(self.client, "rpc", return_value=post):
            result = self.client.post("class123", "post123")
        self.assertEqual(result["text"], "When?")
        self.assertEqual(result["children"][0]["text"], "Friday")
        self.assertEqual(result["children"][1]["children"][0]["title"], "Room 1")
        with self.assertRaises(server.ApiError):
            self.client.post("not-enrolled", "post123")

    def test_expired_login_and_non_json_get_actionable_error(self):
        for response in ('<html>Sign in</html>', '{"error":"not_authenticated"}'):
            with self.subTest(response=response), patch.object(self.client, "_open", return_value=response):
                with self.assertRaises(server.ApiError) as err:
                    self.client.rpc("user.status")
                self.assertEqual(err.exception.status, 409)


class PiazzaRouteTests(unittest.TestCase):
    def setUp(self):
        self.handler = object.__new__(server.Handler)
        self.session = SimpleNamespace(piazza=None, csrf="csrf", cache={}, account=SimpleNamespace(mail=False))
        self.handler._session = lambda: self.session
        self.handler._json = Mock()
        self.handler.headers = {"X-CSRF-Token": "csrf", "Content-Type": "application/json"}

    def test_disconnected_feed_does_not_require_mail(self):
        self.handler.api_get_piazza({})
        self.assertFalse(self.handler._json.call_args.args[1]["connected"])

    def test_connect_and_disconnect_are_session_only(self):
        self.handler.body = json.dumps({"email": "p@example.test", "password": "secret"}).encode()
        with patch.object(server, "PiazzaClient") as client_type:
            self.handler.api_post_piazza_connect({})
            client = client_type.return_value
            client.login.assert_called_once_with("p@example.test", "secret")
            self.assertIs(self.session.piazza, client)
        self.handler.api_post_piazza_disconnect({})
        client.jar.clear.assert_called_once()
        client.cache.clear.assert_called_once()
        self.assertIsNone(self.session.piazza)

    def test_connect_rejects_bad_csrf_before_contacting_piazza(self):
        self.handler.headers["X-CSRF-Token"] = "wrong"
        with patch.object(server, "PiazzaClient") as client_type, self.assertRaises(server.ApiError) as err:
            self.handler.api_post_piazza_connect({})
        self.assertEqual(err.exception.status, 403)
        client_type.assert_not_called()

    def test_invalid_page_rejected(self):
        self.session.piazza = Mock()
        for offset in ("bad", "-1", "100001"):
            with self.subTest(offset=offset), self.assertRaises(server.ApiError):
                self.handler.api_get_piazza({"offset": [offset]})
        self.session.piazza.feed.assert_not_called()


if __name__ == "__main__":
    unittest.main()
