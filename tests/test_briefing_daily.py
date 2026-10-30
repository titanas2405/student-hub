"""Automatic briefings run once per Athens calendar day; manual refresh bypasses the gate."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import server


class DailyBriefingTests(unittest.TestCase):
    def setUp(self):
        self.session = SimpleNamespace(inst='uoa', account=SimpleNamespace(username='daily-test'))
        self.key = server._brief_key(self.session)
        self.now = datetime(2026, 10, 30, 12, tzinfo=timezone(timedelta(hours=2)))

    def tearDown(self):
        server.Briefing.jobs.pop(self.key, None)

    def start(self, saved, force=False):
        with patch.object(server, 'ai_available', return_value=True), \
             patch.object(server, 'athens_now', return_value=self.now), \
             patch.object(server.Briefing, '_load', return_value=saved), \
             patch.object(server, 'ai_settings', return_value={'provider': 'gemini', 'model': '', 'effort': ''}), \
             patch.object(server.threading, 'Thread') as thread:
            server.Briefing.start(self.session, force)
        return thread

    def test_same_day_reuses_saved_brief_even_with_another_provider(self):
        thread = self.start({'generated': '2026-10-30T01:00:00+00:00', 'provider': 'claude'})
        thread.assert_not_called()

    def test_next_day_regenerates_even_if_checked_recently(self):
        thread = self.start({'generated': '2026-10-29T12:00:00+00:00', 'checked': '2026-10-30T09:59:00+00:00'})
        thread.return_value.start.assert_called_once()

    def test_athens_day_is_used_across_utc_midnight(self):
        self.now = datetime(2026, 10, 30, 0, 30, tzinfo=timezone(timedelta(hours=2)))
        self.start({'generated': '2026-10-29T22:01:00+00:00'}).assert_not_called()

    def test_manual_refresh_bypasses_same_day_gate(self):
        thread = self.start({'generated': '2026-10-30T01:00:00+00:00'}, force=True)
        thread.return_value.start.assert_called_once()

    def test_missing_or_invalid_saved_timestamp_generates(self):
        for saved in (None, {}, {'generated': 'invalid'}):
            with self.subTest(saved=saved):
                server.Briefing.jobs.pop(self.key, None)
                thread = self.start(saved)
                thread.return_value.start.assert_called_once()

    def test_repeated_logins_cannot_launch_duplicate_running_jobs(self):
        self.start(None).return_value.start.assert_called_once()
        self.start(None).assert_not_called()


if __name__ == '__main__':
    unittest.main()
