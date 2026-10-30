# Student Hub

Your university email, eClass and department announcements in one place, for ΕΚΠΑ (DIT) and Πανεπιστήμιο Πειραιώς (Ναυτιλιακές Σπουδές).

## Install

Run the installer once from the Student Hub folder, **before you sign in**. It installs what the app uses, asks
before each optional part (Projects, Word/PDF tools, an AI CLI, Whisper), lets you sign in to the AI CLI and GitHub,
adds a *Student Hub* shortcut and ends with the setup check.

| | Install | Start |
|---|---|---|
| **Windows** | double-click `install-windows.bat` | the *Student Hub* desktop shortcut, or `start-windows.bat` |
| **Linux** (apt, dnf, pacman, zypper) | `./install-linux.sh` (`--yes` = recommended parts, no questions) | *Student Hub* in the applications menu, or `./start-linux.sh` |
| **macOS / anything else** | Python 3.9+, then the optional programs from the setup check | `python3 server.py` |

Then open http://127.0.0.1:8765. The app itself needs only Python 3.9+ (standard library); everything else enables
optional features. The sign-in page has a **setup check** that shows what is installed, what each missing part is
for and the command to add it; `python3 server.py --check` prints the same in a terminal.

### Docker (optional)

```
docker compose up -d --build
docker compose exec -it student-hub claude          # sign in to the AI CLI once
docker compose exec -it student-hub gh auth login   # for Projects
```
Then open http://127.0.0.1:8765. The image has Python, LibreOffice, Ghostscript, Poppler, git, gh and Claude Code,
for **linux/amd64 and linux/arm64** (Intel/AMD PCs, Apple Silicon, ARM laptops, Raspberry Pi 4/5), so it behaves the
same on Windows, macOS and Linux (with Docker Desktop on Windows/macOS). Settings and logins are kept in the
`student-hub-home` volume; project folders are in `./projects` (or set `STUDENT_HUB_PROJECTS` to another folder).
Build options are in `docker-compose.yml` (`WITH_WHISPER: "1"` for local subtitles, `AI_CLI: none`).

What works differently in Docker: *Open in IDE* can't start an editor on your computer (open the project folder
yourself), the assistant's project commands run in the container's Linux rather than on your system, Whisper can't
use the GPU, and the app must stay on port 8765 on both sides (it checks the address it is opened at). The normal
install above has none of these limits, so it is the recommended way.

### Windows

1. Install Python 3.9 or newer from python.org and tick **Add python.exe to PATH** in the installer.
2. Double-click **`start-windows.bat`** in the project folder. It checks the setup, starts Student Hub in UTF-8 mode
   (so Greek text works with every AI CLI and file) and opens http://127.0.0.1:8765. Keep its window open while you
   use the app.
3. Optional programs, each enabling more features. The check lists what's missing and how to install it:
   `winget install Git.Git GitHub.cli` (Projects; then `gh auth login`), `winget install TheDocumentFoundation.LibreOffice`
   (Word → PDF), Ghostscript (PDF compression) and Poppler (PDF merge/split/text), and an AI CLI, which needs Node.js
   (`winget install OpenJS.NodeJS.LTS`): `npm install -g @anthropic-ai/claude-code`, `@google/gemini-cli` or `@openai/codex`,
   then sign in once in a terminal. Claude Code's own installer (`irm https://claude.ai/install.ps1 | iex`) also works; Student Hub finds `%USERPROFILE%\.local\bin\claude.exe` and npm's `%APPDATA%\npm\*.cmd` even when they aren't on PATH. LibreOffice and Ghostscript are found in `Program Files` even if they aren't on PATH.

**Certificate errors on Windows** (e.g. *SSLCertVerificationError* for imap.uoa.gr): Python reads the Windows
certificate store, and Windows only downloads a root certificate the first time Windows itself needs it, so Greek
academic (HARICA) servers can be rejected. `start-windows.bat` installs `truststore`, which makes Python use Windows'
own certificate checks; without it, Student Hub asks Windows to check the server once (which fetches the root) and
retries. If it still fails, the message says why: antivirus "scan encrypted connections / mail shield" replacing
certificates, or a wrong date/time. Certificate checks are never turned off.

To check the setup any time: `py -3 server.py --check` (or `python3 server.py --check` on macOS/Linux). Settings and cached
files are stored under `%APPDATA%\student-hub` and `%LOCALAPPDATA%\student-hub`.
Google Antigravity, Gemini and other AI CLIs must be installed and signed in on
Windows separately; see **Choosing an AI CLI** below.

- **Εργαλεία · Tools**: seven subtabs keep related tools together. The selected subtab is remembered for this browser tab; switching categories keeps selected files, text and the running study timer.
  - **Documents**: Word (.doc/.docx/.odt) → PDF (20 MB; LibreOffice), PDF compression with three quality presets (Ghostscript), and PDF merge/page extraction (Poppler). Merge order can be changed; page selections such as `3, 1-2` preserve your requested order. PDF tools accept up to 50 MB and 300 pages total. Compression can change image quality and invalidates digital signatures.
  - **Images**: PNG/JPG/WebP conversion, image compression with quality and resizing controls, and images → PDF (up to 20 images / 50 MB, reorderable, one A4 page per image). These run in your browser.
  - **Archives**: folder → ZIP (up to 200 MB / 2,000 files; empty folders omitted) in your browser; ZIP browsing and individual file extraction on this computer (50 MB archive, 200 MB expanded / 2,000 entries). Unsafe paths, symlinks and encrypted entries are rejected.
  - **AI**: **Prompt builder**: pick a template (custom, coding task, bug fix, code review, explain a concept, exam preparation, assignment plan, email to a professor, summary, essay outline), fill in its detailed fields plus optional context, requirements, an example, answer format, role, language and detail level, and it builds a structured prompt (role, task, details, requirements, steps, output, style). **Load into assistant** puts it in the ✦ Βοηθός AI question box; coding templates open it in the Projects tab, where you switch on project access. Prompts can be copied, and saved/reused in this browser. **Humanizer**: paste text, pick language (English/Greek), tone, vocabulary and length, and it builds a prompt that asks an AI chat to rewrite the text so it reads naturally. Copy it, or copy it and open ChatGPT, Claude or Gemini. The prompt is built in your browser; nothing is sent from Student Hub. **Project humanizer** does the same for one of your Projects with the AI CLI you chose: it rewrites only the README, Markdown/text files and code comments (Python and C-like languages: JS/TS, Java, C/C++, C#, Go, Rust, Kotlin, Swift, PHP, CSS). Only that text is sent, never the code. A rewrite is refused if it would change the code, code blocks, links, `@tags` or TODO markers. You review a diff per file and apply the ones you want; a file you edited in the meantime is never overwritten, and nothing is committed.
  - **Text**: word/character counter in your browser.
  - **Study**: a Pomodoro timer with adjustable study/break lengths and pause/resume, plus a weighted grade calculator for the exam score needed to reach a target. Check your course's separate minimum exam requirements.
  - **Converters**: length, weight, temperature, time, and decimal/binary data sizes.
  - PDF and ZIP requests use temporary local processing; no third-party conversion service receives files. The app shows missing programs in the relevant tool. On Debian/Ubuntu, optional document tools can be installed with `sudo apt install libreoffice ghostscript poppler-utils`.

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
  On Windows PowerShell, install Whisper in the app's local data directory:
  ```powershell
  $whisper = Join-Path $env:LOCALAPPDATA 'student-hub\whisper'
  py -3 -m venv $whisper
  & (Join-Path $whisper 'Scripts\python.exe') -m pip install faster-whisper
  ```
  The app uses this Windows virtual environment automatically.
  (The first run downloads the model, about 480 MB for `small`.)
  **Faster with Groq (optional, free):** create a key at [console.groq.com/keys](https://console.groq.com/keys) and paste it in the player's *AI καθηγητής* panel. Transcription then runs on Groq's servers with Whisper large, so a two-hour lecture takes a few minutes and the result is more accurate. The lecture's audio is sent to Groq. The free tier has limits of roughly 2 hours of audio per hour and 8 per day. For the hourly limit the app waits up to 20 minutes. When the daily limit is reached, it carries on with Whisper on this computer. The key is saved in `~/.config/student-hub/groq-key`, readable only by you, and is never sent back to the page. `GROQ_API_KEY` in the environment works too.
- **AI καθηγητής (Claude / Gemini / ChatGPT / Antigravity)**: in the player, *✦ AI καθηγητής* opens a panel with two tabs.
  - *Σύνοψη* summarizes the lecture section by section, with timestamps that jump the video. It includes the slides with their text transcribed, key terms, announcements, an overview and what to remember for the exam.
  - The lecture is handled in parts of about 10 minutes. Each part's summary appears as soon as that part has been downloaded, transcribed and written, while the later parts show what they're waiting for. The section that's playing is highlighted.
  - *Ερωτήσεις* is a chat with the instructor about the lecture. Answers stream in, and their times are clickable. Follow-up questions continue the same conversation.
  - Choose the provider, optional model ID and supported thinking level above the tabs, or use **AI** in the sidebar. These preferences apply app-wide and are remembered per provider.
  - The selected provider runs through its signed-in CLI: Claude Code, Gemini CLI, OpenAI Codex CLI, or Google Antigravity CLI. It receives the transcript, up to 5 frames per part and your questions. See **Choosing an AI CLI** below for setup and execution details.
  - Summaries, frames and chats are saved in `~/.cache/student-hub/instructor/<lecture>/`. If a summary stops (say, the plan's limit was reached), *Συνέχεια* resumes from the last finished part.
  - It needs Whisper (above) and your selected AI CLI installed and signed in once.
- **Σήμερα (briefing)**: when you sign in, your selected AI reads the last two weeks of your mail, your eClass courses' announcements, the department's news and your open eClass assignments, and tells you what you have to do. This opens as the first page.
  - It gives a short summary and a to-do list with deadlines, ordered by urgency. Each task has its course and links to the email, announcement or course it came from.
  - Below that come important dates (exams, moved lectures) and other things worth knowing, and the calendar (see *Ημερολόγιο*).
  - Newsletters and ads are ignored. Already submitted assignments aren't listed. The same deadline found in an email and in eClass appears once.
  - Tick tasks off as you do them; ticks are remembered. The sidebar's *Σήμερα* shows how many tasks are open, in red if some are urgent.
  - The first sign-in each day generates a new briefing (Europe/Athens time). Later sign-ins that day reuse it, even if sources or the selected AI change. ↻ manually generates a new briefing whenever you need one.
  - Mail stays unread. The model and thinking level are the ones chosen in the *AI καθηγητής* panel.
  - It uses your selected AI CLI, like the AI instructor: the emails and announcements are sent to that provider. The briefing is saved in `~/.cache/student-hub/briefing/`, readable only by you.
- **Piazza**: connect your separate Piazza account in the tab to browse the actual course feed, sorted by latest activity. Select a course, load older posts, and open full posts, instructor/student answers and follow-up discussions inside Student Hub. Search filters the posts already loaded.
  - The Piazza password is used only for sign-in and is never saved. Connection cookies and the short-lived feed cache stay in the current Student Hub session; disconnect or sign out to clear them.
  - Direct feeds use Piazza's unofficial web endpoints, so changes to Piazza may require an update. Accounts requiring a separate SSO or MFA flow may need to open Piazza directly.
  - **Email notifications** remains a separate view for accounts with mail access. It reads notification emails without marking them read; it is independent of the course feed.
- **Ημερολόγιο (calendar)**: at the bottom of *Σήμερα*, choose what goes into your calendar: open eClass assignment deadlines, the to-dos and important dates from the briefing, and your weekly timetable (repeating until the end of the semester).
  - **⬇ Λήψη .ics** downloads an iCalendar file. Import it into Google Calendar (*Settings → Import & export*), your phone or Thunderbird. Deadlines come with reminders a day and 3 hours before.
  - **Ενημέρωση Google Calendar:** Claude adds the events to your Google Calendar through the *Google Calendar connector of your Claude account*. Connect it once at [claude.ai → Settings → Connectors](https://claude.ai/settings/connectors); Student Hub never sees a Google password or key.
    - Claude gets only the list of events built by the app (never your emails), only the calendar tools, and none that deletes.
    - Events carry a `student-hub:<id>` line, so nothing is added twice and changed deadlines are updated.
  - With *Αυτόματα μετά από κάθε ενημέρωση* on, every new briefing also adds its new deadlines, to-dos and dates to Google Calendar.
- **Μελέτη (exam study mode)**: flashcards for each course, written by your selected AI.
  - **Making a deck:** *＋ Νέα τράπουλα* lets you choose a course and the sources:
    - the course's lectures with an AI instructor summary or subtitles, from every academic year;
    - files from all the folders of its eClass *Έγγραφα* (PDF, Word, PowerPoint, text; read on this computer);
    - notes you paste in.
    Each source has a ↗ to open it in a new tab first.
  - **The cards:** Greek question-and-answer cards for the exam: definitions, concepts, formulas, algorithm steps, code, and small problems with worked answers.
  - **Where they came from:** each deck lists the lectures, files and notes its cards were made from, with how many cards each gave, plus any file that couldn't be read and why (for example a scanned PDF). Each card shows its own source too: the lecture at the minute it's taught, or the document.
  - *＋ Κάρτες* adds more cards without repeating existing ones, and a wrong card can be deleted.
  - **Studying:** see the question, flip the card (Space) to see the answer, then *Επόμενη* (→) through the deck.
  - **Saved where:** decks are kept in `~/.local/share/student-hub/study/`. Making cards uses your selected AI CLI account, like the AI instructor; studying doesn't.
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

## Choosing an AI CLI

Use **AI** beside the theme/sign-out controls to choose **Claude**, **Gemini**,
**ChatGPT (Codex CLI)**, or **Google Antigravity** for the whole app. The same controls appear in the lecture
AI panel. This choice applies to new daily briefings, lecture summaries, lecture
questions and flashcard generation, for both universities. Existing saved results
stay available; regenerate them to use a different provider. Running jobs keep the
provider they started with. Lecture questions preserve their conversation when
switching providers.

Install your chosen CLI and sign in from a terminal before using it:

| App choice | CLI | Initial sign-in |
| --- | --- | --- |
| Claude | Claude Code (`claude`) | Run `claude` and follow sign-in |
| Gemini | Gemini CLI (`gemini`) | Run `gemini` and follow sign-in |
| ChatGPT | OpenAI Codex CLI (`codex`) | Run `codex login` and choose ChatGPT |
| Google Antigravity | Antigravity CLI (`agy`) | Install the native CLI for your OS/CPU, run `agy`, and complete sign-in |

Antigravity publishes native CLI builds for macOS, Linux and Windows, including
Intel/AMD and ARM variants where listed by Google. Use the [official installer
instructions](https://antigravity.google/docs/cli/install) so it selects the build
for your computer. The app finds `agy` on `PATH`, in the official `~/.local/bin`
location on macOS/Linux, or in the official `%LOCALAPPDATA%\\agy\\bin` location
on Windows. If Student Hub runs as a background service with a different `PATH`,
set `STUDENT_HUB_AGY` to the full executable path. An incompatible executable is
reported as a CPU/build error rather than a generic AI failure.

The app uses these CLIs, not an API integration. Your CLI account must have access
to the requested model; CLI installation alone does not verify login or account
access. Choose a preset from **Model** (ChatGPT: GPT-6.1 Sol, GPT-6.1 Terra,
GPT-6 Astra, GPT-6 Luna, GPT-6 Sol; Gemini: Gemini 3 Pro/Flash Preview,
Gemini 2.5 Pro/Flash; Antigravity: Gemini 4 Argon High/Medium, Gemini 3.8 Flash
High/Medium, Gemini 3.1 Pro High), keep the CLI default, or choose **Other model** and enter
an exact model ID your CLI supports. Availability depends on your account and CLI
version; GPT-6.1 Terra requires Codex CLI 0.159.0 or newer. Model and thinking preferences are saved separately per provider.
Gemini uses its model's default thinking behavior; Claude and Codex expose thinking
levels. Antigravity exposes the CLI's low, medium, and high effort choices. A model
can reject a level it does not support.

Text and lecture images are sent to the selected provider under your CLI account.
Codex runs with a private temporary working directory, a read-only sandbox,
ephemeral sessions, shell tools and user-config integrations disabled. In the **AI
assistant panel**, **GPT-6 Luna** also gets public web search and the assistant's
app-controlled, read-only student-data retrieval. Web search is used only for
general public facts, never private student data. No shell or arbitrary local-file
access is enabled. Gemini runs
headlessly with built-in tools, extensions and MCP integrations disabled; lecture
images are attached using explicit file references. Antigravity runs in its CLI
sandbox, receives only the supplied context and explicit image paths, and can
return schema-constrained JSON for app features that require structured results.
Gemini/Codex/Antigravity answers appear
when each CLI request finishes. Claude retains its incremental text streaming.
Temporary image/schema files are removed after the request. Existing saved app
results continue to use the locations described above.

**Integration limits:** speech recognition still uses local Whisper or the optional
Groq transcription service. Automatic Google Calendar sync requires Claude's
Google Calendar connector; with another provider selected, use **Download .ics**
and import it into your calendar. The app never silently switches back to Claude.

CLI interface references: [Codex noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode),
[Gemini headless mode](https://geminicli.com/docs/cli/headless/),
[Antigravity headless mode](https://antigravity.google/docs/cli/headless/),
[Antigravity installation and sign-in](https://antigravity.google/docs/cli/install), and
[Antigravity CLI permissions](https://antigravity.google/docs/cli-permissions).

## AI assistant side panel

**✦ Βοηθός AI** in the top toolbar opens a right panel beside the current view
(on smaller screens it slides over the page). Ask for an update on your obligations,
find study material, or ask about a document. It uses the configured Claude/Gemini/ChatGPT/Antigravity CLI
selected in the existing AI settings. Nothing is sent just by opening the panel;
sending a question lets that provider retrieve relevant connected student data.

The assistant can retrieve mail and attachments without marking messages read,
department/eClass announcements, assignments, course information, grades, timetable,
calendar events, tracked project metadata, flashcards, Piazza feeds/posts and saved
lecture summaries/subtitles. It reads data through Student Hub; it cannot send mail,
change remote records, run arbitrary commands or browse arbitrary local folders,
except in a project you give it access to (below). DitLab must first be connected in its existing tab.

**Project access** (Projects tab only): pick a project and switch on what the AI may do there: **Ανάγνωση** (list/read files), **Εγγραφή** (create/edit files, and copy course material into the project: DitLab files such as past exams, eClass documents and mail attachments are saved unchanged, by default in `course-material/`, of any type, never over an existing file), **Διαγραφή** (delete files) and **Εντολές** (run commands in the project folder, 5-minute limit, with your permissions). Everything is off until you press it, applies only to that project's folder (never outside it or in `.git`) and only to the file types you allow (*Τύποι αρχείων & ορίσματα*; `*` = all text files). Every overwritten or deleted file is backed up first, under the app's data folder in `assistant-backups/`, and the answer ends with the list of changes and commands, written by the app. *Επιπλέον ορίσματα* are extra arguments for the AI CLI in project mode (e.g. `--model sonnet`); arguments the app sets itself are refused. Emails and documents the AI reads could try to trick it, so switch on only what the task needs.

For **eClass and DitLab documents**, it can list folders and search filenames through
all nested levels, then read text from matching PDF, Office, text and code documents.
Traversal uses a queue with cycle detection and continuation cursors, with no depth
cutoff. The existing eClass study-source browser also no longer stops silently at
80 folders. A search request processes at most 60 folders / 60 matches at a time;
the assistant can continue with the returned cursor. Filename search does not search
inside every file automatically. Document text is read in 22,000-character chunks;
files over 25 MB, scanned PDFs without text and unsupported formats are reported as
unread rather than treated as checked. PDF/Office text uses the existing optional
Poppler/LibreOffice tools.

Answers include source buttons for documents and app views, plus an activity list.
A question allows up to ten retrieval rounds; incomplete searches and errors must
be disclosed. **Stop** cancels the current request; **New conversation** clears its
history, file references and cached document text. Assistant history stays in the
current session's memory and is cleared on sign-out/expiry. The selected provider
receives the question, recent conversation and retrieved material through its CLI.
