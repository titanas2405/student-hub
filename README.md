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
- **eClass course details**: a course opens on its assignments (*Εργασίες*, with a red count of open deadlines), with tabs for the other tools the course has enabled. eClass's "new since your last visit" counts appear as blue badges on the matching tabs; only news from tools without a tab here (e.g. the forum) links out to eClass.
  - *Εργασίες*: assignments with deadline, a live countdown, whether you've submitted, and the grade.
  - *Έγγραφα*: browse the course's folders and open or download files with your eClass session.
  - *Ατζέντα*: upcoming and past events, read from the course's iCalendar export.
  - *Βαθμολόγιο*: the course gradebook.
  - *Πληροφορίες*: the course description, one box per section (all open; **+**/**−** to open or close, also for all at once). The text can be selected, and the copy icon copies a section or everything.

  **Προθεσμίες** in the eClass sidebar section gathers the assignments of all your courses: open deadlines first (their count is the red badge), then those without a deadline, submitted, and missed. If an eClass page doesn't look as the reader expects, the tab shows that page's content instead, and keeps a copy in `captures/eclass/` (readable only by you) so the reader can be adjusted.
- **This semester's courses (DIT)**: in the eClass section of the sidebar, the courses the department teaches this semester (according to its timetable) are listed first under *Αυτό το εξάμηνο*. The rest are dimmed under *Άλλα εξάμηνα*. A course with a class right now gets a red **τώρα** tag; hover it to see the time and room.
- **DitLab past exams** (files.ditlab.gr): the app finds the DitLab email in your mailbox that holds your password, and you confirm the password (or type it yourself). It then signs in with your sdi username so you can browse, search and open the files. Only which email holds the password is remembered, never the password itself.
- **Πανεπιστήμιο Πειραιώς** (pick it on the sign-in page): sign in with your UNIPI account (the same as eClass and sis-portal), which is checked through sso.unipi.gr. Announcements come from maritime-unipi.gr through its WordPress API. Your eclass.unipi.gr courses, announcements and notifications appear in the sidebar, the same way as for DIT. Email opens in Outlook, because UNIPI mail is on Microsoft 365, which blocks password access for apps.
- **Βαθμολογίες (grades)**: signs in to My-Uni (ΕΚΠΑ) or sis-portal (ΠΑΠΕΙ) through the university SSO and shows every course's grade, filterable by semester (εξάμηνο), with pass counts, ECTS and averages. If the portal's layout isn't recognized, "Save page structure for setup" stores the pages in `captures/` (readable only by you) so the reader can be matched to it.
- **Πρόγραμμα μαθημάτων (DIT only)**: your week from the department's timetable (di.uoa.gr/schedule), with only the courses you're enrolled in on eClass. It always uses the current semester, as named by the department's schedule page, and reads the timetable's HTML export, so it needs no PDF tools. Where a course is split by student number (άρτιοι/περιττοί ΑΜ, ΑΜ mod 4), only your own section is shown, worked out from your sdi number; the others can be shown greyed out. It includes a "now / next class" card, today highlighted with a current-time line, and a list layout on phones. Press *✎ Επεξεργασία* to make it yours: click a class to change its title, day, hours, room, teacher or note, or to hide it (*Επαναφορά αρχικού* undoes a change). Click an empty slot or *+ Νέα ώρα* to add your own entries (labs, study groups), add any course from the full timetable, or remove one of yours. Edits are saved in `config.json`, separately from the official timetable, so a new version of it keeps them.
- **Βιντεοδιαλέξεις (uniflix.uoa.gr, DIT only)**: the recorded lectures of the eClass courses you're enrolled in, from Τμήμα Πληροφορικής & Τηλεπικοινωνιών only. Courses are matched by name. Each course is a grid of lecture cards (date, duration, teacher, room), filterable by academic year, course and search. Click a card to play it right in the app, with previous/next and a side panel (*Ρυθμίσεις*) for speed (0.5×–4×, `[`/`]` keys), volume up to 400% (with a limiter so boosted speech doesn't distort), contrast and brightness. Settings are remembered. The video is relayed through Student Hub (with seeking), which is what makes the volume boost possible and renews uniflix's expiring links on its own. The app remembers where you stopped (in this browser) and marks lectures you've watched. Recordings under a minute (empty captures) are hidden.
- **Υπότιτλοι (subtitles)**: uniflix has none, so Student Hub makes Greek subtitles on this computer with [Whisper](https://github.com/SYSTRAN/faster-whisper). Nothing is uploaded and no account or key is needed. In the player, press *Δημιουργία υποτίτλων*: the lecture's audio is transcribed in the background (one lecture at a time, at low priority), and subtitles appear as they're ready. They're saved in `~/.cache/student-hub/subtitles/`, so each lecture is done once; lectures that have them show a **CC** badge. Press **C** or the CC button to show or hide them. On an older laptop the *accurate* model (`small`) takes about 1.5× the lecture's length; *γρήγοροι* (`base`) is about 1×, but less accurate. Expect mistakes either way, especially with technical terms. To set it up:
  ```
  python3 -m venv ~/.local/share/student-hub/whisper
  ~/.local/share/student-hub/whisper/bin/pip install faster-whisper
  ```
  (The first run downloads the model, about 480 MB for `small`.)
  **Faster with Groq (optional, free):** create a key at [console.groq.com/keys](https://console.groq.com/keys) and paste it in the player's *AI καθηγητής* panel. Transcription then runs on Groq's servers with Whisper large, so a two-hour lecture takes a few minutes and the result is more accurate. The lecture's audio is sent to Groq. The free tier has limits of roughly 2 hours of audio per hour and 8 per day. For the hourly limit the app waits up to 20 minutes. When the daily limit is reached, it carries on with Whisper on this computer. The key is saved in `~/.config/student-hub/groq-key`, readable only by you, and is never sent back to the page. `GROQ_API_KEY` in the environment works too.
- **AI καθηγητής (Claude)**: in the player, *✦ AI καθηγητής* opens a panel with two tabs.
  - *Σύνοψη* summarizes the lecture section by section, with timestamps that jump the video. It includes the slides with their text transcribed, key terms, announcements, an overview and what to remember for the exam.
  - The lecture is handled in parts of about 10 minutes. Each part's summary appears as soon as that part has been downloaded, transcribed and written, while the later parts show what they're waiting for. The section that's playing is highlighted.
  - *Ερωτήσεις* is a chat with the instructor about the lecture. Answers stream in, and their times are clickable. Follow-up questions continue the same conversation.
  - Above the tabs you choose the *Μοντέλο* (Fable, Opus, Sonnet, Haiku, or your account's default) and the *Σκέψη* (how much Claude thinks before answering, from Λίγη to Μέγιστη).
  - Claude is reached through [Claude Code](https://claude.com/claude-code), signed in with your own Claude plan. Claude Code is run in the background with every tool disabled, so it only reads what it's sent: the transcript, up to 5 frames per part, and your questions. This counts toward your plan's usage limits.
  - Summaries, frames and chats are saved in `~/.cache/student-hub/instructor/<lecture>/`. If a summary stops (say, the plan's limit was reached), *Συνέχεια* resumes from the last finished part.
  - It needs Whisper (above) and Claude Code installed and signed in once (run `claude` and follow the sign-in link).
- **Σήμερα (briefing)**: when you sign in, Claude reads the last two weeks of your mail, your eClass courses' announcements, the department's news and your open eClass assignments, and tells you what you have to do. This opens as the first page.
  - It gives a short summary and a to-do list with deadlines, ordered by urgency. Each task has its course and links to the email, announcement or course it came from.
  - Below that come important dates (exams, moved lectures) and other things worth knowing, and the calendar (see *Ημερολόγιο*).
  - Newsletters and ads are ignored. Already submitted assignments aren't listed. The same deadline found in an email and in eClass appears once.
  - Tick tasks off as you do them; ticks are remembered. The sidebar's *Σήμερα* shows how many tasks are open, in red if some are urgent.
  - On later sign-ins the sources are checked again, but Claude is asked only if something changed, and not again within 20 minutes. ↻ asks again now.
  - Mail stays unread. The model and thinking level are the ones chosen in the *AI καθηγητής* panel.
  - It uses Claude Code with your own plan, like the AI instructor: the emails and announcements are sent to Claude. The briefing is saved in `~/.cache/student-hub/briefing/`, readable only by you.
- **Piazza**: your courses' Piazza posts, read from the notification emails Piazza sends.
  - Each post shows its course, its kind (*Ερώτηση*, *Σημείωση*, *Σημείωση διδάσκοντα*, *Απάντηση*, or a digest with its list of posts), title and preview.
  - **Άνοιγμα της ανάρτησης ↗** opens the post on piazza.com; *Το email* opens the original email in the app.
  - Filter by course, or open a course's Piazza page (↗). The sidebar shows how many are unread.
  - Piazza has no public API for students, and its private one isn't used, so turn on email notifications in Piazza (*Account / Email Settings*: "Real time" or "Smart digest" for each class) to the address you use here.
  - Piazza emails are left unread.
- **Ημερολόγιο (calendar)**: at the bottom of *Σήμερα*, choose what goes into your calendar: open eClass assignment deadlines, the to-dos and important dates from the briefing, and your weekly timetable (repeating until the end of the semester).
  - **⬇ Λήψη .ics** downloads an iCalendar file. Import it into Google Calendar (*Settings → Import & export*), your phone or Thunderbird. Deadlines come with reminders a day and 3 hours before.
  - **Ενημέρωση Google Calendar:** Claude adds the events to your Google Calendar through the *Google Calendar connector of your Claude account*. Connect it once at [claude.ai → Settings → Connectors](https://claude.ai/settings/connectors); Student Hub never sees a Google password or key.
    - Claude gets only the list of events built by the app (never your emails), only the calendar tools, and none that deletes.
    - Events carry a `student-hub:<id>` line, so nothing is added twice and changed deadlines are updated.
  - With *Αυτόματα μετά από κάθε ενημέρωση* on, every new briefing also adds its new deadlines, to-dos and dates to Google Calendar.
- **Μελέτη (exam study mode)**: flashcards for each course, written by Claude.
  - **Making a deck:** *＋ Νέα τράπουλα* lets you choose a course and the sources:
    - the course's lectures with an AI instructor summary or subtitles, from every academic year;
    - files from all the folders of its eClass *Έγγραφα* (PDF, Word, PowerPoint, text; read on this computer);
    - notes you paste in.
    Each source has a ↗ to open it in a new tab first.
  - **The cards:** Greek question-and-answer cards for the exam: definitions, concepts, formulas, algorithm steps, code, and small problems with worked answers.
  - **Where they came from:** each deck lists the lectures, files and notes its cards were made from, with how many cards each gave, plus any file that couldn't be read and why (for example a scanned PDF). Each card shows its own source too: the lecture at the minute it's taught, or the document.
  - *＋ Κάρτες* adds more cards without repeating existing ones, and a wrong card can be deleted.
  - **Studying:** see the question, flip the card (Space) to see the answer, then *Επόμενη* (→) through the deck.
  - **Saved where:** decks are kept in `~/.local/share/student-hub/study/`. Making cards uses your Claude plan, like the AI instructor; studying doesn't.
- **Projects (GitHub)**: a GitHub repository for each assignment, tracked in the app.
  - **Creating a project:** press **Project** next to an assignment (in a course's *Εργασίες* tab or in *Προθεσμίες*), or **＋ Νέο project** on the *Projects* page.
    - The app suggests a repo name from the course and the assignment, transliterating Greek to Latin.
    - It makes a local folder in `~/Projects` with a `README.md` (course, deadline, link to the assignment, team) and a `.gitignore` for C/C++, Python, Java or Node.
    - It then creates a GitHub repository (private by default), pushes to it, and opens it in your IDE.
  - **Team assignments:** they're recognized from eClass (*Ομαδική εργασία*). You're asked for your teammates' GitHub usernames, which are checked before anything is created, and they're invited with push rights. If you leave the list empty, you're asked again before the project is made. You can invite more later with *＋ Πρόσκληση μελών*.
  - **Teammates:** a teammate sees your invitation on their *Projects* page. **Σύνδεση** accepts it and clones the repo; *Σύνδεση σε project ομάδας* also takes any `owner/repo` or GitHub link.
  - **Tracking:** each card shows the deadline, local changes not yet committed, commits to push, new commits from the team, the last commit, and who has joined or not yet accepted.
    - **Pull** brings in your team's commits. It only fast-forwards, so it never merges behind your back.
    - **Push** sends your commits.
    - **Άνοιγμα στο IDE** opens the folder in VS Code, PhpStorm, IntelliJ, PyCharm, CLion, Sublime or Zed, whichever are installed (choose on the page). If this computer has no copy, the repo is cloned first.
    - *Αφαίρεση* only removes the project from the list; the repo and the folder stay.
  - **Requirements:** git and the [GitHub CLI](https://cli.github.com/) signed in once with `gh auth login`, which signs in through a link in the browser. Student Hub never sees your GitHub password or token.
- **Προβολή αρχείων (file viewer)**: eClass documents, DitLab files and mail attachments open inside the app. A Ctrl+click still opens a file in a new tab.
  - **PDF** opens in the browser's own PDF viewer, with search, zoom and printing.
  - **Word, PowerPoint, Excel and OpenDocument** files (`.doc/.docx/.ppt/.pptx/.xls/.xlsx/.odt/.odp/.ods/.rtf`) are converted to PDF on this computer with LibreOffice (`sudo apt install libreoffice` if it's missing). The first time takes a few seconds; after that a file opens at once (cached in `~/.cache/student-hub/converted/`).
  - **Markdown** is shown formatted, with headings, lists, task lists, tables, code and links. *Κείμενο* shows the source.
  - **Images** fit the window. Zoom with the buttons, Ctrl+wheel, double-click or the + and − keys, and drag to move around.
  - **Code and text** (C, Python, Java, …) are shown with line numbers. Greek files from Windows (cp1253) are decoded correctly.
  - **CSV** files are shown as a table.
  - ← and → move to the previous or next file of the same folder or email. The header also has download and new-tab buttons.
  - Nothing in a file can run in the app: Markdown is turned into page elements, never HTML, and HTML or SVG files are shown as text or kept as images.
- **Stays where you were**: reloading the page keeps you on the same view, course tab and Documents folder (per browser tab).
- **Your own sidebar**: sections start closed; click a section's title (Mail, Announcements, eClass, Σπουδές…) to open or close it, and the ones you open stay open. Drag a title by its ⠿ handle to move the section, or focus the title and press Alt+↑/↓. Drag the sidebar's right edge to make it wider or narrower (double-click the edge to reset). Everything is remembered in this browser.
- **Dark mode**: the button next to *Sign out* switches between *Αυτόματο* (follows your system), *Φωτεινό* and *Σκοτεινό*. Your choice is remembered in this browser and applied before the page appears, so there's no flash; email bodies follow it too.
- **Other providers**: pick a provider preset or enter your school's `imaps://` and `smtps://` (or `imap://`/`smtp://` with STARTTLS) URLs. Gmail, iCloud and Yahoo require an *app password*.

## Security
- Listens on `127.0.0.1` only. The Host and Origin headers are checked to block DNS rebinding and cross-site requests.
- Your password is kept in memory only and erased on sign-out or after 30 idle minutes. `~/.config/student-hub/config.json` (mode 600) holds only server URLs, your username and feed URLs.
- Mail connections always use TLS with certificate checks. Plaintext connections are refused.
- Session cookie: HttpOnly and SameSite=Strict. State-changing requests also need a CSRF token. Failed sign-ins are rate-limited.
- Email HTML is shown in a sandboxed iframe with a strict CSP: no scripts and no remote images or tracking pixels. All other content is inserted as text.
- Feeds: http(s) only, a 3 MB limit, DTDs/entities rejected, and HTML stripped to text.
