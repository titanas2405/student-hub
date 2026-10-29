# Student Hub

Your university email, eClass and department announcements in one place, for ΕΚΠΑ (DIT) and Πανεπιστήμιο Πειραιώς (Ναυτιλιακές Σπουδές).

```
python3 server.py
```
Then open http://127.0.0.1:8765. Nothing to install (Python 3.9+ standard library only).

- **Mail**: Inbox, Unread and Sent over IMAP. Read, reply, reply all and compose over SMTP.
- **Announcements**: add any RSS/Atom feed URL, or a school, course or club page that links one. Posts from all sources are merged and sorted by date.
- **ΕΚΠΑ / DIT preset** (the default): `imaps://imap.uoa.gr:993` and `smtps://smtp.uoa.gr:465`. Sign in with your webmail.uoa.gr username and password. The DIT feed (`https://www.di.uoa.gr/rss.xml`) is added on first run, and its posts are grouped into topics (Ανακοινώσεις, Νέα, Εκδηλώσεις, …).
- **eClass courses**: after you sign in, the app also signs in to your university's eClass (eclass.uoa.gr or eclass.unipi.gr) through its SSO, lists your enrolled courses (one sidebar category per course) and merges each course's announcements in with the rest.
- **DitLab past exams** (files.ditlab.gr): the app finds the DitLab email in your mailbox that holds your password, and you confirm the password (or type it yourself). It then signs in with your sdi username so you can browse, search and open the files. Only which email holds the password is remembered, never the password itself.
- **Πανεπιστήμιο Πειραιώς** (pick it on the sign-in page): sign in with your UNIPI account (the same as eClass and sis-portal), which is checked through sso.unipi.gr. Announcements come from maritime-unipi.gr through its WordPress API. Your eclass.unipi.gr courses, announcements and notifications appear in the sidebar, the same way as for DIT. Email opens in Outlook, because UNIPI mail is on Microsoft 365, which blocks password access for apps.
- **Βαθμολογίες (grades)**: signs in to My-Uni (ΕΚΠΑ) or sis-portal (ΠΑΠΕΙ) through the university SSO and shows every course's grade, filterable by semester (εξάμηνο), with pass counts, ECTS and averages. If the portal's layout isn't recognized, "Save page structure for setup" stores the pages in `captures/` (readable only by you) so the reader can be matched to it.
- **Other providers**: pick a provider preset or enter your school's `imaps://` and `smtps://` (or `imap://`/`smtp://` with STARTTLS) URLs. Gmail, iCloud and Yahoo require an *app password*.

## Security
- Listens on `127.0.0.1` only. The Host and Origin headers are checked to block DNS rebinding and cross-site requests.
- Your password is kept in memory only and erased on sign-out or after 30 idle minutes. `~/.config/student-hub/config.json` (mode 600) holds only server URLs, your username and feed URLs.
- Mail connections always use TLS with certificate checks. Plaintext connections are refused.
- Session cookie: HttpOnly and SameSite=Strict. State-changing requests also need a CSRF token. Failed sign-ins are rate-limited.
- Email HTML is shown in a sandboxed iframe with a strict CSP: no scripts and no remote images or tracking pixels. All other content is inserted as text.
- Feeds: http(s) only, a 3 MB limit, DTDs/entities rejected, and HTML stripped to text.
