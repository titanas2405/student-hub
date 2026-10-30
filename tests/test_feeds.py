"""Feed parsing must coexist with calendar date and AI text helpers in the full app."""
from datetime import datetime
import unittest
from unittest.mock import patch

import server


class FeedTests(unittest.TestCase):
    def test_rss_preserves_titles_dates_body_author_and_category(self):
        data = '''<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
          <title>DIT ΕΚΠΑ</title><item><title>Εξέταση Δικτύων</title><link>/news/exam</link>
          <pubDate>Fri, 30 Oct 2026 10:00:00 +0200</pubDate><dc:creator>Γραμματεία</dc:creator>
          <description>&lt;p&gt;Η εξέταση θα γίνει την Παρασκευή.&lt;/p&gt;</description>
          <category>Ανακοινώσεις</category></item>
          <item><title>Νέο μάθημα</title><link>/news/course</link></item></channel></rss>'''.encode()
        title, items = server.parse_feed(data, 'https://www.di.uoa.gr/rss.xml')
        self.assertEqual(title, 'DIT ΕΚΠΑ')
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]['title'], 'Εξέταση Δικτύων')
        self.assertEqual(items[0]['link'], 'https://www.di.uoa.gr/news/exam')
        self.assertEqual(items[0]['date'], '2026-10-30T08:00:00+00:00')
        self.assertEqual(items[0]['author'], 'Γραμματεία')
        self.assertEqual(items[0]['category'], 'Ανακοινώσεις')
        self.assertIn('Παρασκευή', items[0]['summary'])
        self.assertEqual(server._local('2026-10-30T10:00:00'), datetime(2026, 10, 30, 10))
        self.assertEqual(server._text('  AI answer  '), 'AI answer')

    def test_namespaced_atom_and_rdf(self):
        atom = b'''<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom feed</title>
          <entry><title>Announcement</title><link href="/one"/><updated>2026-10-30T08:00:00Z</updated>
          <summary>Study material</summary></entry></feed>'''
        rdf = b'''<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
          <channel><title>RDF feed</title></channel><item><title>Announcement</title><link>https://example.test/one</link>
          <description>Study material</description></item></rdf:RDF>'''
        for data, name in ((atom, 'Atom feed'), (rdf, 'RDF feed')):
            with self.subTest(name=name):
                title, items = server.parse_feed(data, 'https://example.test/feed')
                self.assertEqual(title, name)
                self.assertEqual(items[0]['title'], 'Announcement')
                self.assertEqual(items[0]['link'], 'https://example.test/one')
                self.assertEqual(items[0]['summary'], 'Study material')

    def test_generic_announcement_category_uses_internship_subject(self):
        data = '''<rss><channel><title>DIT</title><item>
          <title>Πρόσκληση για Πρακτική Άσκηση</title><link>/announcements/123</link>
          <description>Υποβολή αιτήσεων από φοιτητές.</description><category>Ανακοινώσεις</category>
          </item></channel></rss>'''.encode()
        _, items = server.parse_feed(data, 'https://www.di.uoa.gr/rss.xml')
        self.assertEqual(items[0]['category'], 'Πρακτική Άσκηση')

    def test_refresh_replaces_cached_failure(self):
        url = 'https://example.test/test-feed'
        data = b'<rss><channel><title>Feed</title><item><title>Item</title><link>/item</link></item></channel></rss>'
        server._feed_cache[url] = (0, '', [], 'Could not load feed (ValueError)')
        try:
            with patch.object(server, 'fetch_url', return_value=(data, url, 'application/rss+xml')):
                result = server.get_feed_cached(url, force=True)
            self.assertIsNone(result[3])
            self.assertEqual(result[2][0]['title'], 'Item')
        finally:
            server._feed_cache.pop(url, None)

if __name__ == '__main__':
    unittest.main()
