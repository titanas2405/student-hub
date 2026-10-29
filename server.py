#!/usr/bin/env python3
"""Student Hub - a local mail + announcements dashboard for students.

Runs on 127.0.0.1 only. Uses the Python standard library (no installs).
Passwords are held in memory for the life of a session and never written to disk.
"""
import base64
import gzip
import hashlib
import http.cookiejar
import html
import imaplib
import json
import mimetypes
import os
import re
import secrets
import smtplib
import socket
import ssl
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses, make_msgid, formatdate, parsedate_to_datetime
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = int(os.environ.get("STUDENT_HUB_PORT", "8765"))
ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "student-hub"
CONFIG_FILE = CONFIG_DIR / "config.json"

BROWSER_SSO_TTL = 6 * 3600     # assume the browser's university SSO cookie lasts this long
SESSION_IDLE = 30 * 60          # seconds of inactivity before a session is wiped
MAIL_CACHE_TTL = 60             # seconds a message list stays cached
FEED_CACHE_TTL = 5 * 60         # seconds announcements stay cached
PAGE_SIZE = 40
MAX_BODY = 1 << 20              # largest JSON request we accept
MAX_FEED = 3 << 20              # largest feed we download
NET_TIMEOUT = 15

TLS = ssl.create_default_context()


# ---------------------------------------------------------------- config ---

_config_lock = threading.Lock()


# DIT / UoA defaults
DEFAULT_IMAP = "imaps://imap.uoa.gr:993"
DEFAULT_SMTP = "smtps://smtp.uoa.gr:465"
DEFAULT_FEEDS = [
    {"id": "dit", "name": "DIT ΕΚΠΑ", "url": "https://www.di.uoa.gr/rss.xml", "inst": "uoa"},
    {"id": "maritime", "name": "Ναυτιλιακές Σπουδές", "inst": "unipi",
     "url": "https://maritime-unipi.gr/wp-json/wp/v2/posts"},
]

# What each university supports. UNIPI mail lives in Microsoft 365, which refuses password (IMAP)
# sign-in, so for UNIPI we verify the account through its CAS login and link to Outlook instead.
INSTITUTIONS = {
    "uoa": {
        "name": "ΕΚΠΑ · Πληροφορική & Τηλεπικοινωνίες", "domain": "di.uoa.gr",
        "auth": "imap", "imap": DEFAULT_IMAP, "smtp": DEFAULT_SMTP,
        "sso": "https://sso.uoa.gr/login", "form_action": "https://*.uoa.gr",
        "services": {"my-uni": "https://my-uni.uoa.gr/login/cas",
                     "eclass": "https://eclass.uoa.gr/modules/auth/cas.php"},
        "eclass": "https://eclass.uoa.gr/", "ditlab": True, "webmail": "https://webmail.uoa.gr/", "ditStudies": True,
        "grades": {"name": "My-Uni", "start": "https://my-uni.uoa.gr/", "sso": "my-uni"},
        "links": [
            {"label": "eClass", "sso": "eclass", "href": "https://eclass.uoa.gr/"},
            {"label": "My-Uni (Γραμματεία)", "sso": "my-uni", "href": "https://my-uni.uoa.gr/"},
            {"label": "DIT Announcements", "href": "https://www.di.uoa.gr/announcements"},
            {"label": "UoA Webmail", "href": "https://webmail.uoa.gr/"},
            {"label": "DitLab", "href": "https://ditlab.gr/"},
        ],
    },
    "unipi": {
        "name": "Πανεπιστήμιο Πειραιώς · Ναυτιλιακές Σπουδές", "domain": "unipi.gr",
        "auth": "sso", "sso": "https://sso.unipi.gr/login", "form_action": "https://*.unipi.gr",
        "services": {"eclass": "https://eclass.unipi.gr/modules/auth/cas.php",
                     "sis": "https://sis-portal.unipi.gr/login/cas"},
        "eclass": "https://eclass.unipi.gr/", "ditlab": False, "webmail": "https://outlook.office.com/mail/",
        "grades": {"name": "sis-portal", "start": "https://sis-portal.unipi.gr/", "sso": "sis", "kind": "unitron"},
        "links": [
            {"label": "eClass", "sso": "eclass", "href": "https://eclass.unipi.gr/"},
            {"label": "Outlook (Email)", "href": "https://outlook.office.com/mail/"},
            {"label": "Φοιτητολόγιο (SIS)", "sso": "sis", "href": "https://sis-portal.unipi.gr/"},
            {"label": "Ναυτιλιακές Σπουδές", "href": "https://maritime-unipi.gr/"},
            {"label": "Πανεπιστήμιο Πειραιώς", "href": "https://www.unipi.gr/"},
        ],
    },
}


def load_config():
    try:
        cfg = json.loads(CONFIG_FILE.read_text())
    except (OSError, ValueError):
        cfg = {"imap_url": DEFAULT_IMAP, "smtp_url": DEFAULT_SMTP, "username": ""}
    cfg.setdefault("feeds", [])
    # add each university's default feed once; removing it later sticks
    seeded = cfg.setdefault("seeded_feeds", [DEFAULT_FEEDS[0]["url"]] if cfg.pop("seeded", False) else [])
    for d in DEFAULT_FEEDS:
        if d["url"] not in seeded:
            cfg["feeds"] = [f for f in cfg["feeds"] if f["url"] != d["url"]] + [dict(d)]
            seeded.append(d["url"])
    for f in cfg["feeds"]:              # feeds saved before universities existed belonged to DIT
        if f["url"] == DEFAULT_FEEDS[0]["url"]:
            f.setdefault("inst", "uoa")
    return cfg


def feeds_for(cfg, inst):
    return [f for f in cfg.get("feeds", []) if f.get("inst") in (None, inst)]


def save_config(cfg):
    """Persist non-secret settings only (feed URLs, server URLs, username)."""
    with _config_lock:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        tmp = CONFIG_FILE.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(cfg, f, indent=2)
        os.replace(tmp, CONFIG_FILE)


# ------------------------------------------------------------- utilities ---

class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def parse_server_url(raw, kind):
    """Turn 'imaps://host:993', 'smtp://host:587' or a bare host into (host, port, implicit_tls)."""
    raw = (raw or "").strip()
    if not raw:
        raise ApiError(400, f"{kind.upper()} server is required")
    if "://" not in raw:
        raw = ("imaps://" if kind == "imap" else "smtps://") + raw
    u = urllib.parse.urlsplit(raw)
    schemes = {"imap": {"imaps": (993, True), "imap": (143, False)},
               "smtp": {"smtps": (465, True), "smtp": (587, False)}}[kind]
    if u.scheme not in schemes or not u.hostname:
        raise ApiError(400, f"Use {' or '.join(s + '://host' for s in schemes)} for {kind.upper()}")
    default_port, implicit = schemes[u.scheme]
    try:
        port = u.port or default_port
    except ValueError:
        raise ApiError(400, f"Invalid {kind.upper()} port")
    return u.hostname, port, implicit


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        elif tag in ("br", "p", "div", "li", "tr", "h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_to_text(markup):
    p = _TextExtractor()
    try:
        p.feed(markup or "")
        p.close()
    except Exception:
        return re.sub(r"<[^>]+>", " ", markup or "")
    text = "".join(p.parts)
    return re.sub(r"\n\s*\n+", "\n\n", re.sub(r"[ \t\r\f\v]+", " ", text)).strip()


def addr_list(value):
    """Validate a comma separated address list; return clean list or raise."""
    if not value or not value.strip():
        return []
    out = []
    for name, addr in getaddresses([value]):
        if not re.fullmatch(r"[^@\s<>,;\"]+@[^@\s<>,;\"]+\.[^@\s<>,;\"]+", addr or ""):
            raise ApiError(400, f"Invalid email address: {addr or name or value}")
        out.append(addr)
    return out


# ---------------------------------------------------------------- IMAP ---

LIST_RE = re.compile(r'\((?P<flags>[^)]*)\) (?P<delim>"[^"]*"|NIL) (?P<name>.+)$')
FETCH_RE = re.compile(rb"UID (\d+)")
FLAGS_RE = re.compile(rb"FLAGS \(([^)]*)\)")


def imap_quote(name):
    return '"' + name.replace("\\", "\\\\").replace('"', '\\"') + '"'


class MailAccount:
    """One IMAP connection per session, reused across requests and guarded by a lock."""

    mail = True

    def __init__(self, imap_url, smtp_url, username, password, from_addr):
        self.imap = parse_server_url(imap_url, "imap")
        self.smtp = parse_server_url(smtp_url, "smtp")
        self.username, self.password = username, password
        self.from_addr = from_addr
        # UoA accepts either "sdi..." or "sdi...@di.uoa.gr" depending on the account; try both once.
        self.login_names = [username]
        if self.imap[0].endswith("uoa.gr") and "@" not in username and "@" in from_addr:
            self.login_names.append(from_addr)
        elif self.imap[0].endswith("uoa.gr") and "@" in username:
            self.login_names.append(username.split("@")[0])
        self.lock = threading.Lock()
        self.conn = None
        self.folders = {}           # display role -> raw IMAP name
        self.all_folders = set()

    # connection management
    def _connect(self):
        host, port, implicit = self.imap
        try:
            if implicit:
                c = imaplib.IMAP4_SSL(host, port, ssl_context=TLS, timeout=NET_TIMEOUT)
            else:
                c = imaplib.IMAP4(host, port, timeout=NET_TIMEOUT)
                c.starttls(ssl_context=TLS)       # never send a password in clear text
            for i, name in enumerate(self.login_names):
                try:
                    _imap_login(c, name, self.password)
                    self.username = name           # SMTP uses whichever form worked
                    self.login_names = [name]
                    break
                except imaplib.IMAP4.error:
                    if i == len(self.login_names) - 1:
                        raise
        except imaplib.IMAP4.error:
            raise ApiError(401, "Wrong username or password. Use the same login as webmail "
                                "(e.g. sdi2300000).")
        except (OSError, ssl.SSLError) as e:
            raise ApiError(502, f"Could not reach mail server {host}:{port} ({e.__class__.__name__})")
        self.conn = c

    def _ensure(self):
        if self.conn is not None:
            try:
                self.conn.noop()
                return self.conn
            except Exception:
                self.close()
        self._connect()
        return self.conn

    def close(self):
        if self.conn is not None:
            try:
                self.conn.logout()
            except Exception:
                pass
            self.conn = None

    def login(self):
        with self.lock:
            self._ensure()
            self._discover_folders()

    def _discover_folders(self):
        typ, data = self.conn.list()
        self.folders, self.all_folders = {"inbox": "INBOX"}, {"INBOX"}
        for line in data or []:
            if not isinstance(line, bytes):
                continue
            m = LIST_RE.match(line.decode("utf-8", "replace"))
            if not m:
                continue
            name = m.group("name").strip()
            if name.startswith('"') and name.endswith('"'):
                name = name[1:-1].replace('\\"', '"').replace("\\\\", "\\")
            flags = m.group("flags").lower()
            if "\\noselect" in flags:
                continue
            self.all_folders.add(name)
            for role in ("sent", "drafts", "trash", "junk"):
                if f"\\{role}" in flags:
                    self.folders.setdefault(role, name)
        # fall back to common names when the server lacks SPECIAL-USE flags
        if "sent" not in self.folders:
            for n in self.all_folders:
                if n.split("/")[-1].split(".")[-1].lower() in ("sent", "sent items", "sent mail", "sent messages"):
                    self.folders["sent"] = n
                    break

    def _select(self, role):
        name = self.folders.get(role)
        if not name:
            raise ApiError(404, f"No {role} folder on this account")
        typ, _ = self.conn.select(imap_quote(name), readonly=False)
        if typ != "OK":
            raise ApiError(502, f"Could not open {role}")

    # operations
    def _search(self, unread_only, query):
        """UID SEARCH; a query searches the whole folder on the server (headers and body)."""
        if not query:
            return self.conn.uid("SEARCH", None, "UNSEEN" if unread_only else "ALL")
        flags = ["UNSEEN"] if unread_only else []
        self.conn.literal = query.encode("utf-8")       # sent as a UTF-8 literal, so Greek works
        typ, data = self.conn.uid("SEARCH", "CHARSET", "UTF-8", *flags, "TEXT")
        if typ != "OK" and query.isascii():             # servers without CHARSET support
            typ, data = self.conn.uid("SEARCH", *flags, "TEXT", imap_quote(query))
        return typ, data

    def list_messages(self, role, unread_only, page, query=""):
        with self.lock:
            self._ensure()
            self._select(role)
            typ, data = self._search(unread_only, query)
            uids = data[0].split() if typ == "OK" and data and data[0] else []
            total = len(uids)
            end = total - page * PAGE_SIZE
            chunk = uids[max(0, end - PAGE_SIZE):max(0, end)]
            if not chunk:
                return {"messages": [], "total": total}
            typ, data = self.conn.uid(
                "FETCH", b",".join(chunk).decode(),
                "(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])")
        parser = BytesParser(policy=policy.default)
        out = []
        for item in data or []:
            if not isinstance(item, tuple):
                continue
            meta, raw = item
            m, f = FETCH_RE.search(meta), FLAGS_RE.search(meta)
            if not m:
                continue
            h = parser.parsebytes(raw, headersonly=True)
            out.append({
                "uid": int(m.group(1)),
                "from": _safe_header(h, "from"),
                "to": _safe_header(h, "to"),
                "subject": _safe_header(h, "subject") or "(no subject)",
                "date": _iso_date(_safe_header(h, "date")),
                "unread": not (f and b"\\Seen" in f.group(1)),
            })
        out.sort(key=lambda x: x["uid"], reverse=True)
        return {"messages": out, "total": total}

    def get_message(self, role, uid, mark_seen=True):
        with self.lock:
            self._ensure()
            self._select(role)
            typ, data = self.conn.uid("FETCH", str(uid), "(BODY.PEEK[])")
            if typ != "OK" or not data or not isinstance(data[0], tuple):
                raise ApiError(404, "Message not found")
            if mark_seen:
                self.conn.uid("STORE", str(uid), "+FLAGS", "(\\Seen)")
        msg = BytesParser(policy=policy.default).parsebytes(data[0][1])
        text_part = msg.get_body(preferencelist=("plain",))
        html_part = msg.get_body(preferencelist=("html",))
        text = _part_content(text_part)
        html_body = _part_content(html_part)
        if not text and html_body:
            text = html_to_text(html_body)
        attachments = [
            {"name": a.get_filename() or "attachment", "size": len(a.get_payload(decode=True) or b"")}
            for a in msg.iter_attachments()
        ]
        return {
            "uid": uid,
            "from": _safe_header(msg, "from"),
            "to": _safe_header(msg, "to"),
            "cc": _safe_header(msg, "cc"),
            "reply_to": _safe_header(msg, "reply-to"),
            "message_id": _safe_header(msg, "message-id"),
            "subject": _safe_header(msg, "subject") or "(no subject)",
            "date": _iso_date(_safe_header(msg, "date")),
            "text": text[:500_000],
            "html": html_body[:2_000_000] if html_body else "",
            "attachments": attachments,
        }

    def find_by_message_id(self, role, message_id):
        """UID of the message with this Message-ID in a folder, or None."""
        with self.lock:
            self._ensure()
            self._select(role)
            typ, data = self.conn.uid("SEARCH", None, "HEADER", "Message-ID", imap_quote(message_id))
        uids = data[0].split() if typ == "OK" and data and data[0] else []
        return int(uids[-1]) if uids else None

    def send(self, to, cc, subject, body, in_reply_to=None):
        to_list, cc_list = addr_list(to), addr_list(cc)
        if not to_list:
            raise ApiError(400, "Add at least one recipient")
        if len(to_list) + len(cc_list) > 50:
            raise ApiError(400, "Too many recipients (max 50)")
        msg = EmailMessage(policy=policy.SMTP)
        try:
            msg["From"] = self.from_addr
            msg["To"] = ", ".join(to_list)
            if cc_list:
                msg["Cc"] = ", ".join(cc_list)
            msg["Subject"] = subject or ""
            if in_reply_to:
                msg["In-Reply-To"] = in_reply_to
                msg["References"] = in_reply_to
        except ValueError:
            raise ApiError(400, "Header contains invalid characters")
        msg["Date"] = formatdate(localtime=True)
        msg["Message-ID"] = make_msgid(domain=self.from_addr.split("@")[-1] if "@" in self.from_addr else None)
        msg.set_content(body or "")

        host, port, implicit = self.smtp
        try:
            if implicit:
                s = smtplib.SMTP_SSL(host, port, context=TLS, timeout=NET_TIMEOUT)
            else:
                s = smtplib.SMTP(host, port, timeout=NET_TIMEOUT)
                s.ehlo()
                s.starttls(context=TLS)
                s.ehlo()
            with s:
                _smtp_login(s, self.username, self.password)
                s.send_message(msg, to_addrs=to_list + cc_list)
        except smtplib.SMTPAuthenticationError:
            raise ApiError(401, "Outgoing server rejected your credentials")
        except smtplib.SMTPRecipientsRefused:
            raise ApiError(400, "Server refused one or more recipients")
        except (smtplib.SMTPException, OSError, ssl.SSLError) as e:
            raise ApiError(502, f"Could not send ({e.__class__.__name__})")

        # Store a copy in Sent unless the provider does it automatically (Gmail does).
        if "gmail" not in host and "googlemail" not in host and "office365" not in host and "outlook" not in host:
            with self.lock:
                try:
                    if self.folders.get("sent"):
                        self._ensure().append(imap_quote(self.folders["sent"]), "(\\Seen)",
                                              imaplib.Time2Internaldate(time.time()), msg.as_bytes())
                except Exception:
                    pass


MAIL_UNAVAILABLE = ("Your university email is on Microsoft 365, which doesn't allow apps to sign in "
                    "with a password. Open it in Outlook instead.")


_cas_blocks = {}            # (sso host, username) -> (until, error): shared by all sessions


class CasSession:
    """One university single sign-on (CAS) session per app session.

    The password is posted to the university login at most once; CAS then sets its TGC cookie and
    every service (eClass, My-Uni, sis-portal) gets in with a ticket, no password needed. Without
    this each feature signed in separately, and the university login rate-limits that.
    """

    COOLDOWN = 180          # after a rejected / rate-limited sign-in, don't post the password again for a while

    def __init__(self, sso_login, username, password):
        self.sso_login, self.sso_host = sso_login, urllib.parse.urlsplit(sso_login).hostname
        self.username, self.password = username.split("@")[0], password
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            _SafeRedirect, urllib.request.HTTPSHandler(context=TLS), urllib.request.HTTPCookieProcessor(self.jar))
        self.lock = threading.Lock()
        self.posts = 0                  # password posts so far (for tests / diagnostics)

    def open(self, url, data=None, accept="text/html,application/json", headers=None):
        req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None,
                                     headers={"User-Agent": "Mozilla/5.0 StudentHub", "Accept": accept, **(headers or {})})
        with self.opener.open(req, timeout=NET_TIMEOUT) as r:
            return r.geturl(), r.headers.get_content_type(), r.read(MAX_FEED).decode("utf-8", "replace")

    def signed_in(self):
        return any(c.name == "TGC" and c.value and c.domain.endswith(self.sso_host) for c in self.jar)

    def through(self, url, rejected_status=502):
        """GET a CAS-protected URL; if CAS shows its login form, sign in (once) and continue."""
        with self.lock:                 # concurrent features wait for one sign-in instead of each posting
            final, ctype, body = self.open(url)
            m = re.search(r'name="execution"\s+value="([^"]+)"', body)
            if urllib.parse.urlsplit(final).hostname != self.sso_host or not m:
                return final, ctype, body
            for key in self._block_keys():
                until, error = _cas_blocks.get(key, (0, None))
                if time.time() < until:
                    raise error
            try:
                self.posts += 1
                return self.open(final, {"username": self.username, "password": self.password,
                                         "execution": m.group(1), "_eventId": "submit", "geolocation": ""})
            except urllib.error.HTTPError as e:
                if e.code == 429:       # rate-limited: pause every sign-in for this username
                    err = ApiError(429, "The university login is rate-limiting sign-ins. "
                                        f"The app will wait {self.COOLDOWN // 60} minutes before trying again.")
                    key = self._block_keys()[0]
                elif e.code == 401:     # wrong password: don't resend this one, but a corrected one may go
                    err = ApiError(rejected_status, "The university login rejected your username or password.")
                    key = self._block_keys()[1]
                else:
                    raise ApiError(502, f"University login unavailable ({e.code})")
                _cas_blocks[key] = (time.time() + self.COOLDOWN, err)
                raise err

    def _block_keys(self):
        digest = hashlib.sha256((self.password or "").encode()).hexdigest()
        return [(self.sso_host, self.username), (self.sso_host, self.username, digest)]

    def login(self):
        """Sign in to the university login itself (used to verify UNIPI accounts)."""
        try:
            self.through(self.sso_login, rejected_status=401)
        except OSError as e:
            raise ApiError(502, f"Could not reach the university login ({e.__class__.__name__})")
        if not self.signed_in():                # CAS sets TGC only on success
            raise ApiError(401, "Wrong username or password. Use your UNIPI account (the same as eClass and sis-portal).")


class SsoAccount:
    """An account verified through the university's CAS login (sso.<uni>.gr); it has no mailbox."""

    mail = False

    def __init__(self, sso_login, username, password, from_addr):
        self.username, self.password, self.from_addr = username.split("@")[0], password, from_addr
        self.imap = ("", 0, False)
        self.folders = {}
        self.cas = CasSession(sso_login, username, password)

    def login(self):
        try:
            self.cas.login()
        except ApiError as e:
            if e.status == 401:
                raise ApiError(401, "Wrong username or password. Use your UNIPI account (the same as eClass and sis-portal).")
            raise

    def close(self):
        pass

    def _no_mail(self, *a, **k):
        raise ApiError(409, MAIL_UNAVAILABLE)

    list_messages = get_message = send = find_by_message_id = _no_mail


def _sasl_plain(user, password):
    return ("\0" + user + "\0" + password).encode("utf-8")


def _imap_login(conn, user, password):
    """imaplib's LOGIN only sends ASCII; use SASL PLAIN (UTF-8) so passwords like 'κωδικός' work."""
    if "AUTH=PLAIN" in conn.capabilities:
        conn.authenticate("PLAIN", lambda _: _sasl_plain(user, password))
    else:
        try:
            conn.login(user, password)
        except UnicodeEncodeError:
            raise imaplib.IMAP4.error("server does not accept non-ASCII passwords")


def _smtp_login(conn, user, password):
    """smtplib also encodes credentials as ASCII, so send AUTH PLAIN ourselves in UTF-8."""
    conn.ehlo_or_helo_if_needed()
    if "plain" not in conn.esmtp_features.get("auth", "").lower().split():
        return conn.login(user, password)
    code, resp = conn.docmd("AUTH", "PLAIN " + base64.b64encode(_sasl_plain(user, password)).decode())
    if code != 235:
        raise smtplib.SMTPAuthenticationError(code, resp)


def _safe_header(msg, name):
    try:
        v = msg[name]
        return str(v) if v is not None else ""
    except Exception:
        return ""


def _iso_date(value):
    try:
        return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat()
    except Exception:
        return ""


def _part_content(part):
    if part is None:
        return ""
    try:
        return part.get_content()
    except Exception:
        payload = part.get_payload(decode=True) or b""
        return payload.decode("utf-8", "replace")


# --------------------------------------------------------------- feeds ---

class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme not in ("http", "https"):
            raise urllib.error.URLError("redirect to unsupported scheme")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_SafeRedirect, urllib.request.HTTPSHandler(context=TLS))


def check_feed_url(url):
    url = (url or "").strip()
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("http", "https") or not u.hostname or len(url) > 2048:
        raise ApiError(400, "Enter a full http(s):// URL")
    return url


def fetch_url(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "StudentHub/1.0 (+local)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8",
    })
    with _opener.open(req, timeout=NET_TIMEOUT) as r:
        data = r.read(MAX_FEED + 1)
        if len(data) > MAX_FEED:
            raise ApiError(413, "Feed is too large")
        return data, r.geturl(), r.headers.get_content_type()


class _FeedLinkFinder(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found, self.title, self._in_title = None, "", False
        self.wp_api = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "link" and (a.get("rel") or "") == "https://api.w.org/":
            self.wp_api = a.get("href")
        if tag == "link" and not self.found and (a.get("rel") or "").lower() == "alternate" \
                and (a.get("type") or "").lower() in ("application/rss+xml", "application/atom+xml"):
            self.found = a.get("href")
        self._in_title = tag == "title"

    def handle_data(self, data):
        if self._in_title and not self.title:
            self.title = data.strip()

    def handle_endtag(self, tag):
        self._in_title = False


def _local(tag):
    return tag.rsplit("}", 1)[-1].lower()


def _child(el, *names):
    for c in el:
        if _local(c.tag) in names:
            return c
    return None


def _text(el):
    return "".join(el.itertext()).strip() if el is not None else ""


def _feed_date(s):
    s = (s or "").strip()
    if not s:
        return ""
    try:
        return parsedate_to_datetime(s).astimezone(timezone.utc).isoformat()
    except Exception:
        pass
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
    except Exception:
        return ""


CATEGORY_NAMES = {
    "announcements": "Ανακοινώσεις",
    "highlights": "Νέα",
    "news": "Νέα",
    "events": "Εκδηλώσεις",
}
DRUPAL_DATE_RE = re.compile(r"^\w{3}, \d{1,2}/\d{1,2}/\d{4} - \d{1,2}:\d{2}$")


def _category(entry, link):
    """Use the feed's <category>, else the first URL path segment (/announcements/123 -> Announcements)."""
    cat = _text(_child(entry, "category"))
    if not cat and link:
        seg = urllib.parse.urlsplit(link).path.strip("/").split("/")
        seg = seg[1] if seg[0] in ("en", "el") and len(seg) > 1 else seg[0]
        if seg.isalpha() and seg not in ("node", "content", "post"):
            cat = CATEGORY_NAMES.get(seg.lower()) or (seg.upper() if len(seg) <= 4
                                                      else seg.replace("-", " ").title())
    return cat[:40]


def _clean_summary(text, title, author):
    """Drop the title/author/date header lines that Drupal sites (like di.uoa.gr) prepend."""
    lines = text.split("\n")
    while lines and (not lines[0].strip() or lines[0].strip() in (title, author)
                     or DRUPAL_DATE_RE.match(lines[0].strip())):
        lines.pop(0)
    return "\n".join(lines).strip()


def parse_feed(data, base_url):
    head = data[:4096].lower()
    if b"<!doctype" in head or b"<!entity" in data.lower():
        raise ApiError(422, "Feed uses DTD/entities, which are blocked for safety")
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        raise ApiError(422, "Not a valid RSS or Atom feed")
    title = ""
    items = []
    kind = _local(root.tag)
    if kind == "feed":                                          # Atom
        title = _text(_child(root, "title"))
        entries = [e for e in root if _local(e.tag) == "entry"]
    else:                                                       # RSS 2.0 / RSS 1.0 (RDF)
        channel = _child(root, "channel")
        title = _text(_child(channel, "title")) if channel is not None else ""
        entries = [e for e in (channel if channel is not None and kind == "rss" else root)
                   if _local(e.tag) == "item"]
        if kind == "rdf":
            entries = [e for e in root if _local(e.tag) == "item"]
    seen_titles = set()
    for e in entries[:60]:
        link_el = _child(e, "link")
        link = ""
        if link_el is not None:
            link = link_el.get("href") or _text(link_el)
        if kind == "feed":
            for l in e:
                if _local(l.tag) == "link" and l.get("rel", "alternate") == "alternate":
                    link = l.get("href", link)
                    break
        link = urllib.parse.urljoin(base_url, link) if link else ""
        if urllib.parse.urlsplit(link).scheme not in ("http", "https"):
            link = ""
        title = html_to_text(_text(_child(e, "title"))) or "(untitled)"
        if title.casefold() in seen_titles:          # e.g. DIT posts an event and its announcement
            continue
        seen_titles.add(title.casefold())
        author = _text(_child(e, "author", "creator"))
        summary = _text(_child(e, "description", "summary", "content", "encoded"))
        summary = html_to_text(html.unescape(summary) if "&lt;" in summary else summary)
        items.append({
            "title": title,
            "link": link,
            "date": _feed_date(_text(_child(e, "pubdate", "published", "updated", "date"))),
            "summary": _clean_summary(summary, title, author)[:1200],
            "author": author,
            "category": _category(e, link),
        })
    return html_to_text(title), items


WP_POSTS = "/wp-json/wp/v2/posts"


def load_wordpress(posts_url):
    """WordPress sites with RSS turned off (e.g. maritime-unipi.gr) still serve their public REST API."""
    base = posts_url.split("/wp-json/")[0]
    data, _, _ = fetch_url(posts_url + "?per_page=40&_fields=id,date_gmt,link,title,excerpt,categories")
    try:
        posts = json.loads(data)
        cats_raw, _, _ = fetch_url(base + "/wp-json/wp/v2/categories?per_page=100&_fields=id,name")
        cats = {c["id"]: html_to_text(html.unescape(c["name"])) for c in json.loads(cats_raw)}
    except (ValueError, KeyError, TypeError):
        raise ApiError(422, "Not a WordPress posts feed")
    items = []
    for p in posts if isinstance(posts, list) else []:
        link = p.get("link") or ""
        items.append({
            "title": html_to_text(html.unescape((p.get("title") or {}).get("rendered", ""))) or "(untitled)",
            "link": link if urllib.parse.urlsplit(link).scheme in ("http", "https") else "",
            "date": _feed_date((p.get("date_gmt") or "") + "+00:00") if p.get("date_gmt") else "",
            "summary": html_to_text(html.unescape((p.get("excerpt") or {}).get("rendered", "")))[:1200],
            "author": "",
            "category": next((cats[c] for c in p.get("categories") or [] if c in cats), "")[:40],
        })
    return items


def load_feed(url):
    """Fetch a URL; if it is an HTML page, auto-discover its RSS/Atom link (or WordPress API)."""
    if WP_POSTS in urllib.parse.urlsplit(url).path:
        return url, "", load_wordpress(url)
    data, final, ctype = fetch_url(url)
    if ctype == "text/html" or data.lstrip()[:15].lower().startswith((b"<!doctype html", b"<html")):
        finder = _FeedLinkFinder()
        finder.feed(data.decode("utf-8", "replace"))
        if not finder.found:
            # WordPress may advertise its API only in a Link header; try the standard location
            api_root = urllib.parse.urljoin(final, finder.wp_api or "/wp-json/")
            posts = check_feed_url(api_root.rstrip("/") + "/wp/v2/posts")
            try:
                return posts, finder.title, load_wordpress(posts)
            except Exception:
                raise ApiError(422, "No RSS/Atom feed found on that page. Paste the feed URL instead.")
        feed_url = check_feed_url(urllib.parse.urljoin(final, finder.found))
        data, final, _ = fetch_url(feed_url)
        title, items = parse_feed(data, final)
        return feed_url, title or finder.title, items
    title, items = parse_feed(data, final)
    return url, title, items


_feed_cache = {}            # url -> (timestamp, title, items, error)
_feed_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=8)


def get_feed_cached(url, force=False):
    with _feed_lock:
        hit = _feed_cache.get(url)
    if hit and not force and time.time() - hit[0] < FEED_CACHE_TTL:
        return hit
    try:
        _, title, items = load_feed(url)
        entry = (time.time(), title, items, None)
    except ApiError as e:
        entry = (time.time(), "", hit[2] if hit else [], str(e))
    except Exception as e:
        entry = (time.time(), "", hit[2] if hit else [], f"Could not load feed ({e.__class__.__name__})")
    with _feed_lock:
        _feed_cache[url] = entry
    return entry


# ------------------------------------------------- DIT undergraduate studies ---

DIT_STUDIES = "https://www.di.uoa.gr/studies/undergraduate"
DIT_STUDY_TABS = [                      # the page itself + every page in its "Σπουδές" menu
    ("", "Επισκόπηση"), ("courses", "Μαθήματα"), ("schedules", "Πρόγραμμα Μαθημάτων & Εξετάσεων"),
    ("student-guide", "Οδηγός Σπουδών"), ("first-year-guide", "Οδηγός Πρωτοετών"),
    ("studentadvisors", "Ακαδημαϊκοί Σύμβουλοι"), ("thesis", "Πτυχιακή Εργασία"),
    ("internship", "Πρακτική Άσκηση"), ("rights", "Θέματα Φοίτησης"),
    ("transfers", "Μετεγγραφές"), ("qualifiers", "Κατατακτήριες"),
]
_dit_cache = {}                         # slug -> (time, page)
DIT_CACHE_TTL = 3600


class _PageBlocks(HTMLParser):
    """Turn a di.uoa.gr page's content region into plain blocks (no markup, scripts or images survive):
    {"t": "h", "level", "inl"} · {"t": "p"|"li", "inl"} · {"t": "section", "text"} · {"t": "table", "rows"}
    where inl is a list of {"text"[, "href"]}."""

    SKIP = {"script", "style", "nav", "form", "svg", "picture", "video", "iframe", "noscript", "select", "template"}
    VOID = {"br", "hr", "img", "input", "meta", "link", "source", "wbr", "area", "col", "embed", "param", "track"}
    BLOCK = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "tr", "table", "ul", "ol",
             "section", "article", "blockquote", "dd", "dt", "header", "footer"}

    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base, self.blocks, self.inl = base, [], []
        self.depth = 0                  # >0 while inside the content region
        self.skip = 0                   # >0 while inside skipped markup (nesting count)
        self.kind = []                  # enclosing block kinds
        self.href, self.table, self.cell = None, None, None

    def _flush(self):
        text = "".join(x["text"] for x in self.inl).strip()
        if text:
            inl = [x for x in self.inl if x["text"].strip() or x.get("href")]
            if self.cell is not None:
                self.cell["inl"] += [dict(x) for x in inl] + [{"text": " "}]
            else:
                k = self.kind[-1] if self.kind else "p"
                block = {"t": k if k in ("li", "section") else "p", "inl": inl}
                if k.startswith("h"):
                    block = {"t": "h", "level": int(k[1]), "inl": inl}
                elif k == "section":
                    block = {"t": "section", "text": " ".join(text.split())}
                self.blocks.append(block)
        self.inl = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get("class") or "").split()
        if not self.depth:
            if tag == "div" and "region-content" in cls:
                self.depth = 1
            return
        void = tag in self.VOID
        if tag == "div":
            self.depth += 1
        if self.skip:                   # inside skipped markup: just keep the nesting balanced
            self.skip += 0 if void else 1
            return
        hidden = {"visually-hidden", "sr-only", "pager", "views-view-grid"} & set(cls)    # grid = duplicate of the tables
        if tag == "iframe" and a.get("src"):        # embedded app (e.g. the timetable): offer it as a link
            src = urllib.parse.urljoin(self.base, a["src"])
            if urllib.parse.urlsplit(src).scheme in ("http", "https"):
                self._flush()
                self.blocks.append({"t": "p", "inl": [{"text": "Άνοιγμα στο di.uoa.gr ↗", "href": src}]})
        if tag in self.SKIP or hidden or (tag == "button" and "accordion-button" not in cls):
            self.skip = 0 if void else 1
            return
        if tag == "br":
            self.inl.append({"text": " "})
            return
        if tag in self.BLOCK or tag == "button":
            self._flush()
        if tag == "button":
            self.kind.append("section")             # accordion header
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6", "li"):
            self.kind.append(tag)
        elif tag == "table":
            self.table = {"t": "table", "rows": []}
        elif tag == "tr" and self.table is not None:
            self.table["rows"].append({"head": False, "cells": []})
        elif tag in ("td", "th") and self.table is not None and self.table["rows"]:
            self.cell = {"inl": []}
            if tag == "th":
                self.table["rows"][-1]["head"] = True
        elif tag == "a":
            href = urllib.parse.urljoin(self.base, a.get("href") or "")
            self.href = href if urllib.parse.urlsplit(href).scheme in ("http", "https", "mailto") else None

    def handle_endtag(self, tag):
        if not self.depth or tag in self.VOID:
            return
        if tag == "div":
            self.depth -= 1
        if self.skip:
            self.skip -= 1
            return
        if tag in self.BLOCK or tag == "button":
            self._flush()
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6", "li", "button") and self.kind:
            self.kind.pop()
        elif tag in ("td", "th") and self.cell is not None and self.table is not None:
            text = " ".join("".join(x["text"] for x in self.cell["inl"]).split())
            self.table["rows"][-1]["cells"].append({"text": text, "links": [x for x in self.cell["inl"] if x.get("href")]})
            self.cell = None
        elif tag == "table" and self.table is not None:
            rows = [r for r in self.table["rows"] if any(c["text"] for c in r["cells"])]
            if rows:
                self.blocks.append({"t": "table", "rows": rows})
            self.table = None
        elif tag == "a":
            self.href = None

    def handle_data(self, data):
        if not self.depth or self.skip or not data.strip() and not self.inl:
            return
        item = {"text": data}
        if self.href:
            item["href"] = self.href
        self.inl.append(item)


def dit_study_page(slug, force=False):
    hit = _dit_cache.get(slug)
    if hit and not force and time.time() - hit[0] < DIT_CACHE_TTL:
        return hit[1]
    url = DIT_STUDIES + (f"/{slug}" if slug else "")
    data, final, _ = fetch_url(url)
    parser = _PageBlocks(final)
    parser.feed(data.decode("utf-8", "replace"))
    parser.close()
    blocks = parser.blocks
    title = next(("".join(x["text"] for x in b["inl"]).strip() for b in blocks if b["t"] == "h" and b["level"] == 1), "")
    blocks = [b for b in blocks if not (b["t"] == "h" and b["level"] == 1)]      # the tab shows the title
    for b in blocks:                    # "Εξάμηνο: 1ο" group captions are headings
        text = " ".join("".join(x["text"] for x in b.get("inl", [])).split())
        if b["t"] == "p" and re.fullmatch(r"Εξάμηνο:\s*\S+", text):
            b.update(t="h", level=3, inl=[{"text": text}])
    blocks = [b for b in blocks if "".join(x["text"] for x in b.get("inl", [])).strip() != "Paragraph Section"]
    page = {"slug": slug, "title": title, "url": url, "blocks": blocks}
    _dit_cache[slug] = (time.time(), page)
    return page


# --------------------------------------------------------------- DitLab ---

DITLAB_API = "https://files.ditlab.gr/filebrowser/api"
DITLAB_UA = "Mozilla/5.0 StudentHub"         # Cloudflare blocks Python's default user agent
DITLAB_PATH_RE = re.compile(r"/[^\x00-\x1f]*")
# "Password: x", "Κωδικός πρόσβασης σας είναι: x", "pass = x" ...
PASSWORD_RE = re.compile(r"(?i)(?:password|passwd|pass|κωδικ[όο]ς(?:\s+πρόσβασης)?|συνθηματικ[όο])"
                         r"[^:=\n]{0,30}[:=：]\s*([^\s<>\"']{4,64})")
USERNAME_RE = re.compile(r"(?i)(?:username|user\s*name|όνομα\s+χρήστη)[^:=\n]{0,20}[:=：]\s*([^\s<>\"']{2,64})")
SAFE_INLINE = {"application/pdf", "text/plain", "image/png", "image/jpeg", "image/gif", "image/webp"}


def password_guesses(text):
    """Likely passwords in an email, best first (the user confirms before anything is sent)."""
    out = []
    for m in PASSWORD_RE.finditer(text or ""):
        g = m.group(1).rstrip(".,;:!)")
        if g and not g.lower().startswith(("http", "www.")) and g not in out:
            out.append(g)
    return out[:5]


def ditlab_path(raw):
    path = "/" + (raw or "").lstrip("/")
    if not DITLAB_PATH_RE.fullmatch(path) or ".." in path.split("/") or len(path) > 1024:
        raise ApiError(400, "Invalid path")
    return path


class DitlabClient:
    """files.ditlab.gr runs File Browser; we sign in to its JSON API and keep the JWT server side."""

    def __init__(self, username, password):
        self.username, self.password = username, password
        self.token = None
        self.lock = threading.Lock()

    def _request(self, path, data=None, auth=True):
        headers = {"User-Agent": DITLAB_UA}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if auth:
            headers["X-Auth"] = self.token
        req = urllib.request.Request(DITLAB_API + path, headers=headers,
                                     data=json.dumps(data).encode() if data is not None else None)
        return _opener.open(req, timeout=NET_TIMEOUT)

    def login(self):
        try:
            with self._request("/login", {"username": self.username, "password": self.password,
                                          "recaptcha": ""}, auth=False) as r:
                token = r.read(8192).decode().strip()
        except urllib.error.HTTPError as e:
            body = e.read(200).decode("utf-8", "replace")
            if e.code == 403 and "error code" not in body:
                raise ApiError(400, "DitLab rejected that username or password")
            raise ApiError(502, f"DitLab is unavailable ({e.code})")
        except OSError as e:
            raise ApiError(502, f"Could not reach DitLab ({e.__class__.__name__})")
        if token.count(".") != 2:
            raise ApiError(502, "DitLab returned an unexpected response")
        self.token = token

    def open(self, path):
        """GET an API path, signing in again once if the 2-hour token expired."""
        with self.lock:
            if not self.token:
                self.login()
        for attempt in (0, 1):
            try:
                return self._request(path)
            except urllib.error.HTTPError as e:
                if e.code in (401, 403) and attempt == 0:
                    with self.lock:
                        self.login()
                    continue
                if e.code == 404:
                    raise ApiError(404, "Not found on DitLab")
                raise ApiError(502, f"DitLab error ({e.code})")
            except OSError as e:
                raise ApiError(502, f"Could not reach DitLab ({e.__class__.__name__})")

    def list(self, path):
        with self.open("/resources" + urllib.parse.quote(path)) as r:
            data = json.loads(r.read(MAX_FEED))
        items = [{"name": i.get("name", ""), "path": i.get("path", ""), "isDir": bool(i.get("isDir")),
                  "size": i.get("size", 0), "modified": i.get("modified", ""), "type": i.get("type", "")}
                 for i in data.get("items") or []]
        items.sort(key=lambda i: (not i["isDir"], i["name"].casefold()))
        return {"path": data.get("path", path), "items": items}

    def search(self, path, query):
        url = "/search" + urllib.parse.quote(path) + "?" + urllib.parse.urlencode({"query": query})
        out = []
        with self.open(url) as r:
            for line in r.read(MAX_FEED).decode("utf-8", "replace").splitlines():
                try:
                    hit = json.loads(line)
                except ValueError:
                    continue
                p = "/" + str(hit.get("path", "")).lstrip("/")
                p = (path.rstrip("/") + p) if path != "/" else p
                out.append({"name": p.rstrip("/").rsplit("/", 1)[-1], "path": p, "isDir": bool(hit.get("dir"))})
                if len(out) >= 300:
                    break
        return out


# --------------------------------------------------------------- grades ---

CAPTURE_DIR = ROOT / "captures"
GRADE_LINK_RE = re.compile(r"βαθμολογ|αναλυτικ|grades|transcript|καρτέλα|ιστορικ", re.I)
# never follow these while exploring a portal: they could sign out or change something
UNSAFE_LINK_RE = re.compile(r"logout|log out|sign ?out|αποσύνδ|έξοδος|exit|delete|διαγραφ|remove|submit|υποβολ|"
                            r"αίτηση|αιτησ|δήλωση|δηλωσ|cancel|ακύρωσ|save|αποθήκ|pay|πληρωμ|javascript:|mailto:", re.I)
TEMPLATE_RE = re.compile(r"\$\{|\{\{|\}\}")
API_STRING_RE = re.compile(r"""["'`]((?:https://[a-z0-9.-]+)?/api/[A-Za-z0-9_./{}$?=&%-]*)["'`]""")
SEMESTER_RE = re.compile(r"(\d{1,2})\s*(?:ο|ου|th|st|nd|rd)?\s*(?:εξάμηνο|εξαμηνο|semester)"
                         r"|(?:εξάμηνο|εξαμηνο|semester)\s*:?\s*(\d{1,2})", re.I)
# header keyword -> field; checked in this order so "Κωδικός Μαθήματος" becomes the code, not the title
GRADE_COLUMNS = [
    ("code", re.compile(r"κωδ|code", re.I)),
    ("grade", re.compile(r"βαθμ(?!ίδ|ιδ)|grade|mark", re.I)),        # not "Βαθμίδα" (academic rank)
    ("semester", re.compile(r"εξάμ|εξαμ|^εξ\.?$|semester", re.I)),
    ("ects", re.compile(r"ects|πιστωτ|credit|^δ\.?μ\.?$|διδακτικ", re.I)),
    ("period", re.compile(r"περίοδ|εξεταστ|period|session", re.I)),
    ("year", re.compile(r"ακαδ|έτος|year", re.I)),
    ("type", re.compile(r"τύπος|κατηγορ|type|category", re.I)),
    ("status", re.compile(r"κατάστ|status|αποτέλ|result", re.I)),
    ("title", re.compile(r"μάθημα|τίτλος|course|title|περιγραφ|name", re.I)),
]


class _Tables(HTMLParser):
    """Every <table> as rows of cell texts, plus every link (text, href)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.links, self._stack, self._cell, self._link = [], [], [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._stack.append([])
        elif tag == "tr" and self._stack:
            self._stack[-1].append([])
        elif tag in ("td", "th") and self._stack and self._stack[-1]:
            self._cell = []
        elif tag == "a":
            self._link = [dict(attrs).get("href") or "", []]
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._stack and self._stack[-1]:
            self._stack[-1][-1].append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "table" and self._stack:
            self.tables.append([r for r in self._stack.pop() if r])
        elif tag == "a" and self._link:
            self.links.append((" ".join("".join(self._link[1]).split()), self._link[0]))
            self._link = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)
        if self._link:
            self._link[1].append(data)


def _grade_value(text):
    m = re.search(r"\d+(?:[.,]\d+)?", text or "")
    if not m:
        return None
    v = float(m.group(0).replace(",", "."))
    return v if 0 <= v <= 10 else None


def _semester_value(text):
    m = SEMESTER_RE.search(text or "") or re.fullmatch(r"\s*(\d{1,2})\s*(?:ο|ου)?\s*", text or "")
    if not m:
        return None
    n = int(next(g for g in m.groups() if g))
    return n if 1 <= n <= 14 else None


def parse_grades_html(page):
    """Find grade tables (Greek or English headers) in a portal page; rows may be grouped by semester."""
    p = _Tables()
    try:
        p.feed(page)
    except Exception:
        return []
    courses = []
    for rows in p.tables:
        cols, start = None, 0
        for i, row in enumerate(rows[:4]):
            found = {}
            for j, cell in enumerate(row):
                for field, rx in GRADE_COLUMNS:
                    if field not in found and len(cell) < 40 and rx.search(cell):
                        found[field] = j
                        break
            if "grade" in found and ("title" in found or "code" in found):
                cols, start = found, i + 1
                break
        if not cols:
            continue
        semester, table = None, []
        for row in rows[start:]:
            if any(TEMPLATE_RE.search(c) for c in row):          # unfilled page template, not data
                continue
            filled = [c for c in row if c]
            if len(filled) == 1 and _semester_value(filled[0]):          # "3ο Εξάμηνο" group row
                semester = _semester_value(filled[0])
                continue
            get = lambda f: row[cols[f]] if f in cols and cols[f] < len(row) else ""
            title, code, raw = get("title"), get("code"), get("grade")
            if not (title or code) or len(filled) < 2:
                continue
            if GRADE_COLUMNS[1][1].search(raw) and not re.search(r"\d", raw):     # repeated header row
                continue
            ects = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*", get("ects"))
            table.append({
                "code": code, "title": title or code, "grade": _grade_value(raw), "gradeText": raw,
                "semester": _semester_value(get("semester")) or semester,
                "ects": float(ects.group(1).replace(",", ".")) if ects else None,
                "period": get("period") or get("year"), "type": get("type"), "status": get("status"),
            })
        if any(c["grade"] is not None for c in table):              # a grades table has at least one grade
            courses += table
    return courses


def _flatten(obj, prefix="", depth=0, out=None):
    """{"courseId": {"title": "x"}} -> {"courseid.title": "x"} (lists are not followed)."""
    out = {} if out is None else out
    if isinstance(obj, dict) and depth < 5:
        for k, v in obj.items():
            _flatten(v, f"{prefix}{str(k).lower()}.", depth + 1, out)
    elif not isinstance(obj, (dict, list)):
        out[prefix[:-1]] = obj
    return out


def _record_lists(data, found=None):
    """Every list of objects anywhere in a JSON document."""
    found = [] if found is None else found
    if isinstance(data, list):
        if data and all(isinstance(x, dict) for x in data):
            found.append(data)
        for x in data:
            _record_lists(x, found)
    elif isinstance(data, dict):
        for v in data.values():
            _record_lists(v, found)
    return found


def _pick(rows, name_rx, value_ok, prefer=None, avoid=None):
    """The flattened key whose name matches and whose values fit, in the most rows."""
    best, best_score = None, 0
    for key in {k for r in rows for k in r}:
        last = key.rsplit(".", 1)[-1]
        if not name_rx.search(key) or (avoid and avoid.search(last)):
            continue
        score = sum(1 for r in rows if key in r and r[key] not in (None, "") and value_ok(r[key])) / len(rows)
        score += 0.5 if prefer and prefer.search(key) else 0
        score -= key.count(".") * 0.01                  # prefer shallower keys on ties
        if score > best_score:
            best, best_score = key, score
    return best


def _num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*", str(v))
    return float(m.group(1).replace(",", ".")) if m else None


def parse_grades_json(data):
    """Grades from a portal's JSON (e.g. sis-portal's feign/student/grades/*), matching fields by name and value."""
    best = []
    for records in _record_lists(data):
        rows = [_flatten(r) for r in records]
        is_grade = lambda v: _num(v) is not None and 0 <= _num(v) <= 10
        grade = _pick(rows, re.compile(r"grade|mark|βαθμ|score", re.I), is_grade,
                      prefer=re.compile(r"(^|\.)(final)?grade(value)?$|(^|\.)grade$", re.I),
                      avoid=re.compile(r"id$|type|scale|min|max|count|avg|average|stat|code|status|weight", re.I))
        is_text = lambda v: isinstance(v, str) and len(v.strip()) > 2 and not v.strip().replace(",", "").replace(".", "").isdigit()
        title = _pick(rows, re.compile(r"title|name|descr", re.I), is_text, prefer=re.compile(r"course", re.I),
                      avoid=re.compile(r"exam|period|teacher|program|department|status|type|tag|semester|year|first|last", re.I))
        if not grade or not title:
            continue
        code = _pick(rows, re.compile(r"code", re.I), lambda v: isinstance(v, (str, int)) and len(str(v)) < 20,
                     prefer=re.compile(r"course", re.I), avoid=re.compile(r"department|program|status|type|grade", re.I))
        semester = _pick(rows, re.compile(r"semester|εξάμ|εξαμ", re.I), lambda v: _semester_value(str(v)) is not None)
        ects = _pick(rows, re.compile(r"ects|credit|units|πιστωτ", re.I), lambda v: _num(v) is not None and 0 < _num(v) <= 60)
        period = _pick(rows, re.compile(r"exam.*period|period|εξεταστ", re.I), is_text,
                       prefer=re.compile(r"title|descr|name", re.I))
        year = _pick(rows, re.compile(r"year|έτος|ακαδ", re.I), lambda v: bool(re.search(r"\d{4}", str(v))))
        kind = _pick(rows, re.compile(r"type|κατηγορ|category", re.I), is_text, prefer=re.compile(r"course", re.I),
                     avoid=re.compile(r"exam|grade|status", re.I))
        courses = []
        for r in rows:
            g = _num(r.get(grade))
            courses.append({
                "code": str(r.get(code) or "") if code else "", "title": str(r.get(title) or "").strip(),
                "grade": g if g is not None and 0 <= g <= 10 else None,
                "gradeText": "" if r.get(grade) is None else str(r.get(grade)),
                "semester": _semester_value(str(r.get(semester))) if semester and r.get(semester) is not None else None,
                "ects": _num(r.get(ects)) if ects else None,
                "period": " ".join(str(r.get(k)) for k in (period, year) if k and r.get(k)) or "",
                "type": str(r.get(kind) or "") if kind else "", "status": "",
            })
        courses = [c for c in courses if c["title"]]
        if sum(c["grade"] is not None for c in courses) > sum(c["grade"] is not None for c in best):
            best = courses
    return best


# sis-portal (ILYDA Unitron) JSON endpoints, from its public resources/assets/js/constant_variables.js
UNITRON_API = {
    "diploma": "feign/student/grades/diploma",                       # "Η Καρτέλα μου"
    "all": "feign/student/grades/all",                               # "Όλες οι προσπάθειες"
    "avg": "feign/student/grades/average_student_course_grades",     # official average
    "scales": "api/general/grading_scale",                           # to convert stored grades
    "program": "feign/student/program_courses",                      # "Πρόγραμμα Σπουδών": every course
}
UNITRON_KEYS = {v: k for k, v in UNITRON_API.items()}


def unitron_grade(base, scale):
    """Unitron stores grades on a 0..1 base scale; this mirrors its fromBaseGrade() in app_lib.js.
    Returns (number or None, text)."""
    b = _num(base)
    if b is None:
        return None, "" if base is None else str(base)
    if scale and all(scale.get(k) is not None for k in ("minNumber", "maxNumber", "step")):
        lo, hi, step = float(scale["minNumber"]), float(scale["maxNumber"]), float(scale["step"])
        raw = (hi - lo) * b + lo
        decimals = len(str(scale["step"]).split(".")[1].rstrip("0")) if "." in str(scale["step"]) else 0
        g = min(round(lo + round((raw - lo) / step) * step, decimals), hi) if step else raw
        return g, f"{g:g}".replace(".", ",")
    if scale and scale.get("grades"):                   # word scale, e.g. "Επιτυχώς"
        for entry in scale["grades"]:
            if not (_num(entry.get("val")) or 0) > b:
                return None, str(entry.get("grade", ""))
        return None, ""
    return (round(b * 10, 2) if b <= 1 else b), ""      # no scale info: assume 0..10


def _unitron_semester(r):
    sem = r.get("semesterId") or r.get("semester") or (r.get("courseId") or {}).get("semesterId") or {}
    if isinstance(sem, dict):
        n = _semester_value(str(sem.get("title") or ""))
        order = sem.get("sortOrder")
        return n or (order if isinstance(order, int) and 0 < order < 15 else None)
    return _semester_value(str(sem))


def parse_unitron_program(program):
    """The study programme (feign/student/program_courses), with the same course fields as the transcript."""
    out = []
    for r in program if isinstance(program, list) else []:
        if not isinstance(r, dict) or r.get("idFather") is not None:
            continue
        course = r.get("courseId") or {}
        code = r.get("courseCode") or r.get("code") or course.get("code") or ""
        title = r.get("title") or course.get("title") or code
        if not title:
            continue
        out.append({"id": r.get("id"), "code": str(code), "title": str(title).strip(), "semester": _unitron_semester(r),
                    "ects": _num(r.get("ects") if r.get("ects") is not None else course.get("ects")),
                    "type": (r.get("typeId") or course.get("typeId") or {}).get("title") or ""})
    return out


def parse_unitron(diploma, attempts=None, scales=None, program=None):
    """sis-portal's transcript: the field names its own grades table uses (app_lib.js studentGradesDatatable),
    plus every other course of the study programme, so each semester lists all its courses."""
    if not isinstance(diploma, list):
        return []
    by_id = {str(s.get("id")): s for s in scales or [] if isinstance(s, dict)}
    tries = {}
    for a in attempts if isinstance(attempts, list) else []:
        if isinstance(a, dict):
            code = a.get("courseCode") or (a.get("courseId") or {}).get("code")
            if code:
                tries[code] = tries.get(code, 0) + 1
    courses = []
    for r in diploma:
        if not isinstance(r, dict) or r.get("idFather") is not None:      # sub-parts of a course
            continue
        course = r.get("courseId") or {}
        code = r.get("courseCode") or course.get("code") or ""
        title = r.get("title") or course.get("title") or code
        scale_id = r.get("gradingScaleId")
        scale = by_id.get(str(scale_id.get("id") if isinstance(scale_id, dict) else scale_id))
        grade, text = unitron_grade(r.get("grade"), scale)
        semester = _unitron_semester(r)
        period = (r.get("examPeriodId") or {}).get("title") or (r.get("homologationTypeId") or {}).get("title") or ""
        year = r.get("syllabus")
        courses.append({
            "code": str(code), "title": str(title).strip(), "grade": grade,
            "gradeText": text or ("" if grade is None else f"{grade:g}".replace(".", ",")),
            "semester": semester, "ects": _num(r.get("ects")), "units": _num(r.get("units")),
            "period": " · ".join(x for x in (period, f"{year}-{year + 1}" if isinstance(year, int) else "") if x),
            "type": (r.get("typeId") or {}).get("title") or "", "status": "",
            "passed": bool(r.get("isPassed")) if r.get("isPassed") is not None else None,
            "counts": r.get("isCountInDiploma") is not False,
            "attempts": tries.get(code), "taken": True,
            "programId": (r.get("programCourseId") or {}).get("id") if isinstance(r.get("programCourseId"), dict) else None,
        })
    courses = [c for c in courses if c["title"]]
    have_ids = {c["programId"] for c in courses if c["programId"] is not None}
    have_codes = {c["code"].casefold() for c in courses if c["code"]}
    for pc in parse_unitron_program(program):          # courses of the programme with no grade yet
        if pc["id"] in have_ids or (pc["code"] and pc["code"].casefold() in have_codes):
            continue
        courses.append(dict(pc, grade=None, gradeText="", units=None, period="", status="", passed=False,
                            counts=True, attempts=None, taken=False, programId=pc["id"]))
    return courses


def summarize_grades(courses):
    """Best grade per course (re-takes appear once), plus averages; ECTS-weighted when ECTS exist."""
    best = {}
    for c in courses:
        key = (c["code"] or c["title"]).casefold()
        old = best.get(key)
        if old is None or (c["grade"] or -1) > (old["grade"] or -1):
            best[key] = dict(c, attempts=c.get("attempts") or (old or {}).get("attempts", 0) + 1)
        else:
            old["attempts"] = c.get("attempts") or old["attempts"] + 1
    rows = sorted(best.values(), key=lambda c: (c["semester"] or 99, c["title"].casefold()))
    for c in rows:
        if c.get("passed") is None:
            c["passed"] = c["grade"] is not None and c["grade"] >= 5
    passed = [c for c in rows if c["passed"] and c["grade"] is not None and c.get("counts", True)]
    weighted = [c for c in passed if c["ects"]]
    stats = {
        "courses": len(rows), "passed": sum(1 for c in rows if c["passed"]),
        "ects": round(sum(c["ects"] or 0 for c in rows if c["passed"] and c.get("counts", True)), 1),
        "average": round(sum(c["grade"] for c in passed) / len(passed), 2) if passed else None,
        "weighted": round(sum(c["grade"] * c["ects"] for c in weighted) / sum(c["ects"] for c in weighted), 2)
        if weighted and len(weighted) == len(passed) else None,
    }
    return {"courses": rows, "semesters": sorted({c["semester"] for c in rows if c["semester"]}), "stats": stats}


class PortalClient:
    """Signs in to a student-records portal (My-Uni, sis-portal) through the university CAS and reads pages."""

    def __init__(self, cas, start, kind=""):
        self.cas, self.start, self.kind = cas, start, kind
        self.api = list(UNITRON_API.values()) if kind == "unitron" else []
        self.host, self.sso_host = urllib.parse.urlsplit(start).hostname, cas.sso_host
        self.lock = threading.Lock()
        self.landing = None             # (url, html) after sign-in

    def _open(self, url, data=None):
        return self.cas.open(url, data)

    def get(self, url):
        if urllib.parse.urlsplit(url).hostname != self.host:
            raise ApiError(400, "Refusing to leave the portal")
        return self._open(url)

    def login(self):
        with self.lock:
            if self.landing:
                return self.landing
            url, _, page = self.cas.through(self.start)
            if urllib.parse.urlsplit(url).hostname != self.host:
                raise ApiError(502, f"Sign-in to {self.host} through {self.sso_host} failed")
            self.landing = (url, page)
            return self.landing

    def candidate_pages(self, explore=False):
        """The landing page plus same-site pages whose link text looks like grades
        (with explore=True, up to 25 navigation links, skipping anything that could change state)."""
        url, page = self.login()
        pages = [(url, "text/html", page)]
        p = _Tables()
        try:
            p.feed(page)
        except Exception:
            pass
        seen = {url}
        for text, href in p.links:
            target = urllib.parse.urljoin(url, href)
            wanted = GRADE_LINK_RE.search(text) or (explore and text)
            if (wanted and target not in seen and urllib.parse.urlsplit(target).hostname == self.host
                    and not UNSAFE_LINK_RE.search(text + " " + href)):
                seen.add(target)
                try:
                    pages.append(self.get(target))
                except Exception:
                    pass
                if len(pages) > (25 if explore else 6):
                    break
        return pages

    def api_json(self):
        """Call the portal's own JSON endpoints (the ones its grades pages use), signed in.
        Returns [(path, parsed JSON or None, raw text)]."""
        url, page = self.login()
        m = re.search(r'name="_csrf"\s+content="([^"]+)"', page)
        headers = {"X-Requested-With": "XMLHttpRequest", **({"X-CSRF-TOKEN": m.group(1)} if m else {})}
        out = []
        for path in self.api:
            try:
                _, _, body = self.cas.open(urllib.parse.urljoin(self.start, path), accept="application/json",
                                           headers=headers)
            except urllib.error.HTTPError as e:
                out.append((path, None, f"HTTP {e.code}"))
                continue
            except OSError as e:                        # timeouts etc.: fall back to reading the pages
                out.append((path, None, e.__class__.__name__))
                continue
            try:
                out.append((path, json.loads(body), body))
            except ValueError:
                out.append((path, None, body[:2000]))
        return out

    def grades(self):
        """(courses, extra) — extra may carry the portal's official average."""
        if self.kind == "unitron":
            data = {UNITRON_KEYS[path]: d for path, d, _ in self.api_json()}
            courses = parse_unitron(data.get("diploma"), data.get("all"), data.get("scales"), data.get("program"))
            if courses:
                return courses, {"official": _num(data.get("avg"))}
        for _, data, _ in self.api_json():
            courses = parse_grades_json(data) if data is not None else []
            if courses:
                return courses, {}
        courses = []
        for _, ctype, body in self.candidate_pages():
            if ctype == "text/html":
                courses += parse_grades_html(body)
        return courses, {}

    def capture(self):
        """Save what the portal returned (pages + the API paths its scripts mention) for setting up the reader.
        Stays on this computer: <app>/captures/<time>/, readable only by you."""
        folder = CAPTURE_DIR / time.strftime("%Y%m%d-%H%M%S")
        folder.mkdir(parents=True, mode=0o700, exist_ok=True)
        os.chmod(CAPTURE_DIR, 0o700)

        def save(name, text):
            fd = os.open(folder / name, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(text)
        pages = self.candidate_pages(explore=True)
        index, scripts, apis = [], [], set()
        for i, (url, ctype, body) in enumerate(pages):
            save(f"page{i}.html", body)
            index.append(f"page{i}.html\t{ctype}\t{url}")
            scripts += [urllib.parse.urljoin(url, src) for src in re.findall(r'<script[^>]+src="([^"]+)"', body)]
        for src in dict.fromkeys(scripts):
            if urllib.parse.urlsplit(src).hostname != self.host:
                continue
            try:
                _, _, js = self.get(src)
            except Exception:
                continue
            apis.update(API_STRING_RE.findall(js))
        for i, (path, data, raw) in enumerate(self.api_json()):
            save(f"api{i}.json", json.dumps(data, ensure_ascii=False, indent=1) if data is not None else raw)
            index.append(f"api{i}.json\t{'json' if data is not None else 'not json'}\t{path}")
        save("index.txt", "\n".join(index) + "\n")
        save("api-paths.txt", "\n".join(sorted(apis)) + "\n")
        return folder


# --------------------------------------------------------------- eClass ---

ECLASS_NEXT_RE = re.compile(r"/(courses|modules)/[A-Za-z0-9_./?=&%-]*")
ECLASS_NOTIF_RE = re.compile(
    r"<a\b[^>]*href='([^']+)'[^>]*aria-label='([^']*)'[^>]*>.*?badge[^>]*>\s*(\d+)", re.S)
ECLASS_RSS_RE = re.compile(r'href="([^"]*modules/announcements/rss\.php\?c=[^"]+)"')


class EclassClient:
    """Signs in to a university's eClass through its CAS (server side) and reads the user's courses.

    Courses come from Open eClass's mobile API (modules/mobile/mcourses.php). Each course's
    announcements page carries a personal RSS link (uid + token) that works for members-only
    courses; we pick it up once per session and then read it like any other feed.
    """

    def __init__(self, cas, base="https://eclass.uoa.gr/"):
        self.cas, self.jar = cas, cas.jar
        self.base, self.host, self.sso_host = base, urllib.parse.urlsplit(base).hostname, cas.sso_host
        self.lock = threading.Lock()
        self.signed_in = False
        self.courses = None
        self.feed_urls = {}             # course code -> personal RSS URL (None if the course has none)

    def _open(self, url, data=None):
        final, _, body = self.cas.open(url, data)
        return final, body

    def _session_id(self):
        for c in self.jar:
            if c.name == "PHPSESSID" and c.domain.endswith(self.host):
                return c.value
        return None

    def _login(self):
        # cas.php redirects to the SSO; with an existing SSO session CAS sends us straight back
        url, _, page = self.cas.through(self.base + "modules/auth/cas.php")
        if urllib.parse.urlsplit(url).hostname != self.host or not self._session_id():
            if "Too Many Requests" in page:
                raise ApiError(429, "The university login is rate-limiting sign-ins. Try again in a few minutes.")
            raise ApiError(502, f"eClass sign-in through {self.sso_host} failed")
        self.signed_in = True

    def _mobile_courses(self):
        _, body = self._open(self.base + "modules/mobile/mcourses.php", {"token": self._session_id()})
        body = body.strip()
        if body in ("EXPIRED", "FAILED"):
            return None
        if body == "NOTENABLED" or "<!doctype" in body[:200].lower() or "<!entity" in body.lower():
            raise ApiError(502, "eClass did not return a course list")
        root = ET.fromstring(body.encode())
        return [{"code": c.get("code"), "title": (c.get("title") or c.get("code")).strip(),
                 "teacher": (c.get("teacher") or "").strip()}
                for c in root.iter("course") if c.get("code")]

    def get_courses(self, force=False):
        with self.lock:
            if self.courses is not None and not force:
                return self.courses
            courses = None
            if self.signed_in:
                courses = self._mobile_courses()
            if courses is None:                     # not signed in yet, or the session expired
                self._login()
                courses = self._mobile_courses()
            if courses is None:
                raise ApiError(502, "eClass session could not be started")
            self.courses = courses
            return courses

    def feed_url(self, code):
        if code not in self.feed_urls:
            _, page = self._open(self.base + "modules/announcements/index.php?course=" + urllib.parse.quote(code))
            m = ECLASS_RSS_RE.search(page)
            self.feed_urls[code] = urllib.parse.urljoin(self.base, html.unescape(m.group(1))) if m else None
        return self.feed_urls[code]

    def notifications(self):
        """Per-course badges from eClass (new documents, announcements, assignments… since last visit).

        main/notifications.php wants numeric course ids; the portfolio page lists them. The
        badge links inside the response carry the course code, which we key the result by.
        """
        _, page = self._open(self.base + "main/portfolio.php")
        ids = list(dict.fromkeys(re.findall(r"""lesson-notifications['"]\s+data-id=['"](\d+)""", page)))
        if not ids:
            return {}
        _, body = self._open(self.base + "main/notifications.php?"
                             + urllib.parse.urlencode([("courseIDs[]", i) for i in ids]))
        data = json.loads(body).get("notifications_courses") or {}
        result = {}
        for entry in (data.values() if isinstance(data, dict) else data):
            content = entry.get("notification_content", "") if isinstance(entry, dict) else ""
            for href, label, count in ECLASS_NOTIF_RE.findall(content):
                href = html.unescape(href)
                m = re.search(r"[?&]course=([^&]+)", href)
                if not m:
                    continue
                n = result.setdefault(urllib.parse.unquote(m.group(1)), {"total": 0, "items": []})
                path = urllib.parse.urlsplit(urllib.parse.urljoin(self.base, href))
                n["total"] += int(count)
                n["items"].append({"label": html.unescape(label), "count": int(count),
                                   "path": path.path + ("?" + path.query if path.query else "")})
        return result

    def announcements(self, force=False):
        courses = self.get_courses(force)
        try:
            notes = self.notifications()
        except Exception:
            notes = {}                      # badges are a bonus; never block announcements on them
        for c in courses:
            n = notes.get(c["code"], {"total": 0, "items": []})
            c["notifications"], c["notifCount"] = n["items"], n["total"]

        def one(course):
            try:
                url = self.feed_url(course["code"])
            except Exception:
                return course, [], "Could not open the course's announcements"
            if not url:
                return course, [], None
            _, _, items, err = get_feed_cached(url, force)
            return course, items, err

        items, errors = [], []
        for course, its, err in _pool.map(one, courses):
            course["count"] = len(its)
            if err:
                errors.append({"feed": course["title"], "error": err})
            for it in its:
                items.append(dict(it, source=course["title"], sourceId="ec:" + course["code"],
                                  category="", eclass=True))
        items.sort(key=lambda x: x["date"] or "", reverse=True)
        return {"courses": courses, "items": items, "errors": errors}


# ------------------------------------------------------------- sessions ---

class Session:
    def __init__(self, account, inst=None):
        self.inst = inst                    # "uoa", "unipi" or None (other providers)
        self.token = secrets.token_urlsafe(32)
        self.csrf = secrets.token_urlsafe(32)
        self.account = account
        self.seen = time.time()
        self.cache = {}
        self.eclass = None
        self.ditlab = None
        self.portal = None
        self.cas = getattr(account, "cas", None)      # shared university SSO session
        self.browser_sso = {}                         # service -> when the browser last signed in via a link


_sessions = {}
_sessions_lock = threading.Lock()
_login_failures = []        # timestamps of recent failed logins


def reap_sessions():
    now = time.time()
    with _sessions_lock:
        dead = [t for t, s in _sessions.items() if now - s.seen > SESSION_IDLE]
        for t in dead:
            _sessions.pop(t).account.close()


def login_throttled():
    now = time.time()
    _login_failures[:] = [t for t in _login_failures if now - t < 60]
    return len(_login_failures) >= 5


# --------------------------------------------------------------- server ---

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
APP_CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
           "connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; "
           "form-action 'none'; object-src 'none'")
# Email HTML is shown in a sandboxed frame: no scripts, no remote loads (blocks tracking pixels).
MAIL_CSP = ("default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; "
            "frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox allow-popups "
            "allow-popups-to-escape-sandbox")

_static_cache = {}


class Handler(BaseHTTPRequestHandler):
    server_version = "StudentHub"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # never log query strings or bodies
        sys.stderr.write(f"{self.log_date_time_string()} {self.command} {self.path.split('?')[0]} "
                         f"{args[1] if len(args) > 1 else ''}\n")

    # ---- plumbing
    def _host_ok(self):
        host = self.headers.get("Host", "")
        return host in (f"127.0.0.1:{PORT}", f"localhost:{PORT}")       # blocks DNS rebinding

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        return origin is None or origin in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}")

    def _send(self, status, body, ctype, extra=None, cacheable=False):
        if isinstance(body, str):
            body = body.encode()
        headers = dict(SECURITY_HEADERS)
        headers["Content-Type"] = ctype
        headers["Cache-Control"] = "no-cache" if cacheable else "no-store"
        if extra:
            headers.update(extra)
        if len(body) > 1024 and "gzip" in self.headers.get("Accept-Encoding", ""):
            body = gzip.compress(body, compresslevel=5)
            headers["Content-Encoding"] = "gzip"
            headers["Vary"] = "Accept-Encoding"
        headers["Content-Length"] = str(len(body))
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, obj, extra=None):
        self._send(status, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8", extra)

    def _read_body(self):
        """Consume the request body up front. With keep-alive, an unread body would be parsed
        as the next request on the connection (the browser then sees a 400/501 HTML page)."""
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n < 0 or n > MAX_BODY:
            self.close_connection = True        # can't skip it safely; drop the connection
            self.body = b""
            return False
        self.body = self.rfile.read(n) if n else b""
        return True

    def _read_json(self):
        if "application/json" not in self.headers.get("Content-Type", ""):
            raise ApiError(415, "Expected JSON")
        try:
            return json.loads(self.body or b"{}")
        except ValueError:
            raise ApiError(400, "Malformed JSON")

    def _session(self, required=True):
        reap_sessions()
        # Parse by hand: SimpleCookie silently drops everything after one malformed cookie,
        # and 127.0.0.1 shares cookies with every other local dev server on any port.
        tok = None
        for part in self.headers.get("Cookie", "").split(";"):
            name, _, value = part.strip().partition("=")
            if name == "sh_session":
                tok = value.strip()
        with _sessions_lock:
            s = _sessions.get(tok) if tok else None
        if s:
            s.seen = time.time()
        if required and not s:
            raise ApiError(401, "Not signed in")
        return s

    def _require_csrf(self, s):
        sent = self.headers.get("X-CSRF-Token", "")
        if not secrets.compare_digest(sent, s.csrf):
            raise ApiError(403, "Invalid request token")

    def _dispatch(self, method):
        if not self._read_body():
            return self._json(413, {"error": "Request too large"})
        if not self._host_ok():
            return self._send(421, "Misdirected request", "text/plain")
        parsed = urllib.parse.urlsplit(self.path)
        path, q = parsed.path, urllib.parse.parse_qs(parsed.query)
        try:
            if method != "GET" and not self._origin_ok():
                raise ApiError(403, "Cross-origin request blocked")
            if path.startswith("/api/"):
                route = getattr(self, f"api_{method.lower()}_{path[5:].replace('/', '_')}", None)
                if route is None:
                    raise ApiError(404, "Not found")
                return route(q)
            if method == "GET":
                return self._static(path)
            raise ApiError(405, "Method not allowed")
        except ApiError as e:
            self._json(e.status, {"error": str(e)})
        except Exception as e:                         # don't leak internals to the client
            traceback.print_exc()
            self._json(500, {"error": "Something went wrong"})

    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _static(self, path):
        if path == "/":
            path = "/index.html"
        target = (STATIC / path.lstrip("/")).resolve()
        if STATIC not in target.parents or not target.is_file():
            raise ApiError(404, "Not found")
        mtime = target.stat().st_mtime
        hit = _static_cache.get(target)
        if not hit or hit[0] != mtime:
            data = target.read_bytes()
            hit = (mtime, data, '"' + hashlib.sha256(data).hexdigest()[:16] + '"')
            _static_cache[target] = hit
        _, data, etag = hit
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        extra = {"ETag": etag, "Content-Security-Policy": APP_CSP, "X-Frame-Options": "DENY"}
        self._send(200, data, ctype, extra, cacheable=True)

    # ---- session
    def api_get_session(self, q):
        s = self._session(required=False)
        cfg = load_config()
        info = {"signedIn": bool(s),
                "defaults": {k: cfg.get(k, "") for k in ("imap_url", "smtp_url", "username", "institution")},
                "institutions": {k: {"name": v["name"], "domain": v["domain"], "auth": v["auth"]}
                                 for k, v in INSTITUTIONS.items()}}
        if s:
            a = s.account
            inst = INSTITUTIONS.get(s.inst, {})
            info.update(csrf=s.csrf, user=a.username, email=a.from_addr, mail=a.mail,
                        folders=sorted(r for r in a.folders if r in ("inbox", "sent")),
                        institution={"id": s.inst, "name": inst.get("name", ""), "links": inst.get("links", []),
                                     "webmail": inst.get("webmail", ""), "ditlab": inst.get("ditlab", False),
                                     "eclassHost": urllib.parse.urlsplit(inst.get("eclass") or "").hostname,
                                     "grades": (inst.get("grades") or {}).get("name", ""),
                                     "gradesSso": (inst.get("grades") or {}).get("sso", ""),
                                     "ditStudies": bool(inst.get("ditStudies"))})
        self._json(200, info)

    def api_post_login(self, q):
        if login_throttled():
            raise ApiError(429, "Too many failed attempts. Wait a minute and try again.")
        b = self._read_json()
        user, pw = str(b.get("username", "")).strip(), str(b.get("password", ""))
        if not user or not pw:
            raise ApiError(400, "Username and password are required")
        email_addr = str(b.get("email") or "").strip() or user
        if not addr_list(email_addr) or len(addr_list(email_addr)) != 1:
            raise ApiError(400, "Enter your email address")
        inst_id = str(b.get("institution") or "")
        inst = INSTITUTIONS.get(inst_id)
        if inst and inst["auth"] == "sso":
            acct = SsoAccount(inst["sso"], user, pw, email_addr)
        else:
            acct = MailAccount(b.get("imap_url"), b.get("smtp_url"), user, pw, email_addr)
            inst_id = "uoa" if acct.imap[0].endswith("uoa.gr") else None
        try:
            acct.login()
        except ApiError as e:
            if e.status == 401:
                _login_failures.append(time.time())
            raise
        s = Session(acct, inst_id)
        with _sessions_lock:
            _sessions[s.token] = s
        cfg = load_config()
        cfg.update(username=user, institution=inst_id or "")
        if acct.mail:
            cfg.update(imap_url=str(b.get("imap_url", "")), smtp_url=str(b.get("smtp_url", "")))
        save_config(cfg)
        cookie = f"sh_session={s.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_IDLE * 16}"
        self._json(200, {"ok": True, "csrf": s.csrf}, {"Set-Cookie": cookie})

    def api_post_logout(self, q):
        s = self._session(required=False)
        if s:
            self._require_csrf(s)
            with _sessions_lock:
                _sessions.pop(s.token, None)
            s.account.close()
            s.account.password = None
            if s.cas:                       # forget the university SSO session and its password
                s.cas.password = None
                s.cas.jar.clear()
            s.eclass = s.ditlab = s.portal = s.cas = None
        self._json(200, {"ok": True}, {"Set-Cookie": "sh_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})

    # ---- mail
    def _role(self, q):
        role = (q.get("folder") or ["inbox"])[0]
        if role not in ("inbox", "sent"):
            raise ApiError(400, "Unknown folder")
        return role

    def api_get_mail(self, q):
        s = self._session()
        role = self._role(q)
        unread = (q.get("unread") or ["0"])[0] == "1"
        try:
            page = max(0, min(int((q.get("page") or ["0"])[0]), 1000))
        except ValueError:
            page = 0
        query = " ".join((q.get("q") or [""])[0].split())[:200]     # also strips CR/LF
        key = ("list", role, unread, page, query)
        hit = s.cache.get(key)
        if hit and (q.get("refresh") or ["0"])[0] != "1" and time.time() - hit[0] < MAIL_CACHE_TTL:
            return self._json(200, hit[1])
        result = s.account.list_messages(role, unread, page, query)
        result["pageSize"] = PAGE_SIZE
        s.cache[key] = (time.time(), result)
        self._json(200, result)

    def api_get_message(self, q):
        s = self._session()
        role = self._role(q)
        try:
            uid = int((q.get("uid") or [""])[0])
        except ValueError:
            raise ApiError(400, "Bad message id")
        key = ("msg", role, uid)
        if key not in s.cache:
            s.cache[key] = s.account.get_message(role, uid)
            for k in [k for k in s.cache if k[0] == "list"]:
                s.cache.pop(k, None)         # unread state changed
            if len(s.cache) > 200:
                s.cache.pop(next(iter(s.cache)))
        m = dict(s.cache[key])
        m["hasHtml"] = bool(m.pop("html"))
        self._json(200, m)

    def api_get_message_html(self, q):
        """Serve a message's HTML for a sandboxed iframe, under a no-script, no-remote CSP."""
        s = self._session()
        role = self._role(q)
        try:
            uid = int((q.get("uid") or [""])[0])
        except ValueError:
            raise ApiError(400, "Bad message id")
        m = s.cache.get(("msg", role, uid)) or s.account.get_message(role, uid)
        dark = (q.get("dark") or ["0"])[0] == "1"
        base = ("<meta charset='utf-8'><base target='_blank'><style>html{font:15px/1.5 -apple-system,"
                "BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif;}body{margin:0;padding:4px;"
                "word-wrap:break-word;}img{max-width:100%;height:auto}"
                + ("html{color-scheme:dark;background:#1e1e20;color:#f2f2f7}a{color:#4ea1ff}" if dark else "")
                + "</style>")
        self._send(200, base + m["html"], "text/html; charset=utf-8",
                   {"Content-Security-Policy": MAIL_CSP, "X-Frame-Options": "SAMEORIGIN"})

    def api_post_send(self, q):
        s = self._session()
        self._require_csrf(s)
        b = self._read_json()
        subject, body = str(b.get("subject", ""))[:998], str(b.get("body", ""))
        if len(body) > 500_000:
            raise ApiError(413, "Message is too long")
        s.account.send(str(b.get("to", "")), str(b.get("cc", "")), subject, body,
                       str(b.get("inReplyTo") or "")[:998] or None)
        for k in [k for k in s.cache if k[0] == "list" and k[1] == "sent"]:
            s.cache.pop(k, None)
        self._json(200, {"ok": True})

    # ---- university single sign-on
    def api_get_sso(self, q):
        """Open My-Uni / eClass already signed in by posting the login form to sso.uoa.gr.

        UoA's CAS keeps the login flow in the signed `execution` field, so the browser can
        submit it directly; we only fetch a fresh one. The token in the URL is the session's
        CSRF token, so other sites can't trigger this.
        """
        s = self._session()
        if not secrets.compare_digest((q.get("t") or [""])[0], s.csrf):
            raise ApiError(403, "Invalid request token")
        inst = INSTITUTIONS.get(s.inst)
        to = (q.get("to") or [""])[0]
        service = inst and inst["services"].get(to)
        if not service:
            raise ApiError(400, "Unknown service")
        nxt = (q.get("next") or [""])[0]
        if nxt and to == "eclass":                  # land on a course page instead of the portfolio
            if not ECLASS_NEXT_RE.fullmatch(nxt):
                raise ApiError(400, "Invalid eClass page")
            service += "?next=" + urllib.parse.quote_plus(nxt)
        login_url = inst["sso"] + "?service=" + urllib.parse.quote(service, safe="")
        # The browser keeps its own SSO cookie for ~8 hours after a sign-in, so later links just
        # redirect (no password post); this keeps the university login from rate-limiting us.
        if time.time() - max(s.browser_sso.values(), default=0) < BROWSER_SSO_TTL:
            self.send_response(302)
            self.send_header("Location", login_url)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        execution = None
        try:
            req = urllib.request.Request(login_url, headers={"User-Agent": "Mozilla/5.0 StudentHub"})
            with _opener.open(req, timeout=NET_TIMEOUT) as r:
                page = r.read(MAX_FEED).decode("utf-8", "replace")
            m = re.search(r'name="execution"\s+value="([^"]+)"', page)
            execution = m.group(1) if m else None
        except Exception:
            pass
        if not execution:                   # fall back to the normal login page
            self.send_response(302)
            self.send_header("Location", login_url)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        fields = {"username": s.account.username.split("@")[0], "password": s.account.password,
                  "execution": execution, "_eventId": "submit", "geolocation": ""}
        inputs = "".join(f'<input type="hidden" name="{k}" value="{html.escape(v, quote=True)}">'
                         for k, v in fields.items())
        nonce = secrets.token_urlsafe(16)
        page = (f'<!doctype html><meta charset="utf-8"><title>Signing in…</title>'
                f'<style>body{{font:15px -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;'
                f'display:grid;place-items:center;height:100vh;margin:0;color:#6e6e73}}</style>'
                f'<form method="post" action="{html.escape(login_url, quote=True)}">{inputs}'
                f'<noscript><button>Continue</button></noscript></form><p>Signing you in…</p>'
                f'<script nonce="{nonce}">document.forms[0].submit()</script>')
        csp = (f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline'; "
               f"form-action {inst['form_action']}; base-uri 'none'; frame-ancestors 'none'")
        s.browser_sso[to] = time.time()
        self._send(200, page, "text/html; charset=utf-8", {"Content-Security-Policy": csp})

    # ---- DIT undergraduate studies (di.uoa.gr/studies/undergraduate and its pages)
    def api_get_dit_studies(self, q):
        s = self._session()
        if not INSTITUTIONS.get(s.inst, {}).get("ditStudies"):
            raise ApiError(409, "Only for DIT accounts")
        slug = (q.get("tab") or [""])[0]
        if slug not in dict(DIT_STUDY_TABS):
            raise ApiError(400, "Unknown page")
        page = dit_study_page(slug, force=(q.get("refresh") or ["0"])[0] == "1")
        self._json(200, dict(page, tabs=[{"slug": k, "title": v} for k, v in DIT_STUDY_TABS]))

    # ---- DitLab (files.ditlab.gr)
    def _ditlab_username(self, s):
        return s.account.username.split("@")[0]

    def _ditlab(self, s):
        """The session's DitLab client; signs in automatically from the remembered email."""
        if s.ditlab:
            return s.ditlab
        remembered = load_config().get("ditlab") or {}
        if not remembered.get("message_id"):
            raise ApiError(409, "DitLab is not connected")
        role = remembered.get("folder", "inbox")
        uid = s.account.find_by_message_id(role, remembered["message_id"]) if role in s.account.folders else None
        if not uid:
            raise ApiError(409, "The DitLab password email was not found anymore")
        guesses = password_guesses(s.account.get_message(role, uid, mark_seen=False)["text"])
        if not guesses:
            raise ApiError(409, "No password found in the remembered DitLab email")
        client = DitlabClient(remembered.get("username") or self._ditlab_username(s), guesses[0])
        client.login()
        s.ditlab = client
        return client

    def api_get_ditlab_status(self, q):
        s = self._session()
        if not INSTITUTIONS.get(s.inst, {}).get("ditlab"):
            return self._json(200, {"enabled": False, "connected": False, "username": ""})
        try:
            c = self._ditlab(s)
            return self._json(200, {"connected": True, "username": c.username})
        except ApiError as e:
            if e.status not in (400, 409):
                raise
            self._json(200, {"connected": False, "reason": str(e) if e.status == 400 else "",
                             "username": self._ditlab_username(s)})

    def api_get_ditlab_emails(self, q):
        """Emails mentioning DitLab, newest first, with the password each one seems to contain."""
        s = self._session()
        out = []
        for role in [r for r in ("inbox", "junk") if r in s.account.folders]:
            for m in s.account.list_messages(role, False, 0, "ditlab")["messages"][:15]:
                full = s.account.get_message(role, m["uid"], mark_seen=False)
                text = full["text"]
                user = USERNAME_RE.search(text)
                out.append({"folder": role, "uid": m["uid"], "subject": m["subject"], "from": m["from"],
                            "date": m["date"], "text": text[:4000], "guesses": password_guesses(text),
                            "username": user.group(1) if user else ""})
        out.sort(key=lambda m: m["date"], reverse=True)
        self._json(200, {"emails": out, "username": self._ditlab_username(s)})

    def api_post_ditlab_connect(self, q):
        s = self._session()
        self._require_csrf(s)
        b = self._read_json()
        username = str(b.get("username") or "").strip() or self._ditlab_username(s)
        password = str(b.get("password") or "")
        if not password:
            raise ApiError(400, "Enter your DitLab password")
        client = DitlabClient(username[:100], password[:200])
        client.login()
        s.ditlab = client
        cfg = load_config()
        remembered = {"username": username}
        role, uid = b.get("folder"), b.get("uid")
        if b.get("remember", True) and role in ("inbox", "junk") and isinstance(uid, int):
            mid = s.account.get_message(role, uid, mark_seen=False).get("message_id")
            if mid:                 # remember which email holds the password, never the password
                remembered.update(folder=role, message_id=mid)
        cfg["ditlab"] = remembered
        save_config(cfg)
        self._json(200, {"ok": True, "username": username, "remembered": "message_id" in remembered})

    def api_post_ditlab_disconnect(self, q):
        s = self._session()
        self._require_csrf(s)
        s.ditlab = None
        cfg = load_config()
        cfg.pop("ditlab", None)
        save_config(cfg)
        self._json(200, {"ok": True})

    def api_get_ditlab_files(self, q):
        s = self._session()
        path = ditlab_path((q.get("path") or ["/"])[0])
        self._json(200, self._ditlab(s).list(path))

    def api_get_ditlab_search(self, q):
        s = self._session()
        path = ditlab_path((q.get("path") or ["/"])[0])
        query = " ".join((q.get("q") or [""])[0].split())[:100]
        if len(query) < 2:
            raise ApiError(400, "Type at least 2 characters")
        self._json(200, {"results": self._ditlab(s).search(path, query)})

    def api_get_ditlab_raw(self, q):
        """Stream a DitLab file to the browser. Only PDFs, images and plain text open inline."""
        s = self._session()
        if not secrets.compare_digest((q.get("t") or [""])[0], s.csrf):
            raise ApiError(403, "Invalid request token")
        path = ditlab_path((q.get("path") or [""])[0])
        upstream = self._ditlab(s).open("/raw" + urllib.parse.quote(path) + "?inline=true")
        with upstream:
            ctype = upstream.headers.get_content_type()
            name = path.rstrip("/").rsplit("/", 1)[-1] or "file"
            inline = ctype in SAFE_INLINE
            self.send_response(200)
            for k, v in SECURITY_HEADERS.items():
                self.send_header(k, v)
            self.send_header("Content-Type", (ctype + ("; charset=utf-8" if ctype == "text/plain" else ""))
                             if inline else "application/octet-stream")
            self.send_header("Content-Disposition", ("inline" if inline else "attachment")
                             + "; filename*=utf-8''" + urllib.parse.quote(name))
            self.send_header("Cache-Control", "no-store")
            if ctype != "application/pdf":     # Chrome refuses to render PDFs under a sandbox CSP
                self.send_header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'")
            length = upstream.headers.get("Content-Length")
            if length and length.isdigit():
                self.send_header("Content-Length", length)
            else:
                self.send_header("Connection", "close")
                self.close_connection = True
            self.end_headers()
            while chunk := upstream.read(64 * 1024):
                self.wfile.write(chunk)

    def _cas(self, s):
        """The session's single university sign-on, created on first use."""
        if s.cas is None:
            s.cas = CasSession(INSTITUTIONS[s.inst]["sso"], s.account.username, s.account.password)
        return s.cas

    # ---- grades (My-Uni / sis-portal)
    def _portal(self, s):
        conf = INSTITUTIONS.get(s.inst, {}).get("grades")
        if not conf:
            raise ApiError(409, "Grades aren't available for this account")
        if s.portal is None:
            s.portal = PortalClient(self._cas(s), conf["start"], conf.get("kind", ""))
        return s.portal, conf

    def api_get_grades(self, q):
        s = self._session()
        portal, conf = self._portal(s)
        if (q.get("refresh") or ["0"])[0] == "1":
            portal.landing = None
        courses, extra = portal.grades()
        if not courses:
            return self._json(200, {"found": False, "portal": conf["name"], "courses": [], "semesters": [],
                                    "stats": {}})
        result = summarize_grades(courses)
        if extra.get("official") is not None:
            result["stats"]["official"] = extra["official"]
        self._json(200, dict(result, found=True, portal=conf["name"]))

    def api_post_grades_capture(self, q):
        s = self._session()
        self._require_csrf(s)
        portal, _ = self._portal(s)
        folder = portal.capture()
        self._json(200, {"ok": True, "folder": str(folder)})

    # ---- eClass courses
    def api_get_eclass(self, q):
        s = self._session()
        if not INSTITUTIONS.get(s.inst, {}).get("eclass"):
            return self._json(200, {"enabled": False, "courses": [], "items": [], "errors": []})
        if s.eclass is None:
            inst = INSTITUTIONS[s.inst]
            s.eclass = EclassClient(self._cas(s), inst["eclass"])
        result = s.eclass.announcements(force=(q.get("refresh") or ["0"])[0] == "1")
        self._json(200, dict(result, enabled=True))

    # ---- announcements
    def api_get_feeds(self, q):
        s = self._session()
        self._json(200, {"feeds": feeds_for(load_config(), s.inst)})

    def api_post_feeds(self, q):
        s = self._session()
        self._require_csrf(s)
        b = self._read_json()
        url = check_feed_url(b.get("url"))
        cfg = load_config()
        if len(cfg.get("feeds", [])) >= 30:
            raise ApiError(400, "You can add up to 30 sources")
        feed_url, title, items = load_feed(url)
        if any(f["url"] == feed_url for f in feeds_for(cfg, s.inst)):
            raise ApiError(409, "That source is already added")
        name = str(b.get("name") or "").strip()[:60] or title[:60] or urllib.parse.urlsplit(feed_url).hostname
        feed = {"id": secrets.token_hex(6), "name": name, "url": feed_url, "inst": s.inst}
        cfg.setdefault("feeds", []).append(feed)
        save_config(cfg)
        with _feed_lock:
            _feed_cache[feed_url] = (time.time(), title, items, None)
        self._json(200, {"feed": feed, "count": len(items)})

    def api_delete_feeds(self, q):
        s = self._session()
        self._require_csrf(s)
        fid = (q.get("id") or [""])[0]
        cfg = load_config()
        cfg["feeds"] = [f for f in cfg.get("feeds", []) if f["id"] != fid]
        save_config(cfg)
        self._json(200, {"ok": True})

    def api_get_announcements(self, q):
        s = self._session()
        feeds = feeds_for(load_config(), s.inst)
        fid = (q.get("feed") or [""])[0]
        if fid:
            feeds = [f for f in feeds if f["id"] == fid]
        force = (q.get("refresh") or ["0"])[0] == "1"
        results = list(_pool.map(lambda f: (f, get_feed_cached(f["url"], force)), feeds))
        items, errors = [], []
        for f, (_, _, its, err) in results:
            if err:
                errors.append({"feed": f["name"], "error": err})
            for it in its:
                items.append(dict(it, source=f["name"], sourceId=f["id"]))
        items.sort(key=lambda x: x["date"] or "", reverse=True)
        self._json(200, {"items": items[:300], "errors": errors})


def main():
    socket.setdefaulttimeout(NET_TIMEOUT * 2)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    httpd.daemon_threads = True
    print(f"Student Hub running at http://127.0.0.1:{PORT}  (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        with _sessions_lock:
            for s in _sessions.values():
                s.account.close()


if __name__ == "__main__":
    main()
