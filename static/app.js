"use strict";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

// Build DOM nodes. All text goes through textContent, so remote data can never inject markup.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function icon(d) {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", d);
  s.append(p);
  return s;
}
const ICONS = {
  inbox: "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 12h-4a3 3 0 0 1-6 0H5V5h14v10z",
  unread: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  sent: "M2.01 21 23 12 2.01 3 2 10l15 2-15 2z",
  megaphone: "M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.61zM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.53.8 1.07 1.2 1.6.96-.72 2.21-1.65 3.2-2.4zM4 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1v4h2v-4h1l5 3V6L8 9H4zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  reply: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  back: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  open: "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  folder: "M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z",
  key: "M12.65 10A6 6 0 1 0 12.65 14H17v4h4v-4h2v-4H12.65zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z",
};

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 2600);
}

function nameOf(addr) {
  if (!addr) return "";
  const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return m[1].trim() || m[2];
  return addr.split(",")[0].trim();
}
function initials(s) {
  const parts = (s || "?").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function hue(s) {
  let x = 0;
  for (const c of s || "") x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return x % 360;
}
function avatar(name) {
  const a = h("div", { class: "avatar", "aria-hidden": "true" }, initials(name));
  const hh = hue(name);
  a.style.background = `linear-gradient(145deg, hsl(${hh} 70% 62%), hsl(${(hh + 30) % 360} 65% 46%))`;
  return a;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });
function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days <= 0) return timeFmt.format(d);
  if (days === 1) return "Yesterday";
  if (days < 7) return dayFmt.format(d);
  return dateFmt.format(d);
}

// ---------- API ----------
const state = {
  csrf: "",
  view: { type: "mail", folder: "inbox", unread: false },
  folders: ["inbox"],
  messages: [], total: 0, page: 0, selected: null, current: null,
  feeds: [], announcements: [],
  feedItems: [], feedErrors: [],
  grades: { status: "idle", data: null, error: "", semester: 0, showAll: true },
  studies: { tab: "", pages: {}, tabs: [], error: "" },
  ditlab: { status: "idle", username: "", reason: "", path: "/", items: [], results: null, emails: null, pick: null },
  eclass: { enabled: false, status: "idle", error: "", courses: [], items: [], errors: [] },
  query: "",
};

async function api(path, { method = "GET", body } = {}) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (method !== "GET") opts.headers["X-CSRF-Token"] = state.csrf;
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error("Can't reach Student Hub. Is the server still running?");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") {
    showLogin("Your session ended. Please sign in again.");
    throw new Error("Not signed in");
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

// ---------- sign in ----------
const PROVIDERS = {
  uoa: { imap: "imaps://imap.uoa.gr:993", smtp: "smtps://smtp.uoa.gr:465",
    hint: "ΕΚΠΑ mail servers. Your username is completed with @di.uoa.gr automatically." },
  custom: { imap: "", smtp: "", hint: "Ask your school's IT page for the IMAP and SMTP server names." },
  gmail: { imap: "imaps://imap.gmail.com:993", smtp: "smtps://smtp.gmail.com:465",
    hint: "Gmail needs an App Password (Google Account → Security → 2-Step Verification → App passwords)." },
  outlook: { imap: "imaps://outlook.office365.com:993", smtp: "smtp://smtp.office365.com:587",
    hint: "Many Microsoft 365 school accounts block password sign-in for IMAP. If it fails, ask IT whether IMAP is enabled." },
  icloud: { imap: "imaps://imap.mail.me.com:993", smtp: "smtp://smtp.mail.me.com:587",
    hint: "iCloud needs an app-specific password from appleid.apple.com." },
  yahoo: { imap: "imaps://imap.mail.yahoo.com:993", smtp: "smtps://smtp.mail.yahoo.com:465",
    hint: "Yahoo needs an app password from Account Security." },
};

const DIT_DOMAIN = "di.uoa.gr";
const UNIS = {
  uoa: { domain: "di.uoa.gr", placeholder: "sdi2300000",
    subtitle: "Τμήμα Πληροφορικής & Τηλεπικοινωνιών · ΕΚΠΑ",
    lead: "Sign in with your DIT account, the same one as webmail. Your password stays in memory on this computer only." },
  unipi: { domain: "unipi.gr", placeholder: "username",
    subtitle: "Τμήμα Ναυτιλιακών Σπουδών · Πανεπιστήμιο Πειραιώς",
    lead: "Sign in with your UNIPI account, the same one as eClass and sis-portal. Your university email is on Microsoft 365, so it opens in Outlook. Your password stays in memory on this computer only." },
};
let loginInst = "uoa";

function selectInst(id) {
  loginInst = UNIS[id] ? id : "uoa";
  for (const b of document.querySelectorAll(".segmented button")) {
    b.setAttribute("aria-checked", String(b.dataset.inst === loginInst));
  }
  const u = UNIS[loginInst];
  $("inst-subtitle").textContent = u.subtitle;
  $("login-lead").textContent = u.lead;
  $("username").placeholder = u.placeholder;
  $("advanced").hidden = loginInst === "unipi";      // UNIPI signs in through sso.unipi.gr, no server settings
  if (loginInst === "uoa" && $("provider").value !== "uoa" && !$("advanced").open) {
    $("provider").value = "uoa"; applyProvider();
  }
  updateSuffix();
}

function applyProvider() {
  const p = PROVIDERS[$("provider").value];
  if (p.imap) { $("imap_url").value = p.imap; $("smtp_url").value = p.smtp; }
  $("provider-hint").textContent = p.hint;
  updateSuffix();
}

// Show "@di.uoa.gr" after the username unless the user typed a full address or chose another provider.
function updateSuffix() {
  $("user-suffix").textContent = "@" + UNIS[loginInst].domain;
  $("user-suffix").hidden = (loginInst === "uoa" && $("provider").value !== "uoa") || $("username").value.includes("@");
}

// "sdi2300000" -> "sdi2300000@di.uoa.gr"; full addresses are kept as typed.
function emailFromUsername(user) {
  if (user.includes("@")) return user;
  if (loginInst === "unipi") return `${user}@unipi.gr`;
  return $("provider").value === "uoa" ? `${user}@${DIT_DOMAIN}` : "";
}

function guessProvider(email) {
  const d = (email.split("@")[1] || "").toLowerCase();
  if (/^(gmail|googlemail)\.com$/.test(d)) return "gmail";
  if (/^(outlook|hotmail|live|msn)\.com$/.test(d)) return "outlook";
  if (/^(icloud|me|mac)\.com$/.test(d)) return "icloud";
  if (/^yahoo\./.test(d)) return "yahoo";
  if (/(^|\.)uoa\.gr$/.test(d)) return "uoa";
  return null;
}

const EYE = "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z";
const EYE_OFF = "M12 7a5 5 0 0 1 5 5c0 .65-.13 1.26-.36 1.83l2.92 2.92A11.8 11.8 0 0 0 23 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16A4.9 4.9 0 0 1 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55A2.8 2.8 0 0 0 9 12a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08l1.55 1.55A4.97 4.97 0 0 1 7 12c0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16a3 3 0 0 0-3-3l-.17.01z";

function setPasswordVisible(show) {
  $("password").type = show ? "text" : "password";
  const btn = $("pw-toggle"), label = show ? "Hide password" : "Show password";
  btn.setAttribute("aria-pressed", String(show));
  btn.setAttribute("aria-label", label);
  btn.title = label;
  $("pw-eye").setAttribute("d", show ? EYE_OFF : EYE);
}

function showLogin(msg) {
  setPasswordVisible(false);
  $("app").hidden = true;
  $("compose").hidden = true;
  $("login").hidden = false;
  $("login-error").textContent = msg || "";
  $("password").value = "";
  ($("username").value ? $("password") : $("username")).focus();
}

async function onLogin(e) {
  e.preventDefault();
  const username = $("username").value.trim();
  const email = $("email").value.trim() || emailFromUsername(username);
  const sso = loginInst === "unipi";
  const body = {
    email, username,
    password: $("password").value,
    institution: sso ? "unipi" : $("provider").value === "uoa" ? "uoa" : "",
    imap_url: sso ? "" : $("imap_url").value.trim(),
    smtp_url: sso ? "" : $("smtp_url").value.trim(),
  };
  if (!username || !body.password) return ($("login-error").textContent = "Enter your username and password.");
  if (!email) {
    $("advanced").open = true;
    return ($("login-error").textContent = "Enter your email address.");
  }
  if (!sso && (!body.imap_url || !body.smtp_url)) {
    $("advanced").open = true;
    return ($("login-error").textContent = "Enter your school's server URLs.");
  }
  const btn = $("login-btn");
  btn.disabled = true; btn.textContent = "Signing in…";
  $("login-error").textContent = "";
  try {
    const r = await api("/api/login", { method: "POST", body });
    state.csrf = r.csrf;
    $("password").value = "";
    setPasswordVisible(false);
    await startApp(true);
  } catch (err) {
    $("login-error").textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = "Sign In";
  }
}

async function logout() {
  try { await api("/api/logout", { method: "POST", body: {} }); } catch {}
  state.csrf = "";
  state.messages = []; state.current = null;
  Object.assign(state.grades, { status: "idle", data: null, error: "", semester: 0 });
  Object.assign(state.studies, { tab: "", pages: {}, tabs: [], error: "" });
  Object.assign(state.ditlab, { status: "idle", emails: null, pick: null, items: [], path: "/", results: null });
  for (const link of document.querySelectorAll("a[data-sso]")) if (link.dataset.home) link.href = link.dataset.home;
  $("msg-list").replaceChildren();
  showLogin();
}

// ---------- app shell ----------
async function startApp(afterLogin = false) {
  const s = await api("/api/session");
  if (!s.signedIn) {
    return showLogin(afterLogin ? "Signed in, but your browser didn't keep the session. "
      + "Allow cookies for 127.0.0.1 and reload the page." : "");
  }
  state.csrf = s.csrf;
  state.folders = s.folders;
  state.mail = s.mail;
  state.inst = s.institution || {};
  document.title = state.inst.name ? `Student Hub · ${state.inst.name.split(" · ")[0]}` : "Student Hub";
  $("compose-btn").hidden = !s.mail;
  renderLinks();
  renderStudiesNav();
  $("me-name").textContent = s.user.split("@")[0];
  $("me-email").textContent = s.email;
  $("me-avatar").replaceWith(Object.assign(avatar(s.email), { id: "me-avatar" }));
  $("login").hidden = true;
  $("app").hidden = false;
  renderMailNav();
  await loadFeeds();
  navigate(s.mail ? { type: "mail", folder: "inbox", unread: false } : { type: "ann" });
  if (s.mail) refreshUnreadCount();
  loadAnnouncements();
  loadEclass();
  loadDitlabStatus();
}

function navItem({ label, iconPath, color, active, count, onclick, onremove }) {
  const btn = h("button", { class: "item" + (active ? " active" : ""), onclick, "aria-current": active ? "page" : null },
    iconPath ? icon(iconPath) : h("span", { class: "dot" }),
    h("span", { class: "label" }, label),
    count ? h("span", { class: "count" }, count) : null);
  if (color) btn.querySelector(".dot").style.background = color;
  const li = h("li", {}, btn);
  if (onremove) {
    const rm = h("button", { class: "icon-btn remove", title: `Remove ${label}`, "aria-label": `Remove ${label}`, onclick: onremove }, icon(ICONS.close));
    li.append(rm);
  }
  return li;
}

function isView(v) {
  const c = state.view;
  return c.type === v.type && c.folder === v.folder && !!c.unread === !!v.unread
    && (c.feed || "") === (v.feed || "") && (c.cat || "") === (v.cat || "");
}

// University links; eClass / My-Uni ones sign in through the university SSO with this session.
function renderLinks() {
  const links = state.inst.links || [];
  $("links-head").hidden = !links.length;
  $("nav-links").replaceChildren(...links.map((l) => h("li", {}, h("a", {
    class: "item", target: "_blank", rel: l.sso ? "noopener" : "noopener noreferrer",
    href: l.sso ? `/api/sso?to=${encodeURIComponent(l.sso)}&t=${encodeURIComponent(state.csrf)}` : l.href,
    title: l.sso ? "Opens already signed in" : l.href }, l.label))));
}

function renderMailNav() {
  if (state.mail === false) {                    // e.g. UNIPI: Microsoft 365 mail opens in Outlook
    $("nav-mail").replaceChildren(
      h("li", {}, h("a", { class: "item", href: state.inst.webmail || "https://outlook.office.com/mail/",
        target: "_blank", rel: "noopener noreferrer" }, icon(ICONS.inbox), h("span", { class: "label" }, "Open Outlook"))),
      h("li", { class: "empty-hint" }, "University email is on Microsoft 365, which doesn't let apps sign in with a password."));
    return;
  }
  const items = [
    { label: "Inbox", iconPath: ICONS.inbox, view: { type: "mail", folder: "inbox", unread: false }, count: state.unreadCount },
    { label: "Unread", iconPath: ICONS.unread, view: { type: "mail", folder: "inbox", unread: true } },
  ];
  if (state.folders.includes("sent")) items.push({ label: "Sent", iconPath: ICONS.sent, view: { type: "mail", folder: "sent", unread: false } });
  $("nav-mail").replaceChildren(...items.map((it) =>
    navItem({ ...it, active: isView(it.view), onclick: () => navigate(it.view) })));
}

function feedColor(id) { return `hsl(${hue(id)} 70% 55%)`; }

function renderFeedNav() {
  const all = { type: "ann" };
  $("nav-feeds").replaceChildren(navItem({ label: "All Announcements", iconPath: ICONS.megaphone,
    active: isView(all), count: state.announcements.length || "", onclick: () => navigate(all) }));

  const counts = new Map();
  for (const a of state.announcements) if (a.category) counts.set(a.category, (counts.get(a.category) || 0) + 1);
  const topics = [...counts].sort((a, b) => b[1] - a[1]);
  $("topics-head").hidden = topics.length < 2;
  $("nav-topics").replaceChildren(...(topics.length < 2 ? [] : topics.map(([cat, n]) => {
    const v = { type: "ann", cat };
    return navItem({ label: cat, color: feedColor(cat), active: isView(v), count: n, onclick: () => navigate(v) });
  })));

  const sources = state.feeds.map((f) => {
    const v = { type: "ann", feed: f.id };
    return navItem({ label: f.name, color: feedColor(f.id), active: isView(v), onclick: () => navigate(v),
      onremove: () => removeFeed(f) });
  });
  if (!state.feeds.length) sources.push(h("li", { class: "empty-hint" }, "Add eClass or department news with +"));
  $("nav-sources").replaceChildren(...sources);
  renderEclassNav();
}

function navigate(view) {
  state.view = view;
  state.query = $("search").value = "";
  $("app").classList.remove("nav-open");
  renderMailNav();
  renderFeedNav();
  const isMail = view.type === "mail";
  $("mail-view").hidden = !isMail;
  $("ann-view").hidden = view.type !== "ann";
  $("ditlab-view").hidden = view.type !== "ditlab";
  $("grades-view").hidden = view.type !== "grades";
  $("studies-view").hidden = view.type !== "studies";
  renderDitlabNav();
  renderStudiesNav();
  if (view.type === "studies") {
    $("view-title").textContent = "Προπτυχιακές Σπουδές";
    loadStudies(state.studies.tab);
  } else if (view.type === "grades") {
    $("view-title").textContent = "Βαθμολογίες";
    state.grades.data ? renderGrades() : loadGrades();
  } else if (view.type === "ditlab") {
    $("view-title").textContent = "DitLab";
    openDitlab();
  } else if (isMail) {
    $("view-title").textContent = view.unread ? "Unread" : view.folder === "sent" ? "Sent" : "Inbox";
    state.page = 0; state.messages = []; state.selected = null;
    closeReader();
    loadMail();
  } else {
    const f = state.feeds.find((x) => x.id === view.feed);
    const course = state.eclass.courses.find((c) => "ec:" + c.code === view.feed);
    $("view-title").textContent = f ? f.name : course ? course.title
      : view.feed === "eclass" ? "eClass" : view.cat || "Announcements";
    if (state.annLoaded) renderAnnouncements(); else loadAnnouncements();
  }
}

// ---------- mail ----------
let mailReq = 0;
async function loadMail({ refresh = false, append = false } = {}) {
  const id = ++mailReq;
  const v = state.view;
  if (!append) {
    $("msg-list").replaceChildren(...Array.from({ length: 6 }, () => h("li", { class: "skeleton" })));
    $("view-sub").textContent = "Loading…";
  }
  try {
    const q = new URLSearchParams({ folder: v.folder, unread: v.unread ? "1" : "0", page: String(state.page) });
    if (refresh) q.set("refresh", "1");
    const search = $("search").value.trim();
    if (search) q.set("q", search);                 // searched on the mail server, whole mailbox
    const r = await api("/api/mail?" + q);
    if (id !== mailReq) return;                     // a newer request superseded this one
    state.messages = append ? state.messages.concat(r.messages) : r.messages;
    state.total = r.total;
    renderMessages();
    $("more-btn").hidden = state.messages.length >= r.total;
  } catch (err) {
    if (id !== mailReq) return;
    $("msg-list").replaceChildren(h("li", { class: "state" }, err.message));
    $("view-sub").textContent = "";
  }
}

async function refreshUnreadCount() {
  try {
    const r = await api("/api/mail?folder=inbox&unread=1&page=0");
    state.unreadCount = r.total || "";
    renderMailNav();
  } catch {}
}

function matches(text) {
  return !state.query || text.toLowerCase().includes(state.query);
}

function renderMessages() {
  const list = state.messages;                     // already filtered by the server when searching
  const sent = state.view.folder === "sent";
  const frag = document.createDocumentFragment();
  for (const m of list) {
    const who = sent ? "To: " + nameOf(m.to) : nameOf(m.from);
    frag.append(h("li", {
      class: "msg" + (m.unread ? " unread" : "") + (m.uid === state.selected ? " active" : ""),
      role: "option", tabindex: "0", "aria-selected": m.uid === state.selected ? "true" : "false",
      "data-uid": m.uid,
      onclick: () => openMessage(m),
      onkeydown: (e) => { if (e.key === "Enter") openMessage(m); },
    },
    h("span", { class: "unread-dot" }),
    h("span", { class: "from" }, who || "(unknown)"),
    h("span", { class: "date" }, shortDate(m.date)),
    h("span", { class: "subject" }, m.subject)));
  }
  if (!list.length) frag.append(h("li", { class: "state" }, state.query ? "No matches" : "No messages"));
  $("msg-list").replaceChildren(frag);
  const unread = state.messages.filter((m) => m.unread).length;
  $("view-sub").textContent = state.query
    ? `${state.total} result${state.total === 1 ? "" : "s"} for “${$("search").value.trim()}”`
    : `${state.total} message${state.total === 1 ? "" : "s"}` + (unread && !state.view.unread ? ` · ${unread} unread shown` : "");
}

function closeReader() {
  $("mail-view").classList.remove("reading");
  $("reader").replaceChildren(h("div", { class: "empty" }, icon(ICONS.inbox), h("p", {}, "No message selected")));
}

let readReq = 0;
async function openMessage(m) {
  const id = ++readReq;
  state.selected = m.uid;
  for (const li of $("msg-list").children) {
    const on = li.dataset.uid === String(m.uid);
    li.classList.toggle("active", on);
    li.setAttribute("aria-selected", on ? "true" : "false");
  }
  $("mail-view").classList.add("reading");
  $("reader").replaceChildren(h("div", { class: "empty" }, h("div", { class: "spinner" }), "Loading message…"));
  try {
    const folder = state.view.folder;
    const msg = await api(`/api/message?folder=${folder}&uid=${m.uid}`);
    if (id !== readReq) return;
    state.current = { ...msg, folder };
    if (m.unread) {
      m.unread = false;
      document.querySelector(`.msg[data-uid="${m.uid}"]`)?.classList.remove("unread");
      if (state.unreadCount) { state.unreadCount -= 1; renderMailNav(); }
    }
    renderReader(false);
  } catch (err) {
    if (id === readReq) $("reader").replaceChildren(h("div", { class: "empty" }, err.message));
  }
}

function renderReader(forcePlain) {
  const msg = state.current;
  const fromName = nameOf(msg.from);
  const head = h("header", { class: "reader-head" },
    h("button", { class: "btn plain back-btn", onclick: closeReader }, icon(ICONS.back), "Back"),
    h("h2", {}, msg.subject),
    h("div", { class: "who" },
      avatar(fromName),
      h("div", { class: "who-text" },
        h("strong", {}, fromName),
        h("div", { class: "muted", title: msg.from }, msg.from),
        h("div", { class: "muted" }, "To: " + msg.to + (msg.cc ? "  ·  Cc: " + msg.cc : "")),
        h("div", { class: "muted" }, msg.date ? fullFmt.format(new Date(msg.date)) : "")),
      h("div", { class: "reader-actions" },
        h("button", { class: "icon-btn", title: "Reply", "aria-label": "Reply", onclick: () => reply(false) }, icon(ICONS.reply)),
        h("button", { class: "btn plain", onclick: () => reply(true) }, "Reply All"))),
    msg.attachments.length ? h("div", { class: "attach" },
      msg.attachments.map((a) => h("span", { class: "chip" }, `📎 ${a.name} · ${Math.max(1, Math.round(a.size / 1024))} KB`))) : null);

  const parts = [head];
  if (msg.hasHtml && !forcePlain) {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches ? "1" : "0";
    parts.push(
      h("div", { class: "notice" }, "Remote images and scripts are blocked to protect your privacy.",
        h("button", { class: "btn plain", onclick: () => renderReader(true) }, "Plain text")),
      // sandbox without allow-scripts / allow-same-origin: the email can't run code or read the app
      h("iframe", {
        class: "reader-frame", title: "Message body", referrerpolicy: "no-referrer",
        sandbox: "allow-popups allow-popups-to-escape-sandbox",
        src: `/api/message/html?folder=${msg.folder}&uid=${msg.uid}&dark=${dark}`,
      }));
  } else {
    if (msg.hasHtml) parts.push(h("div", { class: "notice" }, "Showing plain text.",
      h("button", { class: "btn plain", onclick: () => renderReader(false) }, "Formatted")));
    parts.push(h("div", { class: "reader-body" }, msg.text || "(empty message)"));
  }
  $("reader").replaceChildren(...parts);
  $("reader").scrollTop = 0;
}

// ---------- compose ----------
function openCompose({ to = "", cc = "", subject = "", body = "", inReplyTo = "" } = {}) {
  $("c-to").value = to; $("c-cc").value = cc; $("c-subject").value = subject; $("c-body").value = body;
  $("compose-form").dataset.inReplyTo = inReplyTo;
  $("compose-error").textContent = "";
  $("compose").querySelector("h2").textContent = subject ? subject : "New Message";
  $("compose").hidden = false;
  (to ? $("c-body") : $("c-to")).focus();
  if (to) $("c-body").setSelectionRange(0, 0);
}

function closeCompose() {
  const dirty = $("c-body").value.trim() && !$("compose-form").dataset.sent;
  if (dirty && !confirm("Discard this message?")) return;
  $("compose").hidden = true;
  delete $("compose-form").dataset.sent;
}

function reply(all) {
  const m = state.current;
  const me = $("me-email").textContent.toLowerCase();
  const to = m.reply_to || m.from;
  const cc = all ? [m.to, m.cc].filter(Boolean).join(", ").split(",")
    .map((s) => s.trim()).filter((s) => s && !s.toLowerCase().includes(me)).join(", ") : "";
  const quoted = (m.text || "").split("\n").map((l) => "> " + l).join("\n");
  const when = m.date ? fullFmt.format(new Date(m.date)) : "";
  openCompose({
    to, cc,
    subject: /^re:/i.test(m.subject) ? m.subject : "Re: " + m.subject,
    body: `\n\nOn ${when}, ${nameOf(m.from)} wrote:\n${quoted}`,
    inReplyTo: m.message_id,
  });
}

async function onSend(e) {
  e.preventDefault();
  const to = $("c-to").value.trim();
  if (!to) return ($("compose-error").textContent = "Add at least one recipient.");
  if (!$("c-subject").value.trim() && !confirm("Send without a subject?")) return;
  const btn = $("send-btn");
  btn.disabled = true; btn.textContent = "Sending…";
  try {
    await api("/api/send", { method: "POST", body: {
      to, cc: $("c-cc").value.trim(), subject: $("c-subject").value, body: $("c-body").value,
      inReplyTo: $("compose-form").dataset.inReplyTo || "",
    } });
    $("compose-form").dataset.sent = "1";
    closeCompose();
    toast("Message sent");
    if (state.view.folder === "sent") loadMail({ refresh: true });
  } catch (err) {
    $("compose-error").textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = "Send";
  }
}

// ---------- announcements ----------
async function loadFeeds() {
  try {
    state.feeds = (await api("/api/feeds")).feeds;
  } catch { state.feeds = []; }
  renderFeedNav();
}

let annReq = 0;
async function loadAnnouncements(refresh = false) {
  const id = ++annReq;
  if (!state.feeds.length) {
    state.feedItems = []; state.feedErrors = []; state.annLoaded = true;
    mergeAnnouncements();
    return;
  }
  const visible = state.view.type === "ann";
  if (visible) {
    $("view-sub").textContent = "Loading…";
    $("ann-list").replaceChildren(...Array.from({ length: 4 }, () => h("div", { class: "skeleton" })));
  }
  try {
    const r = await api("/api/announcements" + (refresh ? "?refresh=1" : ""));
    if (id !== annReq) return;
    state.feedItems = r.items;
    state.feedErrors = r.errors;
    state.annLoaded = true;
    mergeAnnouncements();
  } catch (err) {
    if (id === annReq && state.view.type === "ann") $("ann-list").replaceChildren(h("div", { class: "state" }, err.message));
  }
}

// Link that opens an eClass page already signed in (via sso.uoa.gr), e.g. "/courses/DI123/".
function eclassLink(path) {
  return `/api/sso?to=eclass&t=${encodeURIComponent(state.csrf)}&next=${encodeURIComponent(path)}`;
}
function eclassPath(url) {
  try { const u = new URL(url); return u.hostname === state.inst.eclassHost ? u.pathname + u.search : null; }
  catch { return null; }
}

// Department feeds + eClass course announcements, newest first.
function mergeAnnouncements() {
  state.announcements = state.feedItems.concat(state.eclass.items)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  renderFeedNav();
  if (state.view.type === "ann") renderAnnouncements();
}

async function loadEclass(refresh = false) {
  const ec = state.eclass;
  if (ec.status === "loading") return;
  ec.status = "loading"; ec.error = "";
  renderEclassNav();
  try {
    const r = await api("/api/eclass" + (refresh ? "?refresh=1" : ""));
    Object.assign(ec, { enabled: r.enabled, courses: r.courses, items: r.items, errors: r.errors, status: "ready" });
  } catch (err) {
    Object.assign(ec, { enabled: true, status: "error", error: err.message });
  }
  mergeAnnouncements();
}

function renderEclassNav() {
  const ec = state.eclass;
  $("eclass-section").hidden = !ec.enabled && ec.status !== "loading";
  const items = [];
  if (ec.status === "loading" && !ec.courses.length) {
    items.push(h("li", { class: "empty-hint" }, "Signing in to eClass…"));
  } else if (ec.status === "error") {
    items.push(h("li", { class: "empty-hint" }, ec.error + " ",
      h("button", { class: "btn plain more", onclick: () => loadEclass(true) }, "Retry")));
  }
  if (ec.courses.length) {
    const totalNotifs = ec.courses.reduce((n, c) => n + (c.notifCount || 0), 0);
    const all = navItem({ label: "All Courses", iconPath: ICONS.inbox, active: isView({ type: "ann", feed: "eclass" }),
      count: totalNotifs || "", onclick: () => navigate({ type: "ann", feed: "eclass" }) });
    all.querySelector(".count")?.classList.add("badge");
    items.push(all);
    for (const c of ec.courses) {
      const v = { type: "ann", feed: "ec:" + c.code };
      const item = navItem({ label: c.title, color: feedColor(c.code), active: isView(v),
        count: c.notifCount || "", onclick: () => navigate(v) });
      item.querySelector(".count")?.classList.add("badge");
      item.querySelector(".item").title = [c.title, c.teacher,
        c.notifCount ? `${c.notifCount} new in eClass` : "", `${c.count || 0} announcements`].filter(Boolean).join(" · ");
      item.append(h("a", { class: "icon-btn remove", href: eclassLink(`/courses/${c.code}/`), target: "_blank",
        rel: "noopener", title: `Open ${c.title} in eClass`, "aria-label": `Open ${c.title} in eClass` }, icon(ICONS.open)));
      items.push(item);
    }
  } else if (ec.status === "ready") {
    items.push(h("li", { class: "empty-hint" }, "No active courses found on eClass."));
  }
  $("nav-eclass").replaceChildren(...items);
}

function renderCourseHead() {
  const feed = state.view.feed || "";
  const c = feed.startsWith("ec:") && state.eclass.courses.find((x) => "ec:" + x.code === feed);
  if (!c) return $("ann-head").replaceChildren();
  const notifs = c.notifications || [];
  $("ann-head").replaceChildren(h("section", { class: "card course-head" },
    h("div", { class: "row" },
      h("div", {}, h("h2", {}, c.title), c.teacher ? h("div", { class: "muted" }, c.teacher) : null),
      h("a", { class: "btn primary open-btn", href: eclassLink(`/courses/${c.code}/`), target: "_blank", rel: "noopener" },
        "Open in eClass", icon(ICONS.open))),
    notifs.length
      ? h("div", { class: "notif-chips" }, notifs.map((n) =>
        h("a", { class: "notif-chip", href: eclassLink(n.path), target: "_blank", rel: "noopener", title: `Open ${n.label}` },
          n.label, h("b", {}, n.count))))
      : h("div", { class: "muted notif-chips" }, "No new items since your last visit.")));
}

function renderAnnouncements() {
  const { feed, cat } = state.view;
  renderCourseHead();
  const errors = state.feedErrors.concat(state.eclass.errors);
  $("ann-errors").replaceChildren(...errors.map((e) => h("div", { class: "banner" }, `${e.feed}: ${e.error}`)));
  const inView = (a) => !feed || (feed === "eclass" ? a.eclass : a.sourceId === feed);
  if (!state.feeds.length && !state.eclass.enabled && !feed) {
    $("view-sub").textContent = "";
    $("ann-list").replaceChildren(h("div", { class: "state" }, icon(ICONS.megaphone),
      h("p", {}, "No announcement sources yet."),
      h("button", { class: "btn primary", onclick: openFeedDialog }, "Add a Source")));
    return;
  }
  const items = state.announcements.filter((a) => inView(a) && (!cat || a.category === cat)
    && matches(`${a.title} ${a.summary} ${a.source} ${a.category}`));
  const frag = document.createDocumentFragment();
  for (const a of items) {
    const p = h("p", {}, a.summary);
    const card = h("article", { class: "card" },
      h("div", { class: "meta" },
        h("span", { class: "dot-sm" }),
        h("span", { class: "source" }, a.source),
        a.category ? h("span", { class: "tag" }, a.category) : null,
        a.date ? h("span", {}, "· " + shortDate(a.date)) : null,
        a.author ? h("span", {}, "· " + a.author) : null),
      h("h3", {}, a.link
        ? h("a", { href: a.eclass && eclassPath(a.link) ? eclassLink(eclassPath(a.link)) : a.link,
          target: "_blank", rel: a.eclass ? "noopener" : "noopener noreferrer" }, a.title)
        : a.title),
      a.summary ? p : null);
    const dot = card.querySelector(".dot-sm");
    Object.assign(dot.style, { width: "8px", height: "8px", borderRadius: "50%", background: feedColor(a.sourceId) });
    if (a.summary.length > 320) {
      card.append(h("button", { class: "btn plain more", onclick: (e) => {
        card.classList.toggle("expanded");
        e.target.textContent = card.classList.contains("expanded") ? "Show less" : "Show more";
      } }, "Show more"));
    }
    frag.append(card);
  }
  if (!items.length) frag.append(h("div", { class: "state" }, state.query ? "No matches" : "Nothing posted yet."));
  $("ann-list").replaceChildren(frag);
  $("view-sub").textContent = `${items.length} announcement${items.length === 1 ? "" : "s"}`;
}

function openFeedDialog() {
  $("f-url").value = ""; $("f-name").value = ""; $("feed-error").textContent = "";
  $("feed-dialog").hidden = false;
  $("f-url").focus();
}

async function onAddFeed(e) {
  e.preventDefault();
  const url = $("f-url").value.trim();
  if (!/^https?:\/\//i.test(url)) return ($("feed-error").textContent = "Enter a full URL starting with https://");
  const btn = $("feed-add");
  btn.disabled = true; btn.textContent = "Checking…";
  try {
    const r = await api("/api/feeds", { method: "POST", body: { url, name: $("f-name").value.trim() } });
    $("feed-dialog").hidden = true;
    state.feeds.push(r.feed);
    toast(`Added ${r.feed.name} · ${r.count} posts`);
    state.annLoaded = false;
    navigate({ type: "ann", feed: r.feed.id });
  } catch (err) {
    $("feed-error").textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = "Add";
  }
}

async function removeFeed(f) {
  if (!confirm(`Remove “${f.name}”?`)) return;
  try {
    await api("/api/feeds?id=" + encodeURIComponent(f.id), { method: "DELETE" });
    state.feeds = state.feeds.filter((x) => x.id !== f.id);
    state.feedItems = state.feedItems.filter((a) => a.sourceId !== f.id);
    mergeAnnouncements();
    if (state.view.type === "ann") navigate({ type: "ann", feed: "" });
    else renderFeedNav();
  } catch (err) { toast(err.message); }
}

// ---------- grades (My-Uni / sis-portal) ----------
function renderStudiesNav() {
  const items = [];
  if (state.inst.ditStudies) {
    items.push(navItem({ label: "Προπτυχιακές Σπουδές", iconPath: ICONS.folder, active: isView({ type: "studies" }),
      onclick: () => navigate({ type: "studies" }) }));
  }
  if (state.inst.grades) {
    items.push(navItem({ label: "Βαθμολογίες", iconPath: ICONS.file, active: isView({ type: "grades" }),
      count: state.grades.data?.stats?.average ?? "", onclick: () => navigate({ type: "grades" }) }));
  }
  $("studies-head").hidden = !items.length;
  $("nav-studies").replaceChildren(...items);
}

function portalLink() {
  const key = state.inst.gradesSso;
  return key ? `/api/sso?to=${encodeURIComponent(key)}&t=${encodeURIComponent(state.csrf)}` : "#";
}

let gradesReq = 0;
async function loadGrades(refresh = false) {
  const g = state.grades, id = ++gradesReq;
  g.status = "loading";
  $("view-sub").textContent = `Signing in to ${state.inst.grades}…`;
  $("grades-body").replaceChildren(h("div", { class: "state" }, h("div", { class: "spinner" }),
    `Reading your grades from ${state.inst.grades}…`));
  try {
    const r = await api("/api/grades" + (refresh ? "?refresh=1" : ""));
    if (id !== gradesReq) return;
    Object.assign(g, { status: "ready", data: r, error: "" });
  } catch (err) {
    if (id !== gradesReq) return;
    Object.assign(g, { status: "error", data: null, error: err.message });
  }
  renderStudiesNav();
  if (state.view.type === "grades") renderGrades();
}

const fmtGrade = (v) => v == null ? "–" : (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "")).replace(".", ",");
const semLabel = (n) => n ? `${n}ο Εξάμηνο` : "Χωρίς εξάμηνο";

async function captureGrades(btn, out) {
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const r = await api("/api/grades/capture", { method: "POST", body: {} });
    out.textContent = `Saved on this computer only, in ${r.folder}. Tell Claude it's ready and it can set up the reader from it.`;
    btn.textContent = "Saved";
  } catch (err) { out.textContent = err.message; btn.disabled = false; btn.textContent = "Save page structure for setup"; }
}

function gradesSetupCard() {
  const g = state.grades, portal = state.inst.grades;
  const out = h("p", { class: "muted" });
  return h("section", { class: "card setup" },
    h("h2", {}, g.error ? "Couldn't load grades" : "Grades not recognized yet"),
    h("p", { class: "lead" }, g.error ||
      `Signed in to ${portal}, but no grades table was found on its pages. The reader needs to be matched to how ${portal} shows grades.`),
    h("div", { class: "actions" },
      h("a", { class: "btn plain", href: portalLink(), target: "_blank", rel: "noopener" }, `Open ${portal} ↗`),
      g.error ? h("button", { class: "btn primary", onclick: () => loadGrades(true) }, "Try again")
        : h("button", { class: "btn primary", onclick: (e) => captureGrades(e.target, out) }, "Save page structure for setup")),
    out);
}

function renderGrades() {
  const g = state.grades, d = g.data;
  if (g.status === "loading") return;
  if (!d || !d.found) {
    $("view-sub").textContent = "";
    return $("grades-body").replaceChildren(gradesSetupCard());
  }
  const q = state.query;
  const sems = d.semesters, hasOther = d.courses.some((c) => !c.semester);
  const sel = g.semester === null && hasOther ? null : sems.includes(g.semester) ? g.semester : 0;   // 0 = all
  const hasProgram = d.courses.some((c) => c.taken === false);
  const shown = d.courses.filter((c) => (sel === 0 || (sel === null ? !c.semester : c.semester === sel))
    && (g.showAll || c.taken !== false)
    && (!q || `${c.title} ${c.code}`.toLowerCase().includes(q)));

  const picker = h("div", { class: "sem-picker", role: "group", "aria-label": "Εξάμηνο" },
    [0, ...sems, ...(hasOther ? [null] : [])].map((n) => h("button", {
      "aria-pressed": String(n === sel),
      onclick: () => { g.semester = n; renderGrades(); } }, n === 0 ? "Όλα" : n === null ? "Άλλα" : `${n}ο`)),
    hasProgram ? h("label", { class: "check toggle-all" },
      h("input", { type: "checkbox", checked: g.showAll ? true : null,
        onchange: (e) => { g.showAll = e.target.checked; renderGrades(); } }),
      "Όλα τα μαθήματα του προγράμματος") : null);

  // stats for the current selection
  // averages use numeric grades of passed courses that count toward the degree
  const passed = shown.filter((c) => c.passed);
  const counted = passed.filter((c) => c.grade != null && c.counts !== false);
  const ects = passed.filter((c) => c.counts !== false).reduce((t, c) => t + (c.ects || 0), 0);
  const avg = counted.length ? counted.reduce((t, c) => t + c.grade, 0) / counted.length : null;
  const weightedOk = counted.length && counted.every((c) => c.ects);
  const wavg = weightedOk ? counted.reduce((t, c) => t + c.grade * c.ects, 0) / counted.reduce((t, c) => t + c.ects, 0) : null;
  const round2 = (v) => fmtGrade(Math.round(v * 100) / 100);
  const stat = (v, k) => h("div", { class: "stat" }, h("div", { class: "v" }, v), h("div", { class: "k" }, k));
  const official = sel === 0 && d.stats.official != null;          // the portal's own average, for all courses
  const stats = h("div", { class: "stat-row" },
    official ? stat(round2(d.stats.official), `Μ.Ο. (${d.portal})`)
      : stat(wavg != null ? round2(wavg) : avg != null ? round2(avg) : "–", wavg != null ? "Μ.Ο. (σταθμ. ECTS)" : "Μέσος όρος"),
    stat(`${passed.length}/${shown.length}`, "Περασμένα μαθήματα"),
    stat(ects ? fmtGrade(ects) : "–", "ECTS"));

  const groups = new Map();
  for (const c of shown) {
    const k = c.semester ?? null;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const cards = [...groups].map(([sem, list]) => {
    const p = list.filter((c) => c.passed);
    const gr = p.filter((c) => c.grade != null && c.counts !== false);
    const semEcts = p.filter((c) => c.counts !== false).reduce((t, c) => t + (c.ects || 0), 0);
    return h("section", { class: "card sem-card" },
      h("h3", {}, semLabel(sem), h("small", {}, `${list.length} μαθήματα · ${p.length} περασμένα`
        + (gr.length ? ` · Μ.Ο. ${round2(gr.reduce((t, c) => t + c.grade, 0) / gr.length)}` : "")
        + (semEcts ? ` · ${fmtGrade(semEcts)} ECTS` : ""))),
      h("table", { class: "grade-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Μάθημα"), h("th", { class: "num hide-sm" }, "ECTS"),
          h("th", { class: "hide-sm" }, "Περίοδος"), h("th", { class: "num" }, "Βαθμός"))),
        h("tbody", {}, list.map((c) => h("tr", { class: c.taken === false ? "dim" : null },
          h("td", {}, c.title, h("span", { class: "sub" }, [c.code, c.type, c.attempts > 1 ? `${c.attempts} προσπάθειες` : "",
            c.passed && c.counts === false ? "δεν μετράει στο πτυχίο" : "",
            c.taken === false ? "δεν έχει εξεταστεί" : ""].filter(Boolean).join(" · "))),
          h("td", { class: "num hide-sm" }, c.ects ? fmtGrade(c.ects) : "–"),
          h("td", { class: "hide-sm muted" }, c.period || ""),
          h("td", { class: "num" }, h("span", { class: "pill " + (c.passed ? "pass" : c.grade == null && !c.gradeText ? "none" : "fail"),
            title: c.gradeText || "" }, c.grade == null ? (c.gradeText && c.gradeText !== "-" ? c.gradeText : "–") : fmtGrade(c.grade))))))));
  });
  const out = h("span", { class: "muted" });
  $("grades-body").replaceChildren(picker, stats, ...(cards.length ? cards : [h("div", { class: "state" }, "No courses match.")]),
    h("p", { class: "muted" }, `From ${d.portal} · `, h("a", { href: portalLink(), target: "_blank", rel: "noopener" }, `Open ${d.portal} ↗`),
      " · Something not right? ", h("button", { class: "btn plain more", onclick: (e) => captureGrades(e.target, out) }, "Save page structure for setup"),
      " ", out));
  $("view-sub").textContent = `${d.stats.courses} μαθήματα · ${d.stats.passed} περασμένα · ${fmtGrade(d.stats.ects)} ECTS`;
}

// ---------- DIT undergraduate studies (di.uoa.gr pages, shown as tabs) ----------
const DIT_STUDIES_URL = "https://www.di.uoa.gr/studies/undergraduate";

let studiesReq = 0;
async function loadStudies(tab, refresh = false) {
  const st = state.studies, id = ++studiesReq;
  st.tab = tab;
  if (st.pages[tab] && !refresh) return renderStudies();
  $("view-sub").textContent = "Loading…";
  if (!st.tabs.length) $("studies-body").replaceChildren(h("div", { class: "state" }, h("div", { class: "spinner" }), "Loading di.uoa.gr…"));
  else renderStudies(true);
  try {
    const r = await api(`/api/dit/studies?tab=${encodeURIComponent(tab)}` + (refresh ? "&refresh=1" : ""));
    if (id !== studiesReq) return;
    st.tabs = r.tabs; st.pages[tab] = r; st.error = "";
  } catch (err) {
    if (id !== studiesReq) return;
    st.error = err.message;
  }
  if (state.view.type === "studies") renderStudies();
}

// a di.uoa.gr link to one of the tabs switches tab instead of leaving the app
function studiesTabFor(href) {
  const m = (href || "").match(/^https:\/\/www\.di\.uoa\.gr\/studies\/undergraduate\/?([\w-]*)\/?(?:[?#].*)?$/);
  return m && state.studies.tabs.some((t) => t.slug === m[1]) ? m[1] : null;
}

function highlight(text, q) {
  if (!q) return [text];
  const out = [], low = text.toLowerCase();
  let i = 0, j;
  while ((j = low.indexOf(q, i)) !== -1) { out.push(text.slice(i, j), h("mark", {}, text.slice(j, j + q.length))); i = j + q.length; }
  out.push(text.slice(i));
  return out;
}

function inlines(list, q) {
  return list.map((x) => {
    const text = x.text.replace(/\s+/g, " ");
    if (!x.href) return highlight(text, q);
    const tab = studiesTabFor(x.href);
    return tab !== null
      ? h("a", { href: x.href, onclick: (e) => { e.preventDefault(); loadStudies(tab); $("studies-view").scrollTop = 0; } }, highlight(text, q))
      : h("a", { href: x.href, target: "_blank", rel: "noopener noreferrer" }, highlight(text, q));
  });
}

const blockText = (b) => b.t === "section" ? b.text : (b.inl || []).map((x) => x.text).join("");

function renderBlocks(blocks, q) {
  const root = h("div", { class: "doc" });
  let target = root, list = null;
  for (const b of blocks) {
    if (b.t === "section") {
      const body = h("div", { class: "acc-body" });
      const det = h("details", { class: "acc", open: q ? true : null }, h("summary", {}, highlight(b.text, q)), body);
      root.append(det); target = body; list = null;
      continue;
    }
    if (b.t === "h" && b.level <= 2) { target = root; }
    if (b.t !== "li") list = null;
    if (b.t === "h") {
      target.append(h(b.level <= 2 ? "h3" : "h4", {}, inlines(b.inl, q)));
    } else if (b.t === "p") {
      if (q && !blockText(b).toLowerCase().includes(q)) continue;
      target.append(h("p", {}, inlines(b.inl, q)));
    } else if (b.t === "li") {
      if (q && !blockText(b).toLowerCase().includes(q)) continue;
      if (!list) { list = h("ul"); target.append(list); }
      list.append(h("li", {}, inlines(b.inl, q)));
    } else if (b.t === "table") {
      const rows = b.rows.filter((r) => r.head || !q || r.cells.some((c) => c.text.toLowerCase().includes(q)));
      if (q && !rows.some((r) => !r.head)) continue;
      const cell = (c, tag) => h(tag, {}, c.links.length === 1 && c.links[0].text.trim() === c.text.trim()
        ? inlines([{ text: c.text, href: c.links[0].href }], q)
        : [highlight(c.text, q), ...c.links.filter((l) => l.text.trim() !== c.text.trim()).map((l) => [" ", ...inlines([l], q)])]);
      target.append(h("div", { class: "table-wrap" }, h("table", {},
        rows.map((r) => h("tr", {}, r.cells.map((c) => cell(c, r.head ? "th" : "td")))))));
    }
  }
  // drop headings / sections left empty by the search filter
  if (q) {
    for (const hd of [...root.querySelectorAll("h3, h4")]) {
      const next = hd.nextElementSibling;
      if (!next || /^H[34]$/.test(next.tagName)) hd.remove();
    }
    for (const det of [...root.querySelectorAll("details.acc")]) if (!det.querySelector(".acc-body > *")) det.remove();
  }
  return root;
}

function renderStudies(loading = false) {
  const st = state.studies, page = st.pages[st.tab], q = state.query;
  const tabbar = h("div", { class: "tabbar", role: "tablist" }, st.tabs.map((t) => h("button", {
    role: "tab", "aria-pressed": String(t.slug === st.tab), onclick: () => loadStudies(t.slug) }, t.title)));
  if (!page) {
    $("studies-body").replaceChildren(tabbar, st.error
      ? h("section", { class: "card setup" }, h("p", {}, st.error), h("button", { class: "btn primary", onclick: () => loadStudies(st.tab, true) }, "Try again"))
      : h("div", { class: "state" }, h("div", { class: "spinner" }), "Loading…"));
    return;
  }
  const url = page.url || DIT_STUDIES_URL;
  $("studies-body").replaceChildren(tabbar, h("section", { class: "card" },
    h("div", { class: "course-head" }, h("div", { class: "row" },
      h("h2", {}, page.title || "Προπτυχιακές Σπουδές"),
      h("a", { class: "btn plain", href: url, target: "_blank", rel: "noopener noreferrer" }, "di.uoa.gr ↗"))),
    page.blocks.length ? renderBlocks(page.blocks, q) : h("p", { class: "muted" }, "This page has no text content."),
    loading ? h("p", { class: "muted" }, "Loading…") : null));
  $("view-sub").textContent = q ? `Search in “${page.title}”` : "Τμήμα Πληροφορικής & Τηλεπικοινωνιών";
}

// ---------- DitLab (files.ditlab.gr) ----------
async function loadDitlabStatus() {
  const d = state.ditlab;
  d.status = "loading";
  renderDitlabNav();
  try {
    const r = await api("/api/ditlab/status");
    $("ditlab-head").hidden = $("nav-ditlab").hidden = r.enabled === false;
    if (r.enabled === false) return;
    Object.assign(d, { status: r.connected ? "connected" : "setup", username: r.username, reason: r.reason || "" });
  } catch (err) {
    Object.assign(d, { status: "setup", reason: err.message });
  }
  renderDitlabNav();
  if (state.view.type === "ditlab") openDitlab();
}

function renderDitlabNav() {
  const d = state.ditlab, v = { type: "ditlab" };
  const items = [];
  if (d.status === "loading") items.push(h("li", { class: "empty-hint" }, "Checking DitLab…"));
  else if (d.status === "connected") {
    items.push(navItem({ label: "Past Exams", iconPath: ICONS.folder, active: isView(v), onclick: () => navigate(v) }));
  } else {
    items.push(navItem({ label: "Connect DitLab", iconPath: ICONS.key, active: isView(v), onclick: () => navigate(v) }));
  }
  $("nav-ditlab").replaceChildren(...items);
}

function openDitlab(refresh = false) {
  const d = state.ditlab;
  if (d.status === "loading") {
    $("ditlab-body").replaceChildren(h("div", { class: "state" }, h("div", { class: "spinner" }), "Checking DitLab…"));
  } else if (d.status === "connected") {
    loadDitlabFolder(d.path);
  } else {
    if (refresh) d.emails = null;
    renderDitlabSetup();
  }
}

const sizeFmt = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const ditlabFileLink = (path) => `/api/ditlab/raw?path=${encodeURIComponent(path)}&t=${encodeURIComponent(state.csrf)}`;

let ditlabReq = 0;
async function loadDitlabFolder(path) {
  const id = ++ditlabReq, d = state.ditlab;
  d.path = path; d.results = null;
  $("search").value = ""; state.query = "";
  $("view-sub").textContent = "Loading…";
  try {
    const r = await api("/api/ditlab/files?path=" + encodeURIComponent(path));
    if (id !== ditlabReq) return;
    d.items = r.items;
    renderDitlabFolder();
  } catch (err) {
    if (id !== ditlabReq) return;
    if (err.status === 409) { d.status = "setup"; d.reason = err.message; renderDitlabNav(); return renderDitlabSetup(); }
    $("ditlab-body").replaceChildren(h("div", { class: "state" }, err.message));
    $("view-sub").textContent = "";
  }
}

async function ditlabSearch() {
  const d = state.ditlab, q = $("search").value.trim();
  if (d.status !== "connected") return;
  if (q.length < 2) { d.results = null; return renderDitlabFolder(); }
  const id = ++ditlabReq;
  $("view-sub").textContent = "Searching…";
  try {
    const r = await api(`/api/ditlab/search?path=${encodeURIComponent(d.path)}&q=${encodeURIComponent(q)}`);
    if (id !== ditlabReq) return;
    d.results = r.results;
    renderDitlabFolder();
  } catch (err) {
    if (id === ditlabReq) $("view-sub").textContent = err.message;
  }
}

function fileRow(it, showPath) {
  const parts = [icon(it.isDir ? ICONS.folder : ICONS.file),
    h("span", { class: "name" }, it.name, showPath ? h("small", {}, it.path) : null),
    h("span", { class: "meta" }, it.isDir || !it.size ? "" : sizeFmt(it.size)),
    h("span", { class: "meta" }, it.modified ? dateFmt.format(new Date(it.modified)) : "")];
  return h("li", {}, it.isDir
    ? h("button", { class: "file-row dir", onclick: () => loadDitlabFolder(it.path) }, parts)
    : h("a", { class: "file-row", href: ditlabFileLink(it.path), target: "_blank", rel: "noopener" }, parts));
}

function renderDitlabFolder() {
  const d = state.ditlab;
  const segs = d.path.split("/").filter(Boolean);
  const crumbs = [h("button", { onclick: () => loadDitlabFolder("/") }, "DitLab")];
  segs.forEach((seg, i) => {
    crumbs.push(h("span", { class: "sep" }, "›"));
    const target = "/" + segs.slice(0, i + 1).join("/") + "/";
    crumbs.push(i === segs.length - 1 ? h("strong", {}, seg) : h("button", { onclick: () => loadDitlabFolder(target) }, seg));
  });
  const list = d.results ?? d.items;
  const rows = list.map((it) => fileRow(it, d.results !== null));
  if (!rows.length) rows.push(h("li", { class: "state" }, d.results ? "No files match." : "This folder is empty."));
  $("ditlab-body").replaceChildren(
    h("section", { class: "card" },
      h("div", { class: "course-head" }, h("div", { class: "row" },
        h("nav", { class: "crumbs", "aria-label": "Folder" }, crumbs),
        h("button", { class: "btn plain", onclick: disconnectDitlab, title: "Forget the DitLab login" }, "Disconnect"))),
      h("ul", { class: "files" }, rows)));
  $("view-sub").textContent = d.results
    ? `${list.length} result${list.length === 1 ? "" : "s"} in ${d.path}`
    : `Signed in as ${d.username} · ${d.items.length} item${d.items.length === 1 ? "" : "s"}`;
}

async function renderDitlabSetup() {
  const d = state.ditlab;
  $("view-sub").textContent = "Not connected";
  if (d.emails === null) {
    $("ditlab-body").replaceChildren(h("div", { class: "state" }, h("div", { class: "spinner" }), "Looking for DitLab emails in your mailbox…"));
    try {
      const r = await api("/api/ditlab/emails");
      d.emails = r.emails; d.username = d.username || r.username;
      if (!d.pick) d.pick = d.emails.find((m) => m.guesses.length) || (d.emails.length ? null : { manual: true });
    } catch (err) {
      d.emails = []; d.pick = { manual: true }; d.reason = err.message;
    }
    if (state.view.type !== "ditlab") return;
  }
  const pick = d.pick;
  const user = h("input", { id: "dl-user", value: pick?.username || d.username, autocomplete: "off", spellcheck: "false" });
  const pass = h("input", { id: "dl-pass", type: "password", value: pick?.guesses?.[0] || "", autocomplete: "off", spellcheck: "false" });
  const remember = h("input", { type: "checkbox", id: "dl-remember", checked: pick && !pick.manual ? true : null });
  const error = h("p", { class: "error", role: "alert" });
  const submit = h("button", { class: "btn primary wide", type: "submit" }, "Sign in to DitLab");
  const form = h("form", { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    submit.disabled = true; submit.textContent = "Signing in…"; error.textContent = "";
    try {
      const r = await api("/api/ditlab/connect", { method: "POST", body: {
        username: user.value.trim(), password: pass.value,
        folder: pick?.folder, uid: pick?.uid, remember: remember.checked } });
      Object.assign(d, { status: "connected", username: r.username, reason: "", emails: null, pick: null, path: "/" });
      toast(r.remembered ? "Connected · DitLab will sign in automatically next time" : "Connected to DitLab");
      renderDitlabNav();
      loadDitlabFolder("/");
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false; submit.textContent = "Sign in to DitLab";
    }
  } },
  h("label", { class: "field" }, h("span", {}, "Username"), user),
  h("label", { class: "field" }, h("span", {}, "Password"),
    h("div", { class: "pw-row" }, pass, h("button", { type: "button", class: "btn plain", onclick: (e) => {
      pass.type = pass.type === "password" ? "text" : "password";
      e.target.textContent = pass.type === "password" ? "Show" : "Hide";
    } }, "Show"))),
  pick?.guesses?.length > 1 ? h("div", { class: "guess-chips" }, h("span", { class: "muted" }, "Other matches:"),
    pick.guesses.map((g) => h("button", { type: "button", onclick: () => { pass.value = g; } }, g))) : null,
  pick && !pick.manual ? h("label", { class: "check" }, remember, "Remember this email, so DitLab signs in automatically next time (the password itself is never saved)") : null,
  error, submit);

  const emailList = d.emails.length
    ? h("ul", { class: "mail-pick" }, d.emails.map((m) => h("li", {}, h("button", {
      class: pick && pick.uid === m.uid && pick.folder === m.folder ? "selected" : "",
      onclick: () => { d.pick = m; renderDitlabSetup(); } },
      m.guesses.length ? h("span", { class: "found" }, "PASSWORD FOUND") : null,
      h("span", { class: "sub" }, m.subject),
      h("span", { class: "muted" }, `${nameOf(m.from)} · ${shortDate(m.date)}${m.folder === "junk" ? " · Junk" : ""}`)))))
    : h("p", { class: "muted" }, "No emails mentioning DitLab were found in your mailbox.");

  $("ditlab-body").replaceChildren(h("section", { class: "card setup" },
    h("h2", {}, "Connect DitLab"),
    h("p", { class: "lead" }, "DitLab emails you a password when you sign up with your academic email. Pick that email and check the password, or type it yourself."),
    d.reason ? h("div", { class: "banner" }, d.reason) : null,
    emailList,
    h("div", { class: "actions" },
      h("button", { class: "btn plain", onclick: () => { d.pick = { manual: true }; renderDitlabSetup(); } }, "Enter password manually"),
      h("a", { class: "btn plain", href: "https://ditlab.gr/", target: "_blank", rel: "noopener noreferrer" }, "Get a password on ditlab.gr ↗")),
    pick ? form : h("p", { class: "muted" }, "Select the email that contains your password."),
    pick && !pick.manual ? h("pre", { class: "mail-text" }, pick.text || "(empty email)") : null));
}

async function disconnectDitlab() {
  if (!confirm("Disconnect DitLab? You can connect again from your email anytime.")) return;
  try { await api("/api/ditlab/disconnect", { method: "POST", body: {} }); } catch {}
  Object.assign(state.ditlab, { status: "setup", reason: "", emails: null, pick: null, path: "/", items: [] });
  renderDitlabNav();
  openDitlab();
}

// ---------- wiring ----------
function init() {
  $("provider").addEventListener("change", applyProvider);
  $("pw-toggle").addEventListener("click", () => {
    setPasswordVisible($("password").type === "password");
    $("password").focus();
  });
  for (const b of document.querySelectorAll(".segmented button")) b.addEventListener("click", () => selectInst(b.dataset.inst));
  $("username").addEventListener("input", updateSuffix);
  $("username").addEventListener("change", () => {
    const p = $("username").value.includes("@") && guessProvider($("username").value);
    if (p && p !== $("provider").value) { $("provider").value = p; applyProvider(); }
  });
  $("login-form").addEventListener("submit", onLogin);
  $("logout-btn").addEventListener("click", logout);
  $("compose-btn").addEventListener("click", () => openCompose());
  $("compose-cancel").addEventListener("click", closeCompose);
  $("compose-form").addEventListener("submit", onSend);
  $("add-feed-btn").addEventListener("click", openFeedDialog);
  $("feed-cancel").addEventListener("click", () => ($("feed-dialog").hidden = true));
  $("feed-form").addEventListener("submit", onAddFeed);
  $("menu-btn").addEventListener("click", () => $("app").classList.add("nav-open"));
  $("scrim").addEventListener("click", () => $("app").classList.remove("nav-open"));
  $("more-btn").addEventListener("click", () => { state.page += 1; loadMail({ append: true }); });
  $("refresh-btn").addEventListener("click", () => {
    if (state.view.type === "mail") { state.page = 0; loadMail({ refresh: true }); refreshUnreadCount(); }
    else if (state.view.type === "ditlab") openDitlab(true);
    else if (state.view.type === "grades") loadGrades(true);
    else if (state.view.type === "studies") loadStudies(state.studies.tab, true);
    else { loadAnnouncements(true); if (state.eclass.enabled) loadEclass(true); }
  });
  $("eclass-refresh").addEventListener("click", () => loadEclass(true));
  const searchMail = debounce(() => { state.page = 0; state.selected = null; loadMail(); }, 350);
  const searchAnn = debounce(renderAnnouncements, 120);
  const searchDitlab = debounce(ditlabSearch, 400);
  $("search").addEventListener("input", () => {
    state.query = $("search").value.trim().toLowerCase();
    if (state.view.type === "mail") searchMail();
    else if (state.view.type === "ditlab") searchDitlab();
    else if (state.view.type === "grades") renderGrades();
    else if (state.view.type === "studies") renderStudies();
    else searchAnn();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("compose").hidden) closeCompose();
      else if (!$("feed-dialog").hidden) $("feed-dialog").hidden = true;
      else $("app").classList.remove("nav-open");
      return;
    }
    if ($("app").hidden || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (!$("compose").hidden || !$("feed-dialog").hidden) return;
    if (e.key === "c" && state.mail) { e.preventDefault(); openCompose(); }
    if (e.key === "/") { e.preventDefault(); $("search").focus(); }
    if (e.key === "r" && state.current && state.view.type === "mail") { e.preventDefault(); reply(false); }
  });

  api("/api/session").then((s) => {
    const d = s.defaults || {};
    if (d.imap_url) { $("imap_url").value = d.imap_url; $("smtp_url").value = d.smtp_url; }
    if (d.username) $("username").value = d.username.replace(/@(di\.uoa|unipi)\.gr$/, "");
    const known = Object.entries(PROVIDERS).find(([, p]) => p.imap && p.imap === d.imap_url);
    $("provider").value = known ? known[0] : d.imap_url ? "custom" : "uoa";
    if (!known && !d.imap_url) applyProvider();
    $("provider-hint").textContent = PROVIDERS[$("provider").value].hint;
    $("advanced").open = !!d.imap_url && !known;
    selectInst(d.institution === "unipi" ? "unipi" : "uoa");
    if (s.signedIn) startApp(); else showLogin();
  }).catch((err) => showLogin(err.message));
}

init();
