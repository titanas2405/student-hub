"""Certificate errors on Windows: let Windows fetch the missing root and retry once, never skip verification."""
import ssl
import unittest
import urllib.error
from unittest.mock import Mock, patch

import server
import tls_setup


def cert_error(message="unable to get local issuer certificate"):
    e = ssl.SSLCertVerificationError(1, f"[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: {message}")
    e.verify_message = message
    return e


class RecoverTests(unittest.TestCase):
    def setUp(self):
        tls_setup._tried.clear()
        self.context = ssl.create_default_context()

    def test_only_on_windows_and_once_per_server(self):
        with patch.object(tls_setup.os, "name", "posix"):
            self.assertFalse(tls_setup.warm_windows_roots("imap.uoa.gr", 993))
        with patch.object(tls_setup, "warm_windows_roots", return_value=True) as warm, \
                patch.object(self.context, "load_default_certs") as reload:
            self.assertTrue(tls_setup.recover(self.context, "imap.uoa.gr", 993))
            self.assertFalse(tls_setup.recover(self.context, "imap.uoa.gr", 993))
            warm.assert_called_once_with("imap.uoa.gr", 993)
            reload.assert_called_once()
        self.assertEqual(self.context.verify_mode, ssl.CERT_REQUIRED)          # never relaxed
        self.assertTrue(self.context.check_hostname)

    def test_host_names_are_validated_before_powershell(self):
        with patch.object(tls_setup.subprocess, "run") as run, patch.object(tls_setup.os, "name", "nt"):
            self.assertFalse(tls_setup.warm_windows_roots("x'; Remove-Item C:\\ -Recurse; '", 993))
            run.assert_not_called()

    def test_explanations(self):
        self.assertIn("antivirus", tls_setup.explain(cert_error("self-signed certificate in certificate chain"), "imap.uoa.gr"))
        self.assertIn("date, time", tls_setup.explain(cert_error("certificate has expired"), "imap.uoa.gr"))
        with patch.object(tls_setup.os, "name", "nt"):
            self.assertIn("pip install truststore", tls_setup.explain(cert_error(), "imap.uoa.gr"))
        self.assertTrue(tls_setup.is_cert_error(urllib.error.URLError(cert_error())))
        self.assertFalse(tls_setup.is_cert_error(urllib.error.URLError("timed out")))


class MailTests(unittest.TestCase):
    def setUp(self):
        tls_setup._tried.clear()

    def account(self):
        return server.MailAccount("imaps://imap.uoa.gr:993", "smtps://smtp.uoa.gr:465", "sdi2300000", "pw", "sdi2300000@di.uoa.gr")

    def test_imap_retries_once_after_windows_fetches_the_root(self):
        conn = Mock()
        with patch.object(server, "TLS", ssl.create_default_context()), \
                patch.object(server.imaplib, "IMAP4_SSL", side_effect=[cert_error(), conn]) as imap, \
                patch.object(tls_setup, "warm_windows_roots", return_value=True), \
                patch.object(server, "_imap_login"):
            account = self.account()
            account._connect()
        self.assertEqual(imap.call_count, 2)
        self.assertIs(account.conn, conn)

    def test_imap_error_explains_what_to_do_when_it_still_fails(self):
        with patch.object(server, "TLS", ssl.create_default_context()), \
                patch.object(server.imaplib, "IMAP4_SSL", side_effect=cert_error("self-signed certificate in certificate chain")), \
                patch.object(tls_setup, "warm_windows_roots", return_value=False):
            with self.assertRaises(server.ApiError) as raised:
                self.account()._connect()
        self.assertIn("imap.uoa.gr", str(raised.exception))
        self.assertIn("antivirus", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
