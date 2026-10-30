"use strict";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

// Build DOM nodes. All text goes through textContent, so remote data can never inject markup.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;          // CSSOM: allowed by the CSP, unlike a style attribute
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// replaceChildren() would show a null child as the text "null"; this skips empty ones, like h() does
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

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
// ---------- theme: auto (like the system), light or dark ----------
const THEMES = { auto: "Αυτόματο (όπως το σύστημα)", light: "Φωτεινό", dark: "Σκοτεινό" };
const THEME_ICONS = {
  auto: "M20 15.31 23.31 12 20 8.69V4h-4.69L12 .69 8.69 4H4v4.69L.69 12 4 15.31V20h4.69L12 23.31 15.31 20H20v-4.69zM12 18V6c3.31 0 6 2.69 6 6s-2.69 6-6 6z",
  light: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM2 13h2a1 1 0 0 0 0-2H2a1 1 0 0 0 0 2zm18 0h2a1 1 0 0 0 0-2h-2a1 1 0 0 0 0 2zM11 2v2a1 1 0 0 0 2 0V2a1 1 0 0 0-2 0zm0 18v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-2 0zM5.99 4.58a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41L5.99 4.58zm12.37 12.37a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41l-1.06-1.06zm1.06-10.96a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06zM7.05 18.36a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06z",
  dark: "M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z",
};

function currentTheme() {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "auto";
  } catch { return "auto"; }
}

function isDark() {
  const t = currentTheme();
  return t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
}

function setTheme(theme) {
  try {
    if (theme === "auto") localStorage.removeItem("theme"); else localStorage.setItem("theme", theme);
  } catch {}
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  renderThemeButton();
  if (state.view.type === "mail" && state.current) renderReader();     // the email frame picks its colors once
}

function renderThemeButton() {
  const t = currentTheme(), btn = $("theme-btn");
  btn.replaceChildren(icon(THEME_ICONS[t]));
  btn.title = `Θέμα: ${THEMES[t]} — κλικ για αλλαγή`;
  btn.setAttribute("aria-label", btn.title);
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
  play: "M8 5v14l11-7z",
  calendar: "M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14v10zM7 12h5v5H7z",
  assignment: "M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z",
  grade: "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
  info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
  copy: "M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z",
  check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  forum: "M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z",
  school: "M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3 1 9l11 6 9-4.91V17h2V9L12 3z",
  code: "M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z",
  github: "M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z",
  sparkle: "M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z",
  video: "M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z",
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
  feedItems: [], feedErrors: [], topicPages: new Map(), topicPageByCategory: new Map(),
  topicLoading: new Set(), topicError: "",
  grades: { status: "idle", data: null, error: "", semester: 0, showAll: true },
  studies: { tab: "", pages: {}, tabs: [], error: "" },
  lectures: { status: "idle", data: null, error: "", year: "", course: "" },
  timetable: { status: "idle", data: null, error: "", allSections: false, editing: false },
  deadlines: { status: "idle", items: null, error: "" },
  briefing: { data: null, timer: 0, wasRunning: false, gcal: null, gcalTimer: 0 },
  projects: { data: null, loading: false, error: "", busy: {} },
  study: { data: null, error: "", timer: 0, lectures: null },
  piazza: { data: null, error: "", loading: false, cls: "", mode: "feed", request: 0 },
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
  resetStudentAssistant();
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
  Object.assign(state.piazza, { data: null, cls: "", mode: "feed", loading: false, error: "", request: state.piazza.request + 1 });
  $("piazza-body").replaceChildren();
  resetExtraTools();
  $("tools-body").replaceChildren();
  state.csrf = "";
  state.messages = []; state.current = null;
  state.feedItems = []; state.announcements = [];
  state.topicPages.clear(); state.topicPageByCategory.clear(); state.topicLoading.clear(); state.topicError = "";
  Object.assign(state.grades, { status: "idle", data: null, error: "", semester: 0 });
  Object.assign(state.lectures, { status: "idle", data: null, error: "", year: "", course: "" });
  Object.assign(state.timetable, { status: "idle", data: null, error: "", allSections: false, editing: false });
  Object.assign(state.deadlines, { status: "idle", items: null, error: "" });
  Object.assign(courseTab, { tabs: {}, data: {}, trail: {}, available: {}, asking: {}, restoreDir: {}, view: "" });
  try { sessionStorage.removeItem("hub:location"); } catch {}
  $("tt-dialog").hidden = true;
  closePlayer();
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
  // after signing in, the day's briefing comes first; a reload stays where it was
  navigate(restoreLocation(s) || (afterLogin ? { type: "briefing" }
    : s.mail ? { type: "mail", folder: "inbox", unread: false } : { type: "ann" }));
  if (s.mail) refreshUnreadCount();
  loadAnnouncements();
  Promise.resolve(loadEclass()).finally(() => startBriefing(false));    // eClass signed in first, then shared
  loadProjects(false, true);
  loadPiazza(false, true);
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
  const counts = new Map();
  for (const a of state.announcements) for (const category of (a.category || "").split(",").map((x) => x.trim()).filter(Boolean))
    counts.set(category, (counts.get(category) || 0) + 1);
  const order = ["Προπτυχιακά", "Πρακτική Άσκηση", "Μεταπτυχιακά", "Εκδηλώσεις", "Αξιοσημείωτα", "Δυνατότητες Καριέρας"];
  // Keep the standard university topics available even when today's feeds have
  // no posts in one of them (e.g. internship notices are seasonal).
  for (const topic of order) if (!counts.has(topic)) counts.set(topic, 0);
  const rank = (cat) => order.includes(cat) ? order.indexOf(cat) : order.length;
  const topics = [...counts].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, "el"));
  $("nav-topics").replaceChildren(
    navItem({ label: "Όλες οι ανακοινώσεις", iconPath: ICONS.megaphone,
      active: isView(all), count: state.announcements.length || "", onclick: () => navigate(all) }),
    ...topics.map(([cat, n]) => {
      const v = { type: "ann", cat };
      return navItem({ label: cat, color: feedColor(cat), active: isView(v), count: n, onclick: () => navigate(v) });
    }));

  const sources = state.feeds.map((f) => {
    const v = { type: "ann", feed: f.id };
    return navItem({ label: f.name, color: feedColor(f.id), active: isView(v), onclick: () => navigate(v),
      onremove: () => removeFeed(f) });
  });
  if (!state.feeds.length) sources.push(h("li", { class: "empty-hint" }, "Add eClass or department news with +"));
  $("nav-sources").replaceChildren(...sources);
  renderEclassNav();
}

// ---------- staying in place across a page reload (per browser tab) ----------
const VIEW_NEEDS = {
  mail: () => state.mail, studies: () => state.inst.ditStudies, timetable: () => state.inst.ditStudies,
  lectures: () => state.inst.ditStudies, grades: () => !!state.inst.grades, ditlab: () => state.inst.ditlab,
  deadlines: () => true, ann: () => true, briefing: () => true, projects: () => true, tools: () => true, study: () => true, piazza: () => true,
};

function saveLocation() {
  const code = (state.view.feed || "").startsWith("ec:") ? state.view.feed.slice(3) : null;
  const loc = { view: state.view, studiesTab: state.studies.tab };
  if (code) {
    const [, tab, dir] = (courseTab.view || "").split("|");
    loc.course = { code, tab: courseTab.tabs[code] || null,
      dir: (courseTab.view || "").startsWith(code + "|docs|") ? dir : "", trail: courseTab.trail[code] || [] };
    if (tab && !courseTab.tabs[code] && !(courseTab.view || "").startsWith(code + "|")) loc.course.tab = null;
  }
  try { sessionStorage.setItem("hub:location", JSON.stringify(loc)); } catch {}
}

function restoreLocation(session) {
  let loc;
  try { loc = JSON.parse(sessionStorage.getItem("hub:location")); } catch { return null; }
  const view = loc && loc.view;
  if (!view || !VIEW_NEEDS[view.type] || !VIEW_NEEDS[view.type]()) return null;
  if (view.type === "mail" && !session.folders.includes(view.folder)) return null;
  if (typeof loc.studiesTab === "string") state.studies.tab = loc.studiesTab;
  const c = loc.course;
  if (c && typeof c.code === "string") {
    if (c.tab) courseTab.tabs[c.code] = c.tab;
    if (Array.isArray(c.trail)) courseTab.trail[c.code] = c.trail;
    if (c.dir) courseTab.restoreDir[c.code] = c.dir;      // reopen the same Documents folder
  }
  return view;
}

function navigate(view) {
  state.view = view;
  state.query = $("search").value = "";
  closeMobileSidebar();
  renderMailNav();
  renderFeedNav();
  const isMail = view.type === "mail";
  $("mail-view").hidden = !isMail;
  $("ann-view").hidden = view.type !== "ann";
  $("ditlab-view").hidden = view.type !== "ditlab";
  $("grades-view").hidden = view.type !== "grades";
  $("studies-view").hidden = view.type !== "studies";
  $("lectures-view").hidden = view.type !== "lectures";
  $("timetable-view").hidden = view.type !== "timetable";
  $("deadlines-view").hidden = view.type !== "deadlines";
  $("briefing-view").hidden = view.type !== "briefing";
  $("projects-view").hidden = view.type !== "projects";
  $("tools-view").hidden = view.type !== "tools";
  renderAssistantAccess();
  $("study-view").hidden = view.type !== "study";
  $("piazza-view").hidden = view.type !== "piazza";
  renderTopNav();
  renderDitlabNav();
  renderStudiesNav();
  if (view.type === "briefing") {
    $("view-title").textContent = "Σήμερα";
    renderBriefing();
  } else if (view.type === "piazza") {
    $("view-title").textContent = "Piazza";
    state.piazza.data ? renderPiazza() : loadPiazza();
  } else if (view.type === "study") {
    $("view-title").textContent = "Μελέτη για εξετάσεις";
    renderStudy();
    loadStudy();
  } else if (view.type === "tools") {
    $("view-title").textContent = "Εργαλεία · Tools";
    $("view-sub").textContent = "12 tools · 6 categories";
    renderTools();
  } else if (view.type === "projects") {
    $("view-title").textContent = "Projects";
    loadProjects();
  } else if (view.type === "studies") {
    $("view-title").textContent = "Προπτυχιακές Σπουδές";
    loadStudies(state.studies.tab);
  } else if (view.type === "deadlines") {
    $("view-title").textContent = "Προθεσμίες εργασιών";
    state.deadlines.items ? renderDeadlines() : loadDeadlines();
  } else if (view.type === "timetable") {
    $("view-title").textContent = "Πρόγραμμα μαθημάτων";
    state.timetable.data ? renderTimetable() : loadTimetable();
  } else if (view.type === "lectures") {
    $("view-title").textContent = "Βιντεοδιαλέξεις";
    state.lectures.data ? renderLectures() : loadLectures();
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
    if (view.cat && topicKeys[view.cat] && state.inst.id === "uoa") {
      loadTopicAnnouncements(view.cat, state.topicPageByCategory.get(view.cat) || 0);
    }
  }
  saveLocation();
}


// ---------- briefing: what to do, from the mail, announcements and assignments (written by Claude) ----------
const BRIEF_STEPS = [["mail", "Διαβάζω τα email"], ["eclass", "Διαβάζω τις ανακοινώσεις του eClass"],
  ["deadlines", "Ελέγχω τις εργασίες"], ["news", "Διαβάζω τα νέα του τμήματος"], ["claude", "Το AI γράφει την ενημέρωση"]];

async function startBriefing(force) {
  try {
    state.briefing.data = await api("/api/briefing", { method: "POST", body: { force } });
  } catch (err) {
    if (force) toast(err.message);
    return;
  }
  pollBriefing();
}

async function pollGcal() {
  const B = state.briefing;
  clearTimeout(B.gcalTimer);
  const was = B.gcal?.job?.status;
  try { B.gcal = await api("/api/calendar/google"); } catch { return; }
  const st = B.gcal.job?.status;
  if (was === "running" && st === "done" && state.view.type !== "briefing") {
    const n = (B.gcal.job.results || []).filter((r) => r.status === "created" || r.status === "updated").length;
    toast(n ? `Το Google Calendar ενημερώθηκε: ${n} ${n === 1 ? "γεγονός" : "γεγονότα"}` : "Το Google Calendar είναι ενημερωμένο");
  }
  if (state.view.type === "briefing") renderBriefing();
  if (st === "running") B.gcalTimer = setTimeout(pollGcal, 3000);
}

async function changeGcal(body) {
  try { state.briefing.gcal = await api("/api/calendar/google", { method: "POST", body }); } catch (err) { toast(err.message); }
  renderBriefing();
  if (body.sync || state.briefing.gcal?.job?.status === "running") pollGcal();
}

const CAL_LABELS = [["deadlines", "Προθεσμίες εργασιών"], ["todos", "Εκκρεμότητες"], ["dates", "Σημαντικές ημερομηνίες"], ["timetable", "Πρόγραμμα μαθημάτων (εβδομαδιαία)"]];

function calendarCard() {
  const g = state.briefing.gcal;
  if (!g) return null;
  const include = new Set(g.include);
  const job = g.job || {};
  const kinds = h("div", { class: "cal-kinds" }, CAL_LABELS.map(([k, label]) => h("label", null,
    h("input", { type: "checkbox", checked: include.has(k), onchange: (e) => {
      if (e.target.checked) include.add(k); else include.delete(k);
      changeGcal({ include: [...include] });
    } }), label)));
  const ics = `/api/calendar/ics?${new URLSearchParams({ include: [...include].join(","), t: state.csrf })}`;
  let status;
  if (job.status === "running") {
    status = h("span", { class: "cal-status" }, h("span", { class: "spinner" }),
      { events: "Μαζεύω τα γεγονότα…", connector: "Ελέγχω τη σύνδεση με το Google Calendar…", claude: "Το Claude ενημερώνει το Google Calendar…" }[job.step] || "…");
  } else if (job.status === "error" && job.error === "NOT_CONNECTED") {
    status = h("div", { class: "cal-connect" },
      h("b", null, "Το Google Calendar δεν είναι συνδεδεμένο με τον λογαριασμό σου στο Claude."),
      h("span", null, "Άνοιξε ", h("a", { href: "https://claude.ai/settings/connectors", target: "_blank", rel: "noopener noreferrer" }, "claude.ai → Settings → Connectors"),
        ", πάτα Connect στο Google Calendar και δώσε άδεια με τον λογαριασμό σου στο Google. Μετά πάτα ξανά «Ενημέρωση»."));
  } else if (job.status === "error") {
    status = h("span", { class: "cal-status err" }, `Η ενημέρωση απέτυχε: ${job.error}`);
  } else if (g.last) {
    status = h("span", { class: "cal-status muted" }, `Τελευταία ενημέρωση ${agoText(g.last)}` + (g.lastCount ? ` · ${g.lastCount} νέα/αλλαγμένα` : "") +
      (g.synced ? ` · ${g.synced} γεγονότα από το Student Hub` : ""));
  }
  const results = (job.results || []).filter((r) => r.status !== "exists");
  return h("div", { class: "card brief-cal" },
    kinds,
    h("div", { class: "cal-row" },
      h("a", { class: "btn plain", href: ics, download: "student-hub.ics", title: "Αρχείο .ics για Google Calendar (Ρυθμίσεις → Εισαγωγή), κινητό ή Thunderbird" }, "⬇ Λήψη .ics"),
      h("button", { type: "button", class: "btn primary", disabled: job.status === "running" || !include.size, onclick: () => changeGcal({ sync: true }) }, "Ενημέρωση Google Calendar"),
      h("label", { class: "cal-auto", title: "Μετά από κάθε νέα ενημέρωση «Σήμερα», το Claude προσθέτει τα καινούργια στο Google Calendar" },
        h("input", { type: "checkbox", checked: g.auto, onchange: (e) => changeGcal({ auto: e.target.checked }) }), "Αυτόματα μετά από κάθε ενημέρωση")),
    status || null,
    results.length ? h("details", { class: "cal-results" }, h("summary", null, `${results.length} αλλαγές στο Google Calendar`),
      h("ul", null, results.map((r) => h("li", { class: r.status }, `${{ created: "＋", updated: "✎", failed: "✕" }[r.status] || ""} ${r.title}`,
        r.note && r.status === "failed" ? h("small", null, ` · ${r.note}`) : null)))) : null,
    job.note ? h("small", { class: "muted" }, job.note) : null,
    h("small", { class: "muted" }, "Στο Google Calendar τα γεγονότα τα προσθέτει το Claude με τον σύνδεσμο Google Calendar του λογαριασμού σου στο Claude. Δεν σβήνει ποτέ τίποτα, και δεν προσθέτει δύο φορές το ίδιο."));
}

async function pollBriefing() {
  clearTimeout(state.briefing.timer);
  if (!state.briefing.gcal) pollGcal();
  const B = state.briefing;
  try { B.data = await api("/api/briefing"); } catch { return; }
  const running = B.data.status === "running";
  if (B.wasRunning && !running && B.data.status === "done" && state.view.type !== "briefing") {
    const open = openTodos().length;
    toast(open ? `Η ενημέρωσή σου είναι έτοιμη: ${open} ${open === 1 ? "εκκρεμότητα" : "εκκρεμότητες"}` : "Η ενημέρωσή σου είναι έτοιμη");
  }
  if (B.wasRunning && !running) pollGcal();
  B.wasRunning = running;
  renderTopNav();
  if (state.view.type === "briefing") renderBriefing();
  if (running) B.timer = setTimeout(pollBriefing, 2000);
}

const openTodos = () => {
  const d = state.briefing.data;
  return d && d.brief ? d.brief.todos.filter((t) => !(d.done || {})[t.id]) : [];
};

function renderTopNav() {
  const d = state.briefing.data, open = openTodos();
  const urgent = open.filter((t) => t.priority === "high" || (t.due && dueInfo(t.due).days <= 2)).length;
  const item = navItem({ label: "Σήμερα", iconPath: ICONS.sparkle, active: state.view.type === "briefing",
    count: d?.status === "running" && !d.brief ? "…" : urgent || open.length || "", onclick: () => navigate({ type: "briefing" }) });
  if (urgent) item.querySelector(".count")?.classList.add("badge", "urgent");
  item.querySelector(".item").title = open.length ? `${open.length} εκκρεμότητες${urgent ? ` · ${urgent} επείγουσες` : ""}` : "Η ενημέρωσή σου";
  const n = state.projects.data?.projects.length;
  const pending = state.projects.data?.invitations.length || 0;
  const proj = navItem({ label: "Projects", iconPath: ICONS.code, active: state.view.type === "projects",
    count: pending || n || "", onclick: () => navigate({ type: "projects" }) });
  if (pending) {
    proj.querySelector(".count")?.classList.add("badge");
    proj.querySelector(".item").title = `${pending} προσκλήσεις σε projects ομάδας`;
  }
  const study = navItem({ label: "Μελέτη", iconPath: ICONS.school, active: state.view.type === "study",
    onclick: () => navigate({ type: "study" }) });
  const unreadPiazza = (state.piazza.data?.items || []).filter((x) => x.unread).length;
  const piazza = navItem({ label: "Piazza", iconPath: ICONS.forum, active: state.view.type === "piazza",
    count: unreadPiazza || "", onclick: () => navigate({ type: "piazza" }) });
  fill($("nav-top"), item, study, proj, piazza, navItem({ label: "Εργαλεία · Tools", iconPath: ICONS.assignment,
    active: state.view.type === "tools", onclick: () => navigate({ type: "tools" }) }));
}

function dueInfo(due) {
  const hasTime = due.includes("T");
  const d = new Date(hasTime ? due : `${due}T23:59`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const days = Math.round((day - today) / 86400000);
  const time = hasTime ? ` ${d.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" })}` : "";
  const label = d < new Date() ? `Έληξε${days === 0 ? time : ` ${d.toLocaleDateString("el-GR", { day: "numeric", month: "short" })}`}`
    : days === 0 ? `Σήμερα${time}` : days === 1 ? `Αύριο${time}`
    : days < 7 ? `${d.toLocaleDateString("el-GR", { weekday: "long" })} ${d.getDate()}/${d.getMonth() + 1}${time}`
    : d.toLocaleDateString("el-GR", { day: "numeric", month: "short" }) + time;
  return { days, label, late: d < new Date(), date: d };
}

function briefRefs(refs) {
  const R = state.briefing.data.refs || {};
  return refs.map((id) => R[id]).filter(Boolean).map((r) => {
    if (r.type === "mail") {
      return h("button", { type: "button", class: "brief-ref", title: `${r.from}: ${r.label}`, onclick: () => {
        navigate({ type: "mail", folder: "inbox", unread: false });
        openMessage({ uid: r.uid, unread: false });
      } }, icon(ICONS.inbox), r.label);
    }
    if (r.type === "course") {
      return h("button", { type: "button", class: "brief-ref", title: `${r.from}: ${r.label}`, onclick: () => {
        delete courseTab.tabs[r.code];
        navigate({ type: "ann", feed: "ec:" + r.code });
      } }, icon(ICONS.assignment), "Εργασίες στο eClass");
    }
    return /^https?:/.test(r.url || "") ? h("a", { class: "brief-ref", href: r.url, target: "_blank", rel: "noopener noreferrer", title: `${r.from}: ${r.label}` },
      icon(ICONS.info), r.label || r.from) : null;
  });
}

async function markTodo(t, done) {
  const d = state.briefing.data;
  d.done = { ...(d.done || {}) };
  if (done) d.done[t.id] = new Date().toISOString(); else delete d.done[t.id];
  renderBriefing();
  renderTopNav();
  try {
    d.done = (await api("/api/briefing/done", { method: "POST", body: { id: t.id, done } })).done;
  } catch (err) { toast(err.message); }
}

function todoRow(t, done) {
  const due = t.due ? dueInfo(t.due) : null;
  const urgent = due && !done && (due.late || due.days <= 1);
  return h("li", { class: `todo prio-${t.priority}${done ? " done" : ""}` },
    h("button", { type: "button", class: "todo-check", role: "checkbox", "aria-checked": String(done),
      title: done ? "Σήμανση ως εκκρεμές" : "Έγινε", onclick: () => markTodo(t, !done) }, done ? icon(ICONS.check) : null),
    h("div", { class: "todo-main" },
      h("div", { class: "todo-task" }, t.task),
      t.detail ? h("div", { class: "todo-detail" }, t.detail) : null,
      h("div", { class: "todo-meta" },
        due ? h("span", { class: `due${urgent ? " urgent" : due.days <= 6 ? " soon" : ""}`, title: due.date.toLocaleString("el-GR") }, icon(ICONS.calendar), due.label) : null,
        t.course ? h("span", { class: "todo-course" }, t.course) : null,
        briefRefs(t.refs))));
}

function renderBriefing() {
  const body = $("briefing-body"), d = state.briefing.data;
  const q = state.query;
  const now = new Date();
  const dateLine = now.toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "long" });
  if (!d || ((d.status === "running" || d.status === "none") && !d.brief)) {
    const at = d ? BRIEF_STEPS.findIndex(([k]) => k === d.step) : -1;
    $("view-sub").textContent = dateLine;
    return body.replaceChildren(h("div", { class: "card brief-hero loading" },
      h("h2", null, "Ετοιμάζω την ενημέρωσή σου…"),
      h("ol", { class: "brief-steps" }, BRIEF_STEPS.map(([k, label], i) => h("li", { class: i < at ? "done" : i === at ? "now" : "" },
        h("span", { class: "dot" }, i < at ? icon(ICONS.check) : i === at ? h("span", { class: "spinner" }) : ""), label))),
      h("p", { class: "muted" }, "Το επιλεγμένο AI διαβάζει τα πρόσφατα email, τις ανακοινώσεις και τις εργασίες σου και σου λέει τι έχεις να κάνεις.")));
  }
  if (d.status === "unavailable") {
    return body.replaceChildren(h("div", { class: "state" }, h("p", null, "Η ενημέρωση χρειάζεται το επιλεγμένο AI CLI εγκατεστημένο και συνδεδεμένο. Άνοιξε τις ρυθμίσεις AI στο μενού.")));
  }
  const parts = [];
  if (d.status === "error") {
    parts.push(h("div", { class: "card brief-note warn" }, `Η ενημέρωση δεν ολοκληρώθηκε: ${d.error}`,
      h("button", { type: "button", class: "btn plain", onclick: () => startBriefing(true) }, "Ξανά")));
  }
  if (!d.brief) return body.replaceChildren(...parts);
  const B = d.brief, done = d.done || {};
  const match = (...xs) => !q || xs.join(" ").toLowerCase().includes(q);
  const todos = B.todos.filter((t) => match(t.task, t.detail, t.course));
  const open = todos.filter((t) => !done[t.id]), finished = todos.filter((t) => done[t.id]);
  const generated = new Date(d.generated), checked = new Date(d.checked);
  $("view-sub").textContent = dateLine;
  parts.push(h("div", { class: "card brief-hero" },
    h("div", { class: "brief-top" },
      h("h2", null, B.greeting || "Η ενημέρωσή σου"),
      d.status === "running" ? h("span", { class: "brief-busy" }, h("span", { class: "spinner" }),
        (BRIEF_STEPS.find(([k]) => k === d.step) || [, "Ενημέρωση…"])[1] + "…") : null),
    B.summary ? h("p", null, B.summary) : null));
  parts.push(h("h3", { class: "brief-h" }, "Τι έχεις να κάνεις", open.length ? h("span", { class: "count" }, open.length) : null));
  const calCard = calendarCard();
  parts.push(open.length ? h("ul", { class: "card todo-list" }, open.map((t) => todoRow(t, false)))
    : h("div", { class: "card brief-note" }, q ? "Καμία εκκρεμότητα δεν ταιριάζει με την αναζήτηση." : "Δεν έχεις εκκρεμότητες. 🎉"));
  if (finished.length) {
    parts.push(h("details", { class: "brief-done" }, h("summary", null, `Ολοκληρώθηκαν (${finished.length})`),
      h("ul", { class: "card todo-list" }, finished.map((t) => todoRow(t, true)))));
  }
  const dates = B.dates.filter((x) => match(x.what, x.course, x.when));
  if (dates.length) {
    parts.push(h("h3", { class: "brief-h" }, "Σημαντικές ημερομηνίες"),
      h("ul", { class: "card brief-dates" }, dates.map((x) => h("li", null,
        h("span", { class: "when" }, x.when),
        h("div", null, h("div", null, x.what), h("div", { class: "todo-meta" }, x.course ? h("span", { class: "todo-course" }, x.course) : null, briefRefs(x.refs)))))));
  }
  const updates = B.updates.filter((x) => match(x.title, x.text));
  if (updates.length) {
    parts.push(h("h3", { class: "brief-h" }, "Αξίζει να ξέρεις"),
      h("div", { class: "brief-updates" }, updates.map((x) => h("div", { class: "card brief-update" },
        h("strong", null, x.title), h("p", null, x.text), h("div", { class: "todo-meta" }, briefRefs(x.refs))))));
  }
  if (calCard) parts.push(h("h3", { class: "brief-h" }, "Ημερολόγιο"), calCard);
  const c = d.counts || {};
  const src = [c.mail && `${c.mail} email`, c.eclass && `${c.eclass} ανακοινώσεις eClass`, c.deadlines && `${c.deadlines} εργασίες`,
    c.news && `${c.news} νέα του τμήματος`].filter(Boolean).join(", ");
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "μόλις τώρα" : m < 60 ? `πριν ${m}′` : m < 1440 ? `πριν ${Math.round(m / 60)} ώρ.` : t.toLocaleDateString("el-GR"); };
  const model = (d.model || "").replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2");
  parts.push(h("p", { class: "brief-foot muted" },
    `Από το ${aiProviderName(d.provider)}${model ? ` (${model})` : ""}${src ? `, βάσει: ${src}` : ""}. Γράφτηκε ${ago(generated)}` +
    (checked - generated > 60000 ? `, έλεγχος για νέα ${ago(checked)}` : "") + ". Μπορεί να έχει λάθη: έλεγξε τις πηγές.",
    h("button", { type: "button", class: "btn plain", disabled: d.status === "running", onclick: () => startBriefing(true) }, "Ανανέωση")));
  body.replaceChildren(...parts);
}

// ---------- projects: a GitHub repository per assignment, opened in the IDE ----------
const GREEK_LATIN = { α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x",
  ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o" };
const slug = (text) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[α-ω]/g, (c) => GREEK_LATIN[c] || c).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const isTeamWork = (w) => /ομαδ|group|team/i.test(`${w.kind || ""} ${w.title || ""}`);

async function loadProjects(refresh = false, quiet = false) {
  const P = state.projects;
  if (P.loading) return;
  P.loading = true;
  if (!quiet && !P.data) renderProjects();
  try {
    P.data = await api("/api/projects" + (refresh ? "?refresh=1" : ""));
    P.error = "";
  } catch (err) {
    P.error = err.message;
  } finally {
    P.loading = false;
  }
  renderTopNav();
  if (state.view.type === "projects") renderProjects();
  if (currentCourse() || state.view.type === "deadlines") refreshProjectButtons();
}

function projectFor(w, code) {
  return (state.projects.data?.projects || []).find((p) => p.courseCode === code && p.assignment === w.title);
}

// the button on an eClass assignment: open its project, or make one
function projectButton(w) {
  const code = w.course || currentCourse()?.code || "";
  const el = h("span", { class: "proj-slot", "data-code": code, "data-title": w.title });
  el.append(projectButtonInner(w, code));
  el._work = w;
  return el;
}

function projectButtonInner(w, code) {
  const p = projectFor(w, code);
  if (p) {
    return h("button", { type: "button", class: "proj-btn has", title: `Άνοιγμα του ${p.repo} στο IDE`,
      onclick: (e) => { e.stopPropagation(); openProject(p); } }, icon(ICONS.code), "Άνοιγμα");
  }
  return h("button", { type: "button", class: "proj-btn", title: "Νέο GitHub project για αυτή την εργασία",
    onclick: (e) => {
      e.stopPropagation();
      const course = state.eclass.courses.find((c) => c.code === code);
      openProjectDialog("new", { work: w, course });
    } }, icon(ICONS.github), "Project");
}

function refreshProjectButtons() {
  for (const slot of document.querySelectorAll(".proj-slot")) {
    if (slot._work) slot.replaceChildren(projectButtonInner(slot._work, slot.dataset.code));
  }
}

async function openProject(p) {
  toast(`Άνοιγμα του ${p.name}…`);
  try {
    await api("/api/projects/open", { method: "POST", body: { id: p.id } });
  } catch (err) { toast(err.message); }
}

async function projectAction(p, action) {
  const P = state.projects;
  P.busy[p.id] = action;
  renderProjects();
  try {
    if (action === "pull" || action === "push") {
      const r = await api("/api/projects/sync", { method: "POST", body: { id: p.id, action } });
      toast(action === "pull" ? "Ενημερώθηκε από το GitHub" : "Στάλθηκε στο GitHub");
      p.git = r.git;
    } else if (action === "remove") {
      if (!confirm(`Να αφαιρεθεί το ${p.name} από τη λίστα;\nΤο repo στο GitHub και ο φάκελος ${p.path} μένουν ως έχουν.`)) return;
      await api(`/api/projects?id=${encodeURIComponent(p.id)}`, { method: "DELETE", body: {} });
    }
  } catch (err) {
    toast(err.message);
  } finally {
    delete P.busy[p.id];
  }
  loadProjects(true);
}

function renderProjects() {
  const body = $("projects-body"), P = state.projects, d = P.data;
  if (!d) {
    return body.replaceChildren(P.error ? h("div", { class: "state" }, h("p", null, P.error),
      h("button", { class: "btn primary", onclick: () => loadProjects(true) }, "Ξανά"))
      : h("div", { class: "state" }, h("div", { class: "spinner" }), "Φόρτωση projects…"));
  }
  const q = state.query;
  const parts = [];
  const n = d.projects.length;
  $("view-sub").textContent = [n ? `${n} ${n === 1 ? "project" : "projects"}` : "", d.invitations.length ? `${d.invitations.length} προσκλήσεις` : ""].filter(Boolean).join(" · ") || "GitHub";
  // toolbar: actions, GitHub account, IDE
  const ideSelect = h("select", { "aria-label": "IDE", onchange: async (e) => {
    try { await api("/api/projects/settings", { method: "POST", body: { ide: e.target.value } }); d.ide = e.target.value; toast("Το IDE αποθηκεύτηκε"); }
    catch (err) { toast(err.message); }
  } }, d.ides.filter((i) => i.available).map((i) => h("option", { value: i.id, selected: d.ide === i.id }, i.name)));
  parts.push(h("div", { class: "proj-bar" },
    h("button", { type: "button", class: "btn primary", disabled: !d.gh || !d.user, onclick: () => openProjectDialog("new", {}) }, "＋ Νέο project"),
    h("button", { type: "button", class: "btn plain", disabled: !d.gh || !d.user, onclick: () => openProjectDialog("connect", {}) }, "Σύνδεση σε project ομάδας"),
    h("span", { class: "proj-bar-info" },
      d.user ? h("span", { class: "chip" }, icon(ICONS.github), `@${d.user}`) : null,
      h("label", { class: "proj-ide" }, "IDE ", ideSelect),
      h("span", { class: "muted", title: "Οι τοπικοί φάκελοι των projects" }, d.folder.replace(/^\/home\/[^/]+/, "~")))));
  if (!d.gh || !d.git) {
    parts.push(h("div", { class: "card brief-note warn" }, `Χρειάζονται τα ${[!d.git && "git", !d.gh && "GitHub CLI (gh)"].filter(Boolean).join(" και ")}: δες το README.`));
  } else if (!d.user) {
    parts.push(h("div", { class: "card brief-note warn" }, "Το GitHub CLI δεν είναι συνδεδεμένο. Τρέξε μία φορά σε τερματικό:  gh auth login  (ανοίγει σύνδεση με link στον browser)."));
  }
  for (const inv of d.invitations) {
    parts.push(h("div", { class: "card proj-invite" }, icon(ICONS.github),
      h("span", null, h("b", null, `@${inv.from}`), " σε κάλεσε στο ", h("b", null, inv.repo)),
      h("button", { type: "button", class: "btn primary", onclick: () => openProjectDialog("connect", { repo: inv.repo }) }, "Σύνδεση")));
  }
  const list = d.projects.filter((p) => !q || `${p.name} ${p.assignment} ${p.course} ${p.repo}`.toLowerCase().includes(q));
  if (!d.projects.length) {
    parts.push(h("div", { class: "card proj-empty" },
      h("h3", null, "Κανένα project ακόμα"),
      h("p", null, "Φτιάξε ένα GitHub repo για μια εργασία: πάτα «Project» δίπλα σε μια εργασία στο eClass (καρτέλα Εργασίες ή Προθεσμίες) ή «Νέο project» εδώ. Για ομαδικές εργασίες προσκαλείς τα μέλη της ομάδας, κι εκείνα συνδέονται από εδώ."),
      h("button", { type: "button", class: "btn plain", onclick: () => navigate({ type: "deadlines" }) }, "Προθεσμίες εργασιών →")));
  }
  const now = new Date();
  const active = list.filter((p) => !p.deadline || new Date(p.deadline) >= new Date(now - 7 * 86400000));
  const old = list.filter((p) => !active.includes(p));
  active.sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  parts.push(...active.map(projectCard));
  if (old.length) parts.push(h("h3", { class: "list-head" }, "Παλαιότερα"), ...old.map(projectCard));
  body.replaceChildren(...parts);
}

const agoText = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? "μόλις τώρα" : m < 60 ? `πριν ${m}′` : m < 1440 ? `πριν ${Math.round(m / 60)} ώρ.` : m < 43200 ? `πριν ${Math.round(m / 1440)} μέρ.` : new Date(iso).toLocaleDateString("el-GR");
};

function projectCard(p) {
  const g = p.git || {}, gh = p.github || {}, busy = state.projects.busy[p.id];
  const late = p.deadline && new Date(p.deadline) < new Date();
  const chips = [];
  if (!g.local) chips.push(h("span", { class: "pchip" }, "Δεν υπάρχει αντίγραφο σε αυτόν τον υπολογιστή"));
  if (g.changes) chips.push(h("span", { class: "pchip warn", title: "Αρχεία που άλλαξαν και δεν έχουν γίνει commit" }, `${g.changes} αλλαγές χωρίς commit`));
  if (g.ahead) chips.push(h("span", { class: "pchip warn", title: "Commits που δεν έχουν σταλεί στο GitHub" }, `↑ ${g.ahead} για push`));
  if (g.behind) chips.push(h("span", { class: "pchip info", title: "Νέα commits στο GitHub (π.χ. από την ομάδα)" }, `↓ ${g.behind} νέα`));
  if (g.local && !g.changes && !g.ahead && !g.behind && g.branch) chips.push(h("span", { class: "pchip ok" }, "Συγχρονισμένο"));
  if (gh.error) chips.push(h("span", { class: "pchip warn", title: gh.error }, "GitHub: σφάλμα"));
  const members = (gh.members || []).filter((u) => u.toLowerCase() !== (state.projects.data.user || "").toLowerCase());
  const pending = gh.pending || [];
  const team = [...members.map((u) => h("span", { class: "member", title: "Μέλος" }, `@${u}`)),
    ...pending.map((u) => h("span", { class: "member pending", title: "Δεν έχει αποδεχτεί ακόμα την πρόσκληση" }, `@${u} · εκκρεμεί`))];
  return h("div", { class: "card proj-card" + (late ? " past" : "") },
    h("div", { class: "proj-head" },
      h("div", { class: "proj-title" },
        p.course ? h("span", { class: "work-course", style: `--h:${courseHue(p.courseCode || p.course)}` }, p.course) : null,
        h("b", null, p.assignment || p.name),
        h("a", { class: "muted proj-repo", href: gh.url || `https://github.com/${p.repo}`, target: "_blank", rel: "noopener noreferrer" },
          icon(ICONS.github), p.repo, gh.private === false ? " · δημόσιο" : "")),
      p.deadline ? h("span", { class: "due" + (late ? " late" : "") , title: fmtDateTime(p.deadline) }, relativeDue(p.deadline)) : null),
    h("div", { class: "proj-state" }, chips,
      g.last ? h("span", { class: "muted proj-last", title: `${g.last.sha} · ${new Date(g.last.date).toLocaleString("el-GR")}` },
        `Τελευταίο commit ${agoText(g.last.date)}: «${g.last.subject}» · ${g.last.author}${g.commits ? ` · ${g.commits} commits` : ""}`) : null),
    team.length || p.owner ? h("div", { class: "proj-team" }, team.length ? [h("span", { class: "muted" }, "Ομάδα:"), team] : h("span", { class: "muted" }, "Ατομικό"),
      p.owner ? h("button", { type: "button", class: "link-btn", onclick: () => openProjectDialog("invite", { project: p }) }, "＋ Πρόσκληση μελών") : null) : null,
    h("div", { class: "proj-actions" },
      h("button", { type: "button", class: "btn primary", disabled: !!busy, onclick: () => openProject(p) }, icon(ICONS.code), g.local ? "Άνοιγμα στο IDE" : "Λήψη και άνοιγμα"),
      g.local ? h("button", { type: "button", class: "btn plain", disabled: !!busy, title: "Φέρε τις αλλαγές της ομάδας (μόνο fast-forward)", onclick: () => projectAction(p, "pull") }, busy === "pull" ? "Pull…" : "Pull") : null,
      g.local && g.ahead ? h("button", { type: "button", class: "btn plain", disabled: !!busy, onclick: () => projectAction(p, "push") }, busy === "push" ? "Push…" : `Push (${g.ahead})`) : null,
      p.assignmentUrl ? h("a", { class: "btn plain", href: p.assignmentUrl, target: "_blank", rel: "noopener" }, "Εκφώνηση ↗") : null,
      h("button", { type: "button", class: "btn plain faint proj-remove", disabled: !!busy, title: "Αφαίρεση από τη λίστα", onclick: () => projectAction(p, "remove") }, "Αφαίρεση")));
}

// ---- dialogs: new project, join a team's project, invite teammates
async function openProjectDialog(kind, ctx) {
  if (!state.projects.data) await loadProjects(false, true);
  const d = state.projects.data;
  const form = $("proj-form");
  if (!d) return toast(state.projects.error || "Τα projects δεν φορτώθηκαν");
  if (!d.gh || !d.user) {
    navigate({ type: "projects" });
    return toast("Χρειάζεται σύνδεση του GitHub CLI: gh auth login");
  }
  form.onsubmit = null;
  $("proj-dialog").hidden = false;
  const close = () => { $("proj-dialog").hidden = true; };
  const field = (label, input, hint) => h("label", { class: "field" }, h("span", null, label), input, hint ? h("small", { class: "muted" }, hint) : null);
  const actions = (submitLabel) => h("div", { class: "proj-form-actions" },
    h("button", { type: "button", class: "btn plain", onclick: close }, "Άκυρο"),
    h("button", { type: "submit", class: "btn primary" }, submitLabel));
  const usersOf = (text) => text.split(/[\s,;]+/).map((u) => u.replace(/^@/, "").trim()).filter(Boolean);

  if (kind === "invite") {
    const p = ctx.project;
    const users = h("input", { placeholder: "π.χ. maria-k, nikosp", autocomplete: "off", spellcheck: "false" });
    fill(form, h("h2", null, "Πρόσκληση μελών"), h("p", { class: "muted" }, `Στο ${p.repo}. Θα λάβουν πρόσκληση από το GitHub με δικαίωμα push.`),
      field("GitHub usernames", users, "Χώρισε με κόμμα ή κενό."), h("div", { class: "proj-result", id: "proj-result" }), actions("Αποστολή"));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const list = usersOf(users.value);
      if (!list.length) return users.focus();
      try {
        const r = await api("/api/projects/invite", { method: "POST", body: { id: p.id, users: list } });
        $("proj-result").replaceChildren(inviteResult(r.invites));
        loadProjects(true);
      } catch (err) { toast(err.message); }
    };
    return users.focus();
  }

  const courses = state.eclass.courses || [];
  const courseSelect = h("select", null, h("option", { value: "" }, "—"),
    courses.map((c) => h("option", { value: c.code, selected: ctx.course?.code === c.code }, c.title)));
  const courseOf = () => courses.find((c) => c.code === courseSelect.value);
  const assignment = h("input", { value: ctx.work?.title || "", placeholder: "π.χ. Εργασία 1: Νήματα", autocomplete: "off" });
  const openAfter = h("input", { type: "checkbox", checked: true });

  if (kind === "connect") {
    const repo = h("input", { value: ctx.repo || "", placeholder: "χρήστης/όνομα ή https://github.com/…", autocomplete: "off", spellcheck: "false", required: true });
    fill(form, h("h2", null, "Σύνδεση σε project ομάδας"),
      h("p", { class: "muted" }, "Για εργασία που ξεκίνησε κάποιο μέλος της ομάδας σου. Αν σε έχει προσκαλέσει, η πρόσκληση γίνεται αποδεκτή και το repo κατεβαίνει στον φάκελο των projects."),
      d.invitations.length ? h("div", { class: "proj-picks" }, d.invitations.map((inv) =>
        h("button", { type: "button", class: "chip", onclick: () => { repo.value = inv.repo; } }, `${inv.repo} · από @${inv.from}`))) : null,
      field("Repo", repo), field("Μάθημα", courseSelect), field("Εργασία", assignment),
      h("label", { class: "check" }, openAfter, "Άνοιγμα στο IDE μετά"), actions("Σύνδεση"));
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!repo.value.trim()) return repo.focus();
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true; btn.textContent = "Σύνδεση…";
      try {
        const c = courseOf();
        await api("/api/projects/connect", { method: "POST", body: { repo: repo.value, course: c?.title || "", courseCode: c?.code || "",
          assignment: assignment.value, open: openAfter.checked } });
        close();
        toast("Το project συνδέθηκε");
        navigate({ type: "projects" });
        loadProjects(true);
      } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = "Σύνδεση"; }
    };
    return repo.focus();
  }

  // new project
  const w = ctx.work || {};
  const suggest = () => slug([courseOf()?.title.split(/\s+/).map((x) => x[0]).join("") || "", assignment.value || "project"].filter(Boolean).join("-")) || "project";
  const name = h("input", { value: suggest(), autocomplete: "off", spellcheck: "false", required: true, pattern: "[A-Za-z0-9._-]+" });
  let nameEdited = false;
  name.addEventListener("input", () => { nameEdited = true; preview(); });
  const where = h("small", { class: "muted" });
  const preview = () => { where.textContent = `github.com/${d.user}/${name.value} · ${d.folder.replace(/^\/home\/[^/]+/, "~")}/${name.value}`; };
  const resuggest = () => { if (!nameEdited) name.value = suggest(); preview(); };
  assignment.addEventListener("input", resuggest);
  courseSelect.addEventListener("change", resuggest);
  preview();
  const description = h("textarea", { rows: 2, placeholder: "Προαιρετικά" });
  const template = h("select", null, [["c", "C / C++"], ["python", "Python"], ["java", "Java"], ["node", "JavaScript / Node"], ["none", "Κανένα"]]
    .map(([v, t]) => h("option", { value: v }, t)));
  const priv = h("input", { type: "checkbox", checked: true });
  const team = h("input", { type: "checkbox", checked: isTeamWork(w) });
  const members = h("input", { placeholder: "GitHub usernames, π.χ. maria-k, nikosp", autocomplete: "off", spellcheck: "false" });
  const teamBox = h("div", { class: "proj-team-box" },
    field("Μέλη της ομάδας", members, "Θα λάβουν πρόσκληση από το GitHub. Όταν τη δεχτούν, ανοίγουν το project από το Student Hub: Projects → Σύνδεση σε project ομάδας."));
  const syncTeam = () => { teamBox.hidden = !team.checked; };
  team.addEventListener("change", () => { syncTeam(); if (team.checked) members.focus(); });
  syncTeam();
  fill(form, h("h2", null, "Νέο GitHub project"),
    w.title ? h("p", { class: "muted" }, [ctx.course?.title, w.deadline && `προθεσμία ${fmtDateTime(w.deadline)}`].filter(Boolean).join(" · ")) : null,
    field("Μάθημα", courseSelect), field("Εργασία", assignment),
    field("Όνομα repo", name, where), field("Περιγραφή", description),
    h("div", { class: "proj-row" }, field("Γλώσσα (.gitignore)", template),
      h("label", { class: "check" }, priv, "Ιδιωτικό repo"), h("label", { class: "check" }, team, isTeamWork(w) ? "Ομαδική εργασία (κατά το eClass)" : "Ομαδική εργασία")),
    teamBox,
    h("label", { class: "check" }, openAfter, "Άνοιγμα στο IDE μετά τη δημιουργία"),
    h("div", { class: "proj-result", id: "proj-result" }), actions("Δημιουργία"));
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!/^[A-Za-z0-9._-]+$/.test(name.value)) { toast("Όνομα repo: μόνο λατινικά, αριθμοί και - _ ."); return name.focus(); }
    const list = team.checked ? usersOf(members.value) : [];
    if (team.checked && !list.length &&
        !confirm("Η εργασία είναι ομαδική αλλά δεν έγραψες μέλη για πρόσκληση.\n\nΠάτα «Άκυρο» για να τα προσθέσεις τώρα, ή «OK» για να συνεχίσεις και να τα προσκαλέσεις αργότερα.")) {
      return members.focus();
    }
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Δημιουργία…";
    const c = courseOf();
    try {
      const r = await api("/api/projects", { method: "POST", body: { name: name.value, description: description.value, template: template.value,
        private: priv.checked, team: list, open: openAfter.checked, course: c?.title || "", courseCode: c?.code || "",
        assignment: assignment.value, assignmentUrl: w.url || "", deadline: w.deadline || "" } });
      fill(form, h("h2", null, "✓ Το project δημιουργήθηκε"),
        h("p", null, h("a", { href: `https://github.com/${r.project.repo}`, target: "_blank", rel: "noopener noreferrer" }, `github.com/${r.project.repo}`)),
        h("p", { class: "muted" }, `Τοπικά: ${r.project.path}`),
        Object.keys(r.invites).length ? inviteResult(r.invites) : null,
        openAfter.checked ? h("p", { class: "muted" }, "Ανοίγει στο IDE…") : null,
        h("div", { class: "proj-form-actions" }, h("button", { type: "button", class: "btn primary", onclick: () => { close(); navigate({ type: "projects" }); } }, "Στα projects")));
      loadProjects(true);
    } catch (err) {
      toast(err.message);
      btn.disabled = false; btn.textContent = "Δημιουργία";
    }
  };
  assignment.value ? name.focus() : assignment.focus();
}

function inviteResult(invites) {
  return h("ul", { class: "proj-invites" }, Object.entries(invites).map(([u, r]) => h("li", { class: r === "invited" || r === "member" ? "ok" : "fail" },
    `@${u}: ${r === "invited" ? "στάλθηκε πρόσκληση" : r === "member" ? "είναι ήδη μέλος" : r}`)));
}

// ---------- exam study mode: flashcards written by Claude from the course's lectures, documents and notes ----------
const session = { deck: null, cards: [], index: 0, flipped: false };

async function loadStudy() {
  const S = state.study;
  try { S.data = await api("/api/study"); S.error = ""; } catch (err) { S.error = err.message; }
  if (state.view.type === "study") renderStudy();
  clearTimeout(S.timer);
  if (S.data?.decks.some((d) => d.job?.status === "running")) S.timer = setTimeout(loadStudy, 2500);
}

function renderStudy() {
  const body = $("study-body"), S = state.study, d = S.data;
  if (!d) {
    return fill(body, S.error ? h("div", { class: "state" }, h("p", null, S.error), h("button", { class: "btn primary", onclick: loadStudy }, "Ξανά"))
      : h("div", { class: "state" }, h("div", { class: "spinner" }), "Φόρτωση…"));
  }
  const q = state.query;
  const n = d.decks.reduce((t, x) => t + x.total, 0);
  $("view-sub").textContent = d.decks.length ? `${d.decks.length} ${d.decks.length === 1 ? "τράπουλα" : "τράπουλες"} · ${n} κάρτες` : "Κάρτες για τις εξετάσεις";
  const decks = d.decks.filter((x) => !q || `${x.title} ${x.course}`.toLowerCase().includes(q));
  const parts = [h("div", { class: "proj-bar" },
    h("button", { type: "button", class: "btn primary", onclick: () => openDeckDialog() }, "＋ Νέα τράπουλα"),
    h("span", { class: "muted" }, "Κάρτες ερωτήσεων-απαντήσεων από τις διαλέξεις, τα έγγραφα του eClass και τις σημειώσεις σου."))];
  if (!d.decks.length) {
    parts.push(h("div", { class: "card proj-empty" }, h("h3", null, "Ξεκίνα με μια τράπουλα"),
      h("p", null, "Διάλεξε μάθημα και πηγές: διαλέξεις με σύνοψη του AI καθηγητή ή υπότιτλους, PDF/Word από τα Έγγραφα του eClass, ή δικές σου σημειώσεις. Το επιλεγμένο AI γράφει τις ερωτήσεις και τις απαντήσεις.")));
  }
  parts.push(h("div", { class: "deck-grid" }, decks.map(deckCard)));
  fill(body, parts);
}

// the sources a deck's cards were written from, with how many cards each gave and a link to open it
function deckSources(x) {
  const rows = (x.sources || []).map((src) => {
    const count = src.cards != null ? h("small", { class: "muted" }, `${src.cards} ${src.cards === 1 ? "κάρτα" : "κάρτες"}`) : null;
    if (src.type === "lecture") {
      return h("li", null, icon(ICONS.play), h("span", { class: "src-name", title: src.label }, src.label),
        src.from ? h("small", { class: "tag" }, src.from) : null, count,
        h("a", { class: "src-open", href: `https://uniflix.uoa.gr/vod/player?id=${encodeURIComponent(src.id)}`, target: "_blank", rel: "noopener noreferrer", title: "Άνοιγμα σε νέα καρτέλα" }, "↗"));
    }
    if (src.type === "doc") {
      return h("li", null, icon(ICONS.file), h("span", { class: "src-name", title: src.name }, src.name), count,
        h("a", { class: "src-open", href: `/api/eclass/file?url=${encodeURIComponent(src.url)}`, target: "_blank", rel: "noopener", title: "Άνοιγμα σε νέα καρτέλα" }, "↗"));
    }
    return h("li", null, icon(ICONS.info), h("span", { class: "src-name" }, src.label || "Σημειώσεις"), count);
  });
  const skipped = (x.skipped || []).map((k) => h("li", { class: "skipped", title: k.reason }, icon(ICONS.file),
    h("span", { class: "src-name" }, k.name), h("small", null, `δεν διαβάστηκε: ${k.reason}`)));
  if (!rows.length && !skipped.length) return null;
  return h("details", { class: "deck-sources", open: rows.length + skipped.length <= 4 },
    h("summary", null, `Φτιαγμένες από ${rows.length} ${rows.length === 1 ? "πηγή" : "πηγές"}` + (skipped.length ? ` · ${skipped.length} δεν διαβάστηκαν` : "")),
    h("ul", null, rows, skipped));
}

function deckCard(x) {
  const job = x.job || {};
  return h("div", { class: "card deck", style: `--h:${courseHue(x.courseCode || x.course)}` },
    h("div", { class: "deck-top" },
      h("span", { class: "work-course", style: `--h:${courseHue(x.courseCode || x.course)}` }, x.course || "Τράπουλα"),
      h("b", null, `${x.total} ${x.total === 1 ? "κάρτα" : "κάρτες"}`)),
    deckSources(x),
    job.status === "running" ? h("div", { class: "deck-job" }, h("span", { class: "spinner" }),
      { sources: "Διαβάζω τις πηγές…", documents: "Διαβάζω τα έγγραφα…", claude: "Το AI γράφει κάρτες…" }[job.step] || "Ετοιμάζω…")
      : job.status === "error" ? h("div", { class: "deck-job err" }, `Δεν γράφτηκαν κάρτες: ${job.error}`) : null,
    h("div", { class: "deck-actions" },
      h("button", { type: "button", class: "btn primary", disabled: !x.total, onclick: () => startSession(x.id) }, "Μελέτη"),
      h("button", { type: "button", class: "btn plain", disabled: job.status === "running", onclick: () => openDeckDialog(x) }, "＋ Κάρτες"),
      h("button", { type: "button", class: "btn plain faint deck-del", onclick: async () => {
        if (!confirm(`Να διαγραφεί η τράπουλα «${x.title}» με ${x.total} κάρτες;`)) return;
        try { state.study.data = await api(`/api/study/deck?id=${x.id}`, { method: "DELETE", body: {} }); renderStudy(); } catch (err) { toast(err.message); }
      } }, "Διαγραφή")));
}

async function openDeckDialog(deck) {
  const form = $("study-form");
  $("study-dialog").hidden = false;
  const close = () => { $("study-dialog").hidden = true; };
  const courses = state.eclass.courses || [];
  const course = h("select", { disabled: !!deck }, h("option", { value: "" }, "— Διάλεξε μάθημα —"),
    courses.map((c) => h("option", { value: c.code, selected: deck?.courseCode === c.code }, c.title)));
  const lectures = h("div", { class: "src-list" }), docs = h("div", { class: "src-list" });
  const notes = h("textarea", { rows: 3, placeholder: "Προαιρετικά: επικόλλησε σημειώσεις, ύλη, θέματα προηγούμενων ετών…" });
  const count = h("select", null, [15, 25, 40, 60].map((n) => h("option", { value: n, selected: n === 25 }, `${n} κάρτες`)));
  const field = (label, el, hint) => h("label", { class: "field" }, h("span", null, label), el, hint ? h("small", { class: "muted" }, hint) : null);
  const group = (label, el, hint) => h("div", { class: "field" }, h("span", null, label), el, hint ? h("small", { class: "muted" }, hint) : null);
  const openLink = (href, title) => h("a", { class: "src-open", href, target: "_blank", rel: "noopener noreferrer", title, "aria-label": title,
    onclick: (e) => e.stopPropagation() }, "↗");
  const check = (value, label, tag, checked, disabled, href) => h("div", { class: "src" + (disabled ? " off" : "") },
    h("label", null, h("input", { type: "checkbox", value, checked, disabled }), h("span", { class: "src-name", title: label }, label)),
    tag ? h("small", { class: "tag" }, tag) : null, href ? openLink(href, "Άνοιγμα σε νέα καρτέλα") : null);
  const req = { n: 0 };
  async function loadSources() {
    const code = course.value, id = ++req.n;
    if (!code) { fill(lectures, h("small", { class: "muted" }, "Διάλεξε πρώτα μάθημα.")); fill(docs); return; }
    fill(lectures, h("small", { class: "muted" }, h("span", { class: "spinner" }), " Διαλέξεις…"));
    fill(docs, h("small", { class: "muted" }, h("span", { class: "spinner" }), " Έγγραφα…"));
    (async () => {                                   // lectures of the course on uniflix
      if (!state.study.lectures && state.inst.ditStudies) {     // every academic year, not only the one on the Lectures page
        try { state.study.lectures = await api("/api/uniflix?y=a"); } catch (err) {
          if (id === req.n) fill(lectures, h("small", { class: "muted" }, err.message)); return;
        }
      }
      if (id !== req.n) return;
      const entry = state.study.lectures?.courses.find((c) => c.code === code);
      const list = entry?.lectures || [];
      if (!list.length) return fill(lectures, h("small", { class: "muted" }, "Καμία διάλεξη στο uniflix για αυτό το μάθημα."));
      const anySummary = list.some((l) => l.summary);
      fill(lectures, list.map((l, i) => {
        const dt = lectureDate(l.date);
        const label = `${dt.day ? `${dt.num} ${dt.mon}` : ""} · ${l.title}`.replace(/^ · /, "");
        const has = l.summary || l.subs;
        const box = check(l.id, label, l.summary ? "σύνοψη" : l.subs ? "υπότιτλοι" : "χωρίς κείμενο", has && (l.summary || !anySummary), !has,
          `https://uniflix.uoa.gr/vod/player?id=${encodeURIComponent(l.id)}`);
        box.querySelector("input").dataset.label = `${entry.name || entry.title} · ${label}`;
        box.title = has ? "" : "Φτιάξε πρώτα σύνοψη (AI καθηγητής) ή υπότιτλους στο player";
        return box;
      }));
    })();
    (async () => {                                   // the course's documents, in all its folders
      let r;
      try { r = await api(`/api/eclass/alldocs?code=${encodeURIComponent(code)}`); } catch (err) {
        if (id === req.n) fill(docs, h("small", { class: "muted" }, err.message)); return;
      }
      if (id !== req.n) return;
      // the type comes from whichever of title, link or download address has an extension; files with none are
      // kept (the server recognizes PDF/Word/PowerPoint by their content), only media and archives are left out
      const lastPart = (u) => { try { return decodeURIComponent((u || "").split("?")[0].split("/").pop() || ""); } catch { return ""; } };
      const dlName = (u) => { const m = (u || "").match(/[?&]download=([^&]+)/); try { return m ? decodeURIComponent(m[1]).split("/").pop() : ""; } catch { return ""; } };
      const SKIP = /\.(mp4|mkv|webm|avi|mov|mp3|wav|m4a|zip|rar|7z|tar|gz|png|jpe?g|gif|webp|bmp|svg|exe|iso)$/i;
      const files = r.files.map((x) => {
        const src = x.url || x.download;
        const name = [x.name, lastPart(x.url), dlName(x.download), lastPart(x.download)].find((n) => n && viewKind(n)) || "";
        return { name: name || x.name, known: !!name, title: x.name, url: src, folder: x.folder || "", old: isPastYear(x.when) };
      }).filter((f) => f.known ? ["pdf", "office", "md", "text", "csv"].includes(viewKind(f.name)) : !SKIP.test(f.title));
      files.sort((a, b) => a.old - b.old);           // this year's files first, older ones after
      if (!files.length) return fill(docs, h("small", { class: "muted" }, `Κανένα PDF/Word/κείμενο στα Έγγραφα του μαθήματος (${r.files.length} αρχεία συνολικά).`));
      const folders = [...new Set(files.map((f) => f.folder))].sort((a, b) => a.localeCompare(b, "el"));
      const groups = folders.map((folder) => {
        const boxes = files.filter((f) => f.folder === folder).map((f) => {
          const ext = f.known ? (f.name.split(".").pop() || "").toUpperCase() : "αρχείο";
          const box = check(f.url, f.title, f.old ? `${ext} · παλιό` : ext, false, false,
            `/api/eclass/file?url=${encodeURIComponent(f.url)}`);
          box.querySelector("input").dataset.name = f.name;
          box.dataset.search = `${folder} ${f.title} ${f.name}`.toLowerCase();
          return box;
        });
        const all = h("input", { type: "checkbox", title: "Όλα τα αρχεία του φακέλου" });
        all.addEventListener("change", () => boxes.forEach((b) => { if (!b.hidden) b.querySelector("input").checked = all.checked; }));
        return h("div", { class: "src-group" },
          h("label", { class: "src-folder" }, all, icon(ICONS.folder), h("span", { class: "src-name" }, folder || "Κεντρικός φάκελος"),
            h("small", { class: "tag" }, String(boxes.length))),
          h("div", { class: "src-files" }, boxes));
      });
      const filter = h("input", { type: "search", class: "src-filter", placeholder: `Αναζήτηση σε ${files.length} αρχεία…`,
        oninput: () => {
          const q = filter.value.trim().toLowerCase();
          for (const g of groups) {
            let shown = 0;
            for (const b of g.querySelectorAll(".src")) { b.hidden = !!q && !b.dataset.search.includes(q); if (!b.hidden) shown++; }
            g.hidden = !shown;
          }
        } });
      fill(docs, files.length > 6 ? filter : null, groups);
    })();
  }
  course.addEventListener("change", loadSources);
  fill(form, h("h2", null, deck ? `Κι άλλες κάρτες: ${deck.title}` : "Νέα τράπουλα"),
    h("p", { class: "muted" }, "Το επιλεγμένο AI διαβάζει τις πηγές και γράφει ερωτήσεις-απαντήσεις για την εξέταση, με τον λογαριασμό σου στο αντίστοιχο CLI."),
    field("Μάθημα", course), group("Διαλέξεις", lectures), group("Έγγραφα (eClass)", docs, "Όλοι οι φάκελοι του μαθήματος. Τα PDF, Word και PowerPoint διαβάζονται σε αυτόν τον υπολογιστή."),
    field("Σημειώσεις", notes), field("Πόσες κάρτες", count),
    h("div", { class: "proj-form-actions" }, h("button", { type: "button", class: "btn plain", onclick: close }, "Άκυρο"),
      h("button", { type: "submit", class: "btn primary" }, "Δημιουργία καρτών")));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const c = courses.find((x) => x.code === course.value);
    const sources = [
      ...[...lectures.querySelectorAll("input:checked")].map((i) => ({ type: "lecture", id: i.value, label: i.dataset.label })),
      ...[...docs.querySelectorAll("input:checked")].map((i) => ({ type: "doc", url: i.value, name: i.dataset.name })),
      ...(notes.value.trim() ? [{ type: "notes", text: notes.value }] : [])];
    if (!c && !deck) return toast("Διάλεξε μάθημα");
    if (!sources.length) return toast("Διάλεξε τουλάχιστον μία πηγή");
    try {
      state.study.data = await api("/api/study/generate", { method: "POST", body: { deck: deck?.id || "", course: c?.title || deck?.course || "",
        courseCode: c?.code || deck?.courseCode || "", sources, count: Number(count.value) } });
      close();
      toast("Το AI γράφει τις κάρτες σου…");
      navigate({ type: "study" });
      loadStudy();
    } catch (err) { toast(err.message); }
  };
  loadSources();
  (deck ? notes : course).focus();
}

// ---- going through a deck: question, answer, next
async function startSession(did) {
  let deck;
  try { deck = await api(`/api/study/deck?id=${did}`); } catch (err) { return toast(err.message); }
  if (!deck.cards.length) return toast("Η τράπουλα δεν έχει κάρτες ακόμα");
  Object.assign(session, { deck, cards: deck.cards, index: 0, flipped: false });
  $("study").hidden = false;
  $("study-title").textContent = deck.title;
  showCard();
}

function sourceChip(src) {
  if (!src) return null;
  const tab = (href) => h("a", { class: "brief-ref tab", href, target: "_blank", rel: "noopener noreferrer", title: "Άνοιγμα σε νέα καρτέλα",
    "aria-label": "Άνοιγμα σε νέα καρτέλα", onclick: (e) => e.stopPropagation() }, "↗");
  if (src.type === "lecture") {
    return h("span", { class: "src-chips" },
      h("button", { type: "button", class: "brief-ref", title: "Άνοιγμα της διάλεξης σε αυτό το σημείο", onclick: (e) => { e.stopPropagation(); openLectureAt(src.id, src.at); } },
        icon(ICONS.play), `${src.label}${src.at ? ` · ${fmtClock(src.at)}` : ""}`),
      tab(`https://uniflix.uoa.gr/vod/player?id=${encodeURIComponent(src.id)}`));
  }
  if (src.type === "doc") {
    return h("span", { class: "src-chips" },
      h("button", { type: "button", class: "brief-ref", title: "Άνοιγμα του εγγράφου", onclick: (e) => {
        e.stopPropagation();
        openViewer([{ name: src.name, src: { src: "eclass", url: src.url } }], 0);
      } }, icon(ICONS.file), src.name),
      tab(`/api/eclass/file?url=${encodeURIComponent(src.url)}`));
  }
  return h("span", { class: "brief-ref" }, src.label || "Σημειώσεις");
}

async function openLectureAt(lid, at) {
  if (!state.lectures.data) { try { state.lectures.data = await api("/api/uniflix"); } catch (err) { return toast(err.message); } }
  for (const c of state.lectures.data.courses) {
    const i = c.lectures.indexOf(c.lectures.find((l) => l.id === lid));
    if (i >= 0) {
      try { localStorage.setItem("uf:" + lid, JSON.stringify({ t: Math.max(0, Math.floor(at || 0) - 3) })); } catch {}
      return openPlayer(c.lectures, i, c);          // the player resumes from the saved position
    }
  }
  toast("Η διάλεξη δεν βρέθηκε στο uniflix");
}

function showCard() {
  const card = session.cards[session.index];
  if (!card) return showSessionEnd();
  session.flipped = false;
  $("study-count").textContent = `${session.index + 1} / ${session.cards.length}`;
  const flash = h("div", { class: "flash", tabindex: "0", role: "button", "aria-label": "Δείξε την απάντηση", onclick: () => flipCard() },
    h("div", { class: "flash-inner" },
      h("div", { class: "face front" },
        h("div", { class: "face-top" }, card.topic ? h("span", { class: "chip" }, card.topic) : null),
        h("div", { class: "q" }, card.front),
        h("div", { class: "face-foot" }, sourceChip(card.source))),
      h("div", { class: "face back" },
        h("div", { class: "q small" }, card.front),
        h("div", { class: "a md" }, md(card.back)),
        h("div", { class: "face-foot" }, sourceChip(card.source),
          h("button", { type: "button", class: "link-btn", title: "Η κάρτα είναι λάθος ή άχρηστη", onclick: (e) => { e.stopPropagation(); deleteCard(card); } }, "Διαγραφή κάρτας")))));
  fill($("study-stage"), flash);
  fill($("study-foot"), h("button", { type: "button", class: "btn primary big", onclick: () => flipCard() }, "Δείξε την απάντηση", h("kbd", null, "Space")));
  flash.focus();
}

function flipCard() {
  if (session.flipped || !session.cards[session.index]) return;
  session.flipped = true;
  $("study-stage").querySelector(".flash").classList.add("flipped");
  fill($("study-foot"), h("button", { type: "button", class: "btn primary big", onclick: nextCard },
    session.index + 1 < session.cards.length ? "Επόμενη" : "Τέλος", h("kbd", null, "→")));
  $("study-foot").querySelector("button").focus();
}

function nextCard() {
  if (!session.flipped) return flipCard();
  session.index++;
  showCard();
}

async function deleteCard(card) {
  if (!confirm("Να διαγραφεί αυτή η κάρτα;")) return;
  try {
    await api("/api/study/card", { method: "POST", body: { deck: session.deck.id, card: card.id, delete: true } });
  } catch (err) { return toast(err.message); }
  session.cards = session.cards.filter((c) => c.id !== card.id);
  showCard();
}

function showSessionEnd() {
  $("study-count").textContent = `${session.cards.length} / ${session.cards.length}`;
  fill($("study-stage"), h("div", { class: "session-end" },
    h("h3", null, "Τέλος της τράπουλας"),
    h("p", { class: "muted" }, `Πέρασες και τις ${session.cards.length} κάρτες.`)));
  fill($("study-foot"),
    h("button", { type: "button", class: "btn plain", onclick: closeSession }, "Κλείσιμο"),
    h("button", { type: "button", class: "btn primary", onclick: () => { session.index = 0; showCard(); } }, "Από την αρχή"));
}

function closeSession() {
  $("study").hidden = true;
  loadStudy();
}

// ---------- Piazza: course feed and optional email notifications ----------
const PIAZZA_KINDS = { question: ["Ερώτηση", "q"], note: ["Σημείωση", "n"], instructor: ["Σημείωση διδάσκοντα", "i"],
  reply: ["Απάντηση", "r"], digest: ["Σύνοψη", "d"], post: ["Ανάρτηση", "p"] };

function piazzaModeControls() {
  const P = state.piazza;
  return h("div", { class: "piazza-classes" },
    h("button", { type: "button", class: "chip" + (P.mode !== "emails" ? " on" : ""), onclick: () => switchPiazzaMode("feed") }, "Course feed"),
    state.mail ? h("button", { type: "button", class: "chip" + (P.mode === "emails" ? " on" : ""), onclick: () => switchPiazzaMode("emails") }, "Email notifications") : null);
}

function switchPiazzaMode(mode) {
  Object.assign(state.piazza, { mode, data: null, cls: "", error: "" });
  loadPiazza();
}

async function loadPiazza(refresh = false, quiet = false, more = false) {
  const P = state.piazza, request = (P.request || 0) + 1, mode = P.mode;
  P.request = request;
  P.loading = true;
  if (!quiet && state.view.type === "piazza") renderPiazza();
  const q = new URLSearchParams();
  if (refresh) q.set("refresh", "1");
  if (mode !== "emails" && P.cls) q.set("class", P.cls);
  if (more && P.data) q.set("offset", String(P.data.offset + 50));
  try {
    const data = await api((mode === "emails" ? "/api/piazza/emails" : "/api/piazza") + "?" + q);
    if (P.request !== request) return;
    if (more && P.data) {
      const old = P.data.items, ids = new Set(old.map((x) => x.id));
      data.items = [...old, ...data.items.filter((x) => !ids.has(x.id))];
    }
    P.data = data; P.error = "";
    if (mode !== "emails") P.cls = data.classId || "";
  } catch (err) { if (P.request === request) P.error = err.message; }
  finally { if (P.request === request) P.loading = false; }
  if (P.request !== request) return;
  renderTopNav();
  if (state.view.type === "piazza") renderPiazza();
}

function piazzaConnectForm() {
  const P = state.piazza;
  const email = h("input", { type: "email", name: "email", autocomplete: "username", required: true, placeholder: "Piazza email", "aria-label": "Piazza email" });
  const password = h("input", { type: "password", name: "password", autocomplete: "current-password", required: true, placeholder: "Piazza password", "aria-label": "Piazza password" });
  const status = h("p", { role: "status" });
  const button = h("button", { type: "submit", class: "btn primary" }, "Connect Piazza");
  const form = h("form", { class: "piazza-connect", onsubmit: async (event) => {
    event.preventDefault(); button.disabled = true; status.textContent = "Connecting…";
    try {
      await api("/api/piazza/connect", { method: "POST", body: { email: email.value, password: password.value } });
      password.value = "";
      P.data = null; P.cls = "";
      await loadPiazza();
    } catch (err) { status.textContent = err.message; }
    finally { password.value = ""; button.disabled = false; }
  } }, email, password, button, status);
  return h("div", { class: "card" }, h("h3", {}, "Connect your Piazza course feed"),
    h("p", { class: "muted" }, "Sign in with your Piazza account to see course posts and discussions here. Your password is sent to Piazza for sign-in and isn't saved. The connection lasts for this Student Hub session."), form);
}

function renderPiazza() {
  const P = state.piazza, d = P.data, body = $("piazza-body");
  if (P.mode === "emails") {
    renderPiazzaEmails();
    body.prepend(piazzaModeControls());
    if (P.error && d) body.prepend(h("p", { role: "alert" }, P.error));
    return;
  }
  const parts = [piazzaModeControls()];
  $("view-sub").textContent = P.loading ? "Loading Piazza feed…" : d?.connected ? "Course feed · latest activity" : "Connect your Piazza account";
  if (P.error) parts.push(h("p", { role: "alert" }, P.error),
    h("button", { class: "btn", type: "button", disabled: P.loading, onclick: () => loadPiazza(true) }, "Retry"));
  if (!d) {
    if (P.loading) parts.push(h("div", { class: "state" }, h("div", { class: "spinner" }), "Loading Piazza…"));
    else parts.push(piazzaConnectForm());
    return fill(body, parts);
  }
  if (!d.connected) { parts.push(piazzaConnectForm()); return fill(body, parts); }
  parts.push(h("div", { class: "piazza-actions" },
    h("button", { type: "button", class: "btn", disabled: P.loading, onclick: () => loadPiazza(true) }, "Refresh feed"),
    h("button", { type: "button", class: "btn plain", onclick: async (event) => {
      event.currentTarget.disabled = true;
      try {
        await api("/api/piazza/disconnect", { method: "POST", body: {} });
        Object.assign(P, { data: null, cls: "", error: "" }); await loadPiazza();
      } catch (err) { toast(err.message); event.currentTarget.disabled = false; }
    } }, "Disconnect")));
  if (P.error) parts.push(piazzaConnectForm());
  parts.push(h("div", { class: "piazza-classes" }, d.classes.map((c) => h("button", {
    type: "button", class: "chip" + (P.cls === c.id ? " on" : ""), disabled: P.loading,
    onclick: () => { P.cls = c.id; P.data = { ...d, items: [], more: false }; loadPiazza(); },
  }, c.name, c.term ? ` · ${c.term}` : ""))));
  const q = state.query.toLowerCase();
  const items = d.items.filter((x) => !q || `${x.title} ${x.snippet} ${x.course}`.toLowerCase().includes(q));
  if (!d.classes.length) parts.push(h("p", { class: "muted" }, "No courses were found in this Piazza account."));
  else if (!items.length && !P.loading) parts.push(h("p", { class: "muted" }, q ? "No loaded posts match your search." : "No posts in this course yet."));
  for (const x of items) {
    const [kind, kindClass] = PIAZZA_KINDS[x.kind] || PIAZZA_KINDS.post;
    const detail = h("div", { class: "piazza-thread", hidden: true });
    const open = h("button", { type: "button", class: "btn plain", "aria-expanded": "false" }, "Read post & replies");
    let loaded = false;
    open.addEventListener("click", async () => {
      if (!loaded) {
        open.disabled = true;
        try {
          const post = await api(`/api/piazza/post?class=${encodeURIComponent(x.classId)}&id=${encodeURIComponent(x.id)}`);
          const labels = { i_answer: "Instructor answer", s_answer: "Student answer", followup: "Follow-up", feedback: "Reply" };
          const content = (p) => h("section", { class: "piazza-reply" },
            labels[p.kind] ? h("h4", {}, labels[p.kind]) : null,
            p.title ? h("p", { class: "piazza-full-text" }, p.title) : null,
            p.text ? h("p", { class: "piazza-full-text" }, p.text) : null,
            p.children.map(content));
          fill(detail, content(post)); loaded = true;
        } catch (err) { toast(err.message); return; }
        finally { open.disabled = false; }
      }
      detail.hidden = !detail.hidden;
      open.setAttribute("aria-expanded", String(!detail.hidden));
      open.textContent = detail.hidden ? "Read post & replies" : "Hide discussion";
    });
    parts.push(h("article", { class: "card piazza-post" + (x.unread ? " unread" : "") },
      h("div", { class: "piazza-top" }, h("span", { class: "work-course" }, x.course),
        h("span", { class: `pz-kind k-${kindClass}` }, kind), x.number ? h("span", { class: "muted" }, `@${x.number}`) : null,
        h("span", { class: "muted" }, x.date ? fmtDateTime(x.date) : "")),
      h("h3", { class: "piazza-title" }, x.title), x.snippet ? h("p", { class: "piazza-snippet" }, x.snippet) : null,
      h("div", { class: "piazza-actions" }, open,
        h("a", { class: "btn plain", href: x.url, target: "_blank", rel: "noopener noreferrer" }, "Open on Piazza ↗")), detail));
  }
  if (d.more) parts.push(h("button", { type: "button", class: "btn", disabled: P.loading, onclick: () => loadPiazza(false, false, true) }, "Load older posts"));
  fill(body, parts);
}

function renderPiazzaEmails() {
  const body = $("piazza-body"), P = state.piazza, d = P.data;
  if (!d) {
    $("view-sub").textContent = P.error ? "" : "Διαβάζω τα email του Piazza…";
    return fill(body, P.error ? h("div", { class: "state" }, h("p", null, P.error), h("button", { class: "btn primary", onclick: () => loadPiazza(true) }, "Ξανά"))
      : h("div", { class: "state" }, h("div", { class: "spinner" }), "Διαβάζω τα email του Piazza…"));
  }
  const q = state.query;
  const items = d.items.filter((x) => (!P.cls || x.classId === P.cls) &&
    (!q || `${x.title} ${x.course} ${x.snippet} ${x.posts.map((p) => p.title).join(" ")}`.toLowerCase().includes(q)));
  const unread = d.items.filter((x) => x.unread).length;
  $("view-sub").textContent = d.items.length ? `${d.items.length} ειδοποιήσεις${unread ? ` · ${unread} αδιάβαστες` : ""} · ${d.classes.length} μαθήματα` : "Από τα email του Piazza";
  const parts = [];
  if (d.classes.length) {
    parts.push(h("div", { class: "piazza-classes" },
      h("button", { type: "button", class: "chip" + (!P.cls ? " on" : ""), onclick: () => { P.cls = ""; renderPiazza(); } }, "Όλα"),
      d.classes.map((c) => h("span", { class: "chip-pair" },
        h("button", { type: "button", class: "chip" + (P.cls === c.id ? " on" : ""), style: `--h:${courseHue(c.id)}`, onclick: () => { P.cls = c.id; renderPiazza(); } }, c.name),
        h("a", { class: "chip ext", href: c.url, target: "_blank", rel: "noopener noreferrer", title: `Το ${c.name} στο Piazza` }, "↗")))));
  }
  if (!d.items.length) {
    parts.push(h("div", { class: "card proj-empty" }, h("h3", null, "Δεν βρέθηκαν email από το Piazza"),
      h("p", null, "Η καρτέλα δείχνει τις αναρτήσεις των μαθημάτων σου από τις ειδοποιήσεις που στέλνει το Piazza. Στο Piazza, άνοιξε Account / Email Settings και διάλεξε για κάθε μάθημα ειδοποιήσεις «Real time» (ή τουλάχιστον «Smart digest») προς το email που χρησιμοποιείς εδώ."),
      h("a", { class: "btn plain", href: "https://piazza.com/account_settings", target: "_blank", rel: "noopener noreferrer" }, "Ρυθμίσεις email στο Piazza ↗")));
  } else if (!items.length) {
    parts.push(h("div", { class: "state" }, h("p", { class: "muted" }, "Τίποτα δεν ταιριάζει.")));
  }
  for (const x of items) {
    const [kindLabel, kindCls] = PIAZZA_KINDS[x.kind] || PIAZZA_KINDS.post;
    const main = x.posts[0];
    parts.push(h("div", { class: "card piazza-post" + (x.unread ? " unread" : "") },
      h("div", { class: "piazza-top" },
        h("span", { class: "work-course", style: `--h:${courseHue(x.classId || x.course)}` }, x.course),
        h("span", { class: `pz-kind k-${kindCls}` }, kindLabel),
        h("span", { class: "muted" }, x.date ? fmtDateTime(x.date) : "")),
      main && x.posts.length === 1
        ? h("a", { class: "piazza-title", href: main.url, target: "_blank", rel: "noopener noreferrer" }, x.title)
        : h("b", { class: "piazza-title" }, x.title),
      x.kind !== "digest" && x.snippet ? h("p", { class: "piazza-snippet" }, x.snippet) : null,
      x.posts.length > 1 ? h("ul", { class: "piazza-list" }, x.posts.map((p) => h("li", null,
        h("a", { href: p.url, target: "_blank", rel: "noopener noreferrer" }, p.title || `Ανάρτηση @${p.post}`)))) : null,
      h("div", { class: "piazza-actions" },
        main ? h("a", { class: "btn plain", href: main.url, target: "_blank", rel: "noopener noreferrer" }, x.posts.length > 1 ? "Άνοιγμα στο Piazza ↗" : "Άνοιγμα της ανάρτησης ↗") : null,
        h("button", { type: "button", class: "btn plain", onclick: () => {
          navigate({ type: "mail", folder: "inbox", unread: false });
          openMessage({ uid: x.uid, unread: x.unread });
          x.unread = false;
        } }, "Το email"))));
  }
  fill(body, parts);
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

function attachmentChips(msg) {
  const files = msg.attachments.map((a, i) => ({ name: a.name, sub: [sizeFmt(a.size)], src: { src: "mail", folder: msg.folder, uid: msg.uid, i } }));
  return files.map((f) => {
    const can = !!viewKind(f.name);
    return h("a", { class: "chip attach-chip", href: viewUrl(f, can ? {} : { dl: "1" }), target: can ? "_blank" : null, rel: "noopener",
      title: can ? "Προβολή (Ctrl+κλικ: νέα καρτέλα)" : "Λήψη", onclick: can ? viewOnClick(files, f) : null },
    `📎 ${f.name} · ${f.sub[0]}`);
  });
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
    msg.attachments.length ? h("div", { class: "attach" }, attachmentChips(msg)) : null);

  const parts = [head];
  if (msg.hasHtml && !forcePlain) {
    const dark = isDark() ? "1" : "0";
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

const topicKeys = { "Προπτυχιακά": "undergraduate", "Πρακτική Άσκηση": "internship" };
async function loadTopicAnnouncements(category, page = 0, refresh = false) {
  const key = topicKeys[category];
  const cacheKey = `${key}:${page}`;
  state.topicPageByCategory.set(category, page);
  if (!refresh && state.topicPages.has(cacheKey)) {
    state.topicError = "";
    if (state.view.type === "ann" && state.view.cat === category) renderAnnouncements();
    return;
  }
  if (state.topicLoading.has(cacheKey)) return;
  state.topicLoading.add(cacheKey);
  state.topicError = "";
  if (state.view.type === "ann" && state.view.cat === category) renderAnnouncements();
  try {
    const result = await api(`/api/announcements?topic=${encodeURIComponent(key)}&page=${page}${refresh ? "&refresh=1" : ""}`);
    state.topicPages.set(cacheKey, result);
  } catch (err) {
    state.topicError = err.message;
  } finally {
    state.topicLoading.delete(cacheKey);
    if (state.view.type === "ann" && state.view.cat === category) renderAnnouncements();
  }
}

function renderTopicPager(category, result, page) {
  if (!result || result.totalPages < 2) return null;
  const change = (n) => loadTopicAnnouncements(category, n);
  const start = Math.max(0, Math.min(page - 2, result.totalPages - 5));
  const end = Math.min(result.totalPages, start + 5);
  return h("nav", { class: "announcement-pager", "aria-label": "Σελίδες ανακοινώσεων" },
    h("button", { class: "btn plain", type: "button", disabled: page === 0, onclick: () => change(page - 1) }, "‹ Προηγούμενη"),
    ...Array.from({ length: end - start }, (_, i) => {
      const n = start + i;
      return h("button", { class: "btn plain" + (n === page ? " active" : ""), type: "button",
        "aria-current": n === page ? "page" : null, onclick: () => change(n) }, String(n + 1));
    }),
    h("button", { class: "btn plain", type: "button", disabled: page >= result.totalPages - 1,
      onclick: () => change(page + 1) }, "Επόμενη ›"));
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
  if (ec.courses.length && state.deadlines.status === "idle") loadDeadlines();
  if (state.inst.ditStudies && ec.courses.length && !state.timetable.data && state.timetable.status !== "loading") {
    loadTimetable(false, true);                  // marks this semester's courses in the sidebar
  }
}

// Which eClass courses the department teaches this semester (from the timetable), and which meets right now.
function courseTerm(c) {
  const tt = state.timetable.data;
  if (!tt) return null;
  const meetings = tt.blocks.filter((b) => b.course === c.code && b.forMe !== false && !b.hidden);
  const now = nowSlot();
  const live = meetings.find((b) => b.day === now.day && b.start <= now.hour && now.hour < b.end);
  return { taught: tt.courses.some((x) => x.code === c.code), live, label: tt.label };
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
    const open = state.deadlines.items ? openDeadlines(state.deadlines.items).length : 0;
    const dl = navItem({ label: "Προθεσμίες", iconPath: ICONS.assignment, active: isView({ type: "deadlines" }),
      count: open || "", onclick: () => navigate({ type: "deadlines" }) });
    dl.querySelector(".count")?.classList.add("badge");
    dl.querySelector(".item").title = state.deadlines.status === "loading" ? "Διαβάζω τις εργασίες…" : `${open} εργασίες με ανοιχτή προθεσμία, χωρίς υποβολή`;
    items.push(dl);
    const terms = new Map(ec.courses.map((c) => [c, courseTerm(c)]));
    const known = [...terms.values()].some(Boolean);
    const taught = ec.courses.filter((c) => !known || terms.get(c)?.taught);
    const other = known ? ec.courses.filter((c) => !terms.get(c)?.taught) : [];
    const label = known ? state.timetable.data.label : "";
    if (known && taught.length) items.push(h("li", { class: "nav-sub", title: `Μαθήματα στο πρόγραμμα του τμήματος · ${label}` }, "Αυτό το εξάμηνο"));
    for (const c of [...taught, ...other]) {
      if (c === other[0]) items.push(h("li", { class: "nav-sub", title: `Δεν είναι στο πρόγραμμα · ${label}` }, "Άλλα εξάμηνα"));
      const term = terms.get(c);
      const v = { type: "ann", feed: "ec:" + c.code };
      const item = navItem({ label: c.title, color: feedColor(c.code), active: isView(v),
        count: c.notifCount || "", onclick: () => { delete courseTab.tabs[c.code]; navigate(v); } });   // opens on Εργασίες
      item.querySelector(".count")?.classList.add("badge");
      item.querySelector(".item").title = [c.title, c.teacher,
        c.notifCount ? `${c.notifCount} new in eClass` : "", `${c.count || 0} announcements`,
        term && (term.taught ? `Διδάσκεται: ${term.label}` : `Δεν διδάσκεται: ${term.label}`),
        term?.live && `Τώρα: ${fmtHour(term.live.start)}–${fmtHour(term.live.end)} · ${term.live.room}`].filter(Boolean).join(" · ");
      if (term && !term.taught) item.classList.add("not-taught");
      if (term?.live) {
        item.classList.add("live");
        item.querySelector(".label").after(h("span", { class: "live-tag", title: `Τώρα στην αίθουσα ${term.live.room}` }, "τώρα"));
      }
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
    // new items of tools that have a tab here are counted on the tab; only the rest link to eClass
    !notifs.length ? h("div", { class: "muted notif-chips" }, "No new items since your last visit.")
      : notifs.some((n) => !tabForNotification(c, n)) ? h("div", { class: "notif-chips" },
        notifs.filter((n) => !tabForNotification(c, n)).map((n) =>
          h("a", { class: "notif-chip", href: eclassLink(n.path), target: "_blank", rel: "noopener", title: `Άνοιγμα: ${n.label} στο eClass` },
            n.label, h("b", {}, n.count), " ↗"))) : null,
    courseTabBar(c)));
}

function renderAnnouncements() {
  const { feed, cat } = state.view;
  renderCourseHead();
  const course = currentCourse(), tab = activeCourseTab(course);
  if (course) $("view-title").textContent = course.title;     // also after a reload, once eClass has answered
  $("ann-list").hidden = tab !== "ann";
  $("course-body").hidden = tab === "ann";
  if (tab !== "ann") {
    if (!(courseTab.view || "").startsWith(`${course.code}|${tab}|`)) {
      const dir = tab === "docs" ? courseTab.restoreDir[course.code] || "" : "";
      delete courseTab.restoreDir[course.code];
      courseTab.view = `${course.code}|${tab}|${dir}`;    // opening the course: load its default (or restored) tab
      loadCourseTab(course, tab, dir);
    }
    return renderCourseTab();
  }
  const errors = state.feedErrors.concat(state.eclass.errors);
  $("ann-errors").replaceChildren(...errors.map((e) => h("div", { class: "banner" }, `${e.feed}: ${e.error}`)));
  const inView = (a) => !feed || (feed === "eclass" ? a.eclass : a.sourceId === feed);
  if (!state.feeds.length && !state.eclass.enabled && !state.announcements.length && !feed) {
    $("view-sub").textContent = "";
    $("ann-list").replaceChildren(h("div", { class: "state" }, icon(ICONS.megaphone),
      h("p", {}, "No announcement sources yet."),
      h("button", { class: "btn primary", onclick: openFeedDialog }, "Add a Source")));
    return;
  }
  const topicKey = cat && topicKeys[cat] && state.inst.id === "uoa" ? topicKeys[cat] : "";
  const topicPage = topicKey ? (state.topicPageByCategory.get(cat) || 0) : 0;
  const topicResult = topicKey ? state.topicPages.get(`${topicKey}:${topicPage}`) : null;
  const items = (topicKey ? (topicResult?.items || []) : state.announcements.filter((a) => inView(a)
    && (!cat || (a.category || "").split(",").map((x) => x.trim()).includes(cat))))
    .filter((a) => matches(`${a.title} ${a.summary} ${a.source} ${a.category}`));
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
  if (!items.length) frag.append(h("div", { class: "state" }, topicKey && state.topicLoading.has(`${topicKey}:${topicPage}`)
    ? "Loading announcements…" : topicKey && state.topicError ? state.topicError
      : state.query ? "No matches" : "Nothing posted yet."));
  if (topicKey && topicResult?.totalPages > 1) frag.append(renderTopicPager(cat, topicResult, topicPage));
  $("ann-list").replaceChildren(frag);
  $("view-sub").textContent = topicKey && topicResult
    ? `${items.length} announcements · Page ${topicPage + 1} of ${topicResult.totalPages}`
    : `${items.length} announcement${items.length === 1 ? "" : "s"}`;
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
  if (state.inst.ditStudies) {
    items.push(navItem({ label: "Πρόγραμμα μαθημάτων", iconPath: ICONS.calendar, active: isView({ type: "timetable" }),
      onclick: () => navigate({ type: "timetable" }) }));
  }
  if (state.inst.ditStudies) {
    const n = state.lectures.data ? lectureCourses(state.lectures.data).reduce((t, c) => t + c.lectures.length, 0) : "";
    items.push(navItem({ label: "Βιντεοδιαλέξεις", iconPath: ICONS.video, active: isView({ type: "lectures" }),
      count: n, onclick: () => navigate({ type: "lectures" }) }));
  }
  if (state.inst.grades) {
    items.push(navItem({ label: "Βαθμολογίες", iconPath: ICONS.file, active: isView({ type: "grades" }),
      count: state.grades.data?.stats?.average ?? "", onclick: () => navigate({ type: "grades" }) }));
  }
  $("studies-head").hidden = !items.length;
  $("nav-studies").replaceChildren(...items);
}

// ---------- uniflix lectures ----------
const GR_DAYS = ["Κυρ", "Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ"];
const GR_MONTHS = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
const player = { list: [], index: -1, course: null, lastSave: 0, watchdog: 0, retried: false };

let lecturesReq = 0;
async function loadLectures(refresh = false) {
  const L = state.lectures, id = ++lecturesReq;
  L.status = "loading";
  $("view-sub").textContent = "Reading uniflix…";
  $("lectures-body").replaceChildren(h("div", { class: "state" }, h("div", { class: "spinner" }),
    "Finding the recorded lectures of your eClass courses…"));
  const qs = new URLSearchParams();
  if (L.year) qs.set("y", L.year);
  if (refresh) qs.set("refresh", "1");
  try {
    const r = await api("/api/uniflix" + (qs.toString() ? "?" + qs : ""));
    if (id !== lecturesReq) return;
    Object.assign(L, { status: "ready", data: r, error: "" });
  } catch (err) {
    if (id !== lecturesReq) return;
    Object.assign(L, { status: "error", error: err.message });
  }
  renderStudiesNav();
  if (state.view.type === "lectures") renderLectures();
}

function lectureDate(iso) {
  if (!iso) return { day: "", num: "", mon: "", year: "" };
  const d = new Date(iso + "T12:00:00");
  return { day: GR_DAYS[d.getDay()], num: d.getDate(), mon: GR_MONTHS[d.getMonth()], year: d.getFullYear() };
}

function lectureLabel(lec, course, n) {
  const same = !lec.title || lec.title.trim().toLowerCase() === course.title.trim().toLowerCase()
    || course.uniflix.some((u) => u.title.trim().toLowerCase() === lec.title.trim().toLowerCase());
  return same ? `Διάλεξη ${n}` : lec.title;
}

function courseHue(code) {
  let x = 0;
  for (const ch of code) x = (x * 31 + ch.charCodeAt(0)) % 360;
  return x;
}

function savedPosition(id) {
  try { return JSON.parse(localStorage.getItem("uf:" + id) || "null"); } catch { return null; }
}

const MIN_LECTURE_SECONDS = 60;          // shorter recordings are empty captures (uniflix warns about them)
const durationSeconds = (s) => (s || "").split(":").reduce((t, x) => t * 60 + (Number(x) || 0), 0);

// The student's courses with empty recordings left out, named the way uniflix spells them when unambiguous.
function lectureCourses(d) {
  return d.courses.map((c) => ({ ...c,
    name: c.uniflix.length === 1 ? c.uniflix[0].title : c.title,
    lectures: c.lectures.filter((l) => !l.duration || durationSeconds(l.duration) >= MIN_LECTURE_SECONDS) }))
    .filter((c) => c.lectures.length);
}

function renderLectures() {
  const L = state.lectures, d = L.data;
  const body = $("lectures-body");
  if (L.status === "loading") return;
  if (L.status === "error") {
    $("view-sub").textContent = "";
    return body.replaceChildren(h("div", { class: "state" },
      h("p", { class: "error" }, L.error),
      h("button", { class: "btn primary", onclick: () => loadLectures(true) }, "Try again")));
  }
  if (!d) return;
  const q = state.query;
  const courses = lectureCourses(d);
  const all = courses.reduce((t, c) => t + c.lectures.length, 0);
  const hidden = d.courses.reduce((t, c) => t + c.lectures.length, 0) - all;
  $("view-sub").textContent = `uniflix · ${all} διαλέξεις σε ${courses.length} μαθήματα`;

  // academic year + course filters
  const years = d.years.filter((y) => y.value !== "a");
  const yearSel = h("select", { class: "year-select", "aria-label": "Ακαδημαϊκό έτος",
    onchange: (e) => { L.year = e.target.value; L.course = ""; loadLectures(); } },
    years.map((y, i) => h("option", { value: i === 0 ? "" : y.value, selected: (L.year || "") === (i === 0 ? "" : y.value) }, y.label)),
    h("option", { value: "a", selected: L.year === "a" }, "Όλα τα έτη"));
  const chips = h("div", { class: "sem-picker course-picker", role: "group", "aria-label": "Μάθημα" },
    h("button", { "aria-pressed": String(!L.course), onclick: () => { L.course = ""; renderLectures(); } }, `Όλα · ${all}`),
    courses.map((c) => h("button", { "aria-pressed": String(L.course === c.code),
      onclick: () => { L.course = c.code; renderLectures(); } }, `${c.name} · ${c.lectures.length}`)));
  const head = h("div", { class: "lectures-head" }, yearSel,
    h("a", { class: "btn plain", href: d.home, target: "_blank", rel: "noopener noreferrer" }, "uniflix.uoa.gr ↗"));

  const sections = [];
  for (const c of courses) {
    if (L.course && L.course !== c.code) continue;
    const ordered = [...c.lectures].reverse();               // oldest first, for numbering
    const numbers = new Map(ordered.map((lec, i) => [lec.id, i + 1]));
    const shown = c.lectures.filter((lec) => !q || `${lectureLabel(lec, c, numbers.get(lec.id))} ${lec.title} ${lec.teacher} ${lec.date} ${c.title}`
      .toLowerCase().includes(q));
    if (!shown.length) continue;
    const hue = courseHue(c.code);
    sections.push(h("section", { class: "lecture-course" },
      h("h3", null, h("span", { class: "swatch", style: `--h:${hue}` }), c.name,
        h("span", { class: "muted" }, ` · ${shown.length}`)),
      h("div", { class: "lecture-grid" }, shown.map((lec) => lectureCard(lec, c, numbers.get(lec.id), hue, shown)))));
  }
  if (!courses.length) {
    sections.push(h("div", { class: "state" }, h("p", null, "Δεν βρέθηκαν βιντεοδιαλέξεις για τα μαθήματά σου σε αυτό το ακαδημαϊκό έτος."),
      L.year !== "a" ? h("button", { class: "btn plain", onclick: () => { L.year = "a"; loadLectures(); } }, "Δες όλα τα έτη") : null));
  } else if (!sections.length) {
    sections.push(h("div", { class: "state" }, h("p", { class: "muted" }, "Καμία διάλεξη δεν ταιριάζει με την αναζήτηση.")));
  }
  const missing = d.unmatched.length
    ? h("p", { class: "muted lectures-missing" }, "Χωρίς καταγραφές στο uniflix: " + d.unmatched.join(", ")) : null;
  const skipped = hidden
    ? h("p", { class: "muted lectures-missing" }, `${hidden} κενές καταγραφές (κάτω από 1 λεπτό) δεν εμφανίζονται.`) : null;
  const codecNote = canPlayH264() ? "" : h("p", { class: "notice codec-note" }, noH264Message());
  body.replaceChildren(codecNote, head, chips, ...sections, missing || "", skipped || "");
}

function lectureCard(lec, course, n, hue, list) {
  const dt = lectureDate(lec.date);
  const pos = savedPosition(lec.id);
  const pct = pos && pos.d ? Math.min(100, Math.round((pos.t / pos.d) * 100)) : 0;
  const label = lectureLabel(lec, course, n);
  const prefetch = () => { videoLink(lec.id).catch(() => {}); };
  return h("button", { class: "lecture-card", type: "button", title: `Αναπαραγωγή: ${label}`,
    onclick: () => openPlayer(list, list.indexOf(lec), course), onpointerenter: prefetch, onfocus: prefetch },
    h("div", { class: "thumb", style: `--h:${hue}` },
      h("div", { class: "thumb-date" }, h("b", null, dt.num), h("span", null, `${dt.mon} ${dt.year}`)),
      h("span", { class: "play" }, icon(ICONS.play)),
      lec.duration ? h("span", { class: "dur" }, lec.duration.replace(/^00:/, "")) : null,
      lec.subs ? h("span", { class: "cc-badge", title: "Έχει υπότιτλους" }, "CC") : null,
      pct ? h("span", { class: "progress", style: `width:${pct}%`, title: `Έχεις δει ${pct}%` }) : null),
    h("div", { class: "meta" },
      h("div", { class: "t" }, label, pct >= 95 ? h("span", { class: "seen", title: "Το έχεις δει" }, " ✓") : null),
      h("div", { class: "s" }, [dt.day && `${dt.day} ${dt.num} ${dt.mon}`, lec.teacher].filter(Boolean).join(" · ")),
      lec.room ? h("div", { class: "s faint" }, lec.room) : null));
}

// ---------- subtitles (generated locally with Whisper) ----------
const subs = { track: null, lid: null, next: 0, timer: 0, status: null, show: true };
try { subs.show = localStorage.getItem("uf:cc") !== "0"; } catch {}

function subsTrack() {
  if (!subs.track) subs.track = $("player-video").addTextTrack("subtitles", "Ελληνικά", "el");
  if (subs.track.mode === "disabled") subs.track.mode = "hidden";        // cues are only readable when enabled
  return subs.track;
}

function resetSubs(lid) {
  clearTimeout(subs.timer);
  const tr = subsTrack();
  while (tr.cues && tr.cues.length) tr.removeCue(tr.cues[0]);
  tr.mode = "hidden";                            // also clears a cue the browser is still painting
  Object.assign(subs, { lid, next: 0, status: null });
  renderSubs();
  if (lid) pollSubs();
}

async function pollSubs() {
  const lid = subs.lid;
  if (!lid || $("player").hidden) return;
  let r = null;
  try { r = await api(`/api/uniflix/subtitles?id=${encodeURIComponent(lid)}&since=${subs.next}`); } catch {}
  if (lid !== subs.lid) return;
  if (r) {
    const tr = subsTrack();
    for (const c of r.cues) tr.addCue(new VTTCue(c.s, c.e, c.t));
    subs.next = r.next;
    subs.status = r;
    tr.mode = subs.show && subs.next ? "showing" : "hidden";
    if (r.status === "done") {
      const lec = player.list[player.index];
      if (lec && lec.id === lid) lec.subs = true;
    }
  }
  renderSubs();
  const active = r && (r.status === "queued" || r.status === "running");
  if (active || !r) subs.timer = setTimeout(pollSubs, active ? 5000 : 15000);
}

async function changeSubs(method, body) {
  const lid = subs.lid;
  try {
    await api(method === "DELETE" ? `/api/uniflix/subtitles?id=${encodeURIComponent(lid)}` : "/api/uniflix/subtitles",
      { method, body: method === "DELETE" ? {} : { id: lid, ...body } });
  } catch (err) { toast(err.message); }
  clearTimeout(subs.timer);
  if (lid === subs.lid) pollSubs();
}

const fmtClock = (s) => {
  s = Math.floor(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
};

function renderSubs() {
  const st = subs.status, line = $("player-subs"), cc = $("player-cc");
  const hasCues = subs.next > 0;
  cc.setAttribute("aria-pressed", String(subs.show && hasCues));
  cc.disabled = !hasCues;
  cc.title = hasCues ? (subs.show ? "Απόκρυψη υποτίτλων (C)" : "Εμφάνιση υποτίτλων (C)") : "Δεν υπάρχουν υπότιτλοι ακόμα";
  if (!st || (st.status === "done" && hasCues)) return (line.hidden = true);
  if (st.status === "done") {
    line.replaceChildren(h("span", null, "Δεν αναγνωρίστηκε ομιλία σε αυτή τη διάλεξη."));
    return (line.hidden = false);
  }
  const course = player.course ? player.course.name : "";
  const parts = [];
  if (st.status === "unavailable") {
    parts.push(h("span", null, "Υπότιτλοι: χρειάζεται το Whisper (δες το README)."));
  } else if (st.status === "none" && st.groq) {
    parts.push(h("span", null, "Χωρίς υπότιτλους."),
      h("button", { type: "button", class: "btn plain", title: "Μεταγραφή από το Groq (λίγα λεπτά)· αν τελειώσει το δωρεάν όριο, συνεχίζει σε αυτόν τον υπολογιστή",
        onclick: () => changeSubs("POST", { quality: "accurate", topic: course }) }, "Δημιουργία υποτίτλων"));
  } else if (st.status === "none") {
    parts.push(h("span", null, "Χωρίς υπότιτλους."),
      h("button", { type: "button", class: "btn plain", title: "Μοντέλο small: ~1,5× τη διάρκεια της διάλεξης σε αυτόν τον υπολογιστή",
        onclick: () => changeSubs("POST", { quality: "accurate", topic: course }) }, "Δημιουργία υποτίτλων"),
      h("button", { type: "button", class: "btn plain faint", title: "Μοντέλο base: περίπου όσο η διάρκεια, λιγότερο ακριβείς",
        onclick: () => changeSubs("POST", { quality: "fast", topic: course }) }, "γρήγοροι"));
  } else if (st.status === "queued") {
    parts.push(h("span", null, `Υπότιτλοι σε αναμονή${st.position > 1 ? ` (θέση ${st.position})` : ""}…`),
      h("button", { type: "button", class: "btn plain", onclick: () => changeSubs("DELETE") }, "Ακύρωση"));
  } else if (st.status === "running") {
    const pct = st.duration ? Math.min(100, Math.round((st.done / st.duration) * 100)) : 0;
    const engine = st.engine === "groq" ? " (Groq)" : st.engine === "local" ? " (σε αυτόν τον υπολογιστή)" : "";
    parts.push(h("span", null, !st.duration ? "Λήψη ήχου για τους υπότιτλους…"
        : st.stage === "download" ? `Λήψη βίντεο για τους υπότιτλους… ${pct}%`
        : `Δημιουργία υποτίτλων${engine}… ${pct}% · έτοιμοι ως ${fmtClock(st.done)}`),
      h("span", { class: "subs-bar" }, h("i", { style: `width:${pct}%` })),
      h("button", { type: "button", class: "btn plain", onclick: () => changeSubs("DELETE") }, "Ακύρωση"));
    if (st.notice) parts.push(h("span", { class: "faint" }, st.notice));
  } else if (st.status === "error") {
    parts.push(h("span", { class: "subs-error" }, `Οι υπότιτλοι απέτυχαν: ${st.error}`),
      h("button", { type: "button", class: "btn plain", onclick: () => changeSubs("DELETE").then(() => changeSubs("POST", { quality: "accurate", topic: course })) }, "Ξανά"));
  }
  line.replaceChildren(...parts);
  line.hidden = false;
}

function toggleSubs() {
  if (!subs.next) return;
  subs.show = !subs.show;
  try { localStorage.setItem("uf:cc", subs.show ? "1" : "0"); } catch {}
  subsTrack().mode = subs.show ? "showing" : "hidden";
  renderSubs();
}

// ---------- AI instructor: lecture summary with timestamps, and questions, answered by Claude ----------
// The server prepares the transcript (Groq, or Whisper on this computer) and the slide frames part by part, and
// asks Claude through Claude Code with the student's own Claude plan. Each part's summary shows up as soon as
// it's written; the parts still on their way show what they're waiting for.
const ai = { lid: null, status: null, timer: 0, sig: "", els: [], tab: "sum", chat: null, chatTimer: 0, chatSig: "",
  input: null, settings: null };
let sideMode = "fx";
try {
  sideMode = localStorage.getItem("uf:sidemode") === "ai" ? "ai" : "fx";
  ai.tab = localStorage.getItem("uf:aitab") === "chat" ? "chat" : "sum";
} catch {}
const AI_MODELS = [["", "Προεπιλογή λογαριασμού"], ["fable", "Fable 5.1 · το πιο ικανό"], ["opus", "Opus 5.5"],
  ["sonnet", "Sonnet 5.5 · γρήγορο"], ["haiku", "Haiku 5.5 · πολύ γρήγορο"]];
const AI_EFFORTS = [["", "Αυτόματη"], ["low", "Λίγη"], ["medium", "Μέτρια"], ["high", "Πολλή"], ["xhigh", "Πολύ πολλή"], ["max", "Μέγιστη"]];
const AI_QUESTIONS = ["Εξήγησέ μου απλά το πιο δύσκολο σημείο της διάλεξης", "Τι από αυτή τη διάλεξη μπορεί να πέσει στις εξετάσεις;",
  "Δώσε μου 3 ασκήσεις εξάσκησης με λύσεις"];

function resetAI(lid) {
  clearTimeout(ai.timer);
  clearTimeout(ai.chatTimer);
  Object.assign(ai, { lid, status: null, sig: "", els: [], chat: null, chatSig: "", input: null });
  renderSide();
  if (lid) { pollAI(); pollChat(); }
  if (lid && !ai.settings) api("/api/ai/settings").then((s) => { ai.settings = s; if (sideMode === "ai") renderAI(); }).catch(() => {});
}

const aiRunning = () => ai.status?.status === "running";

async function pollAI() {
  const lid = ai.lid;
  if (!lid || $("player").hidden) return;
  let r = null;
  try { r = await api(`/api/uniflix/summary?id=${encodeURIComponent(lid)}`); } catch {}
  if (lid !== ai.lid) return;
  const was = ai.status;
  if (r) ai.status = r;
  // the transcript also becomes the subtitles: refresh them while it's being written and when it's done
  if (r && (r.stage === "transcribe" || (was?.status === "running" && r.status !== "running"))) { clearTimeout(subs.timer); pollSubs(); }
  const sig = r ? JSON.stringify([r.status, r.error, r.parts?.map((p) => p.state), r.partsComplete, r.summary?.title,
    r.summary?.sections?.length, r.engine, r.notice, r.groq, r.stage === "queued"]) : ai.sig;
  if (sig !== ai.sig) {
    ai.sig = sig;
    if (ai.chat && !ai.chat.ready && !ai.chat.busy) pollChat();     // questions open up once there's a transcript
    if (sideMode === "ai" && ai.tab === "sum") renderAI();
  } else if (sideMode === "ai" && ai.tab === "sum") {
    updateAIProgress();
  }
  renderAIButton();
  if (!r || r.status === "running") ai.timer = setTimeout(pollAI, r ? 2500 : 15000);
}

async function changeAI(method, body) {
  const lid = ai.lid;
  try {
    ai.status = await api(method === "DELETE" ? `/api/uniflix/summary?id=${encodeURIComponent(lid)}` : "/api/uniflix/summary",
      { method, body: method === "DELETE" ? {} : { id: lid, ...body } });
  } catch (err) { toast(err.message); }
  if (lid !== ai.lid) return;
  ai.sig = "";
  clearTimeout(ai.timer);
  pollAI();
}

function lectureContext() {
  const sub = $("player-sub").textContent;
  return { course: player.course ? player.course.name : "",
    lecture: $("player-title").textContent.split(" · ").slice(1).join(" · ") + (sub ? ` (${sub})` : "") };
}

const startAI = (redo = false) => changeAI("POST", { redo, ...lectureContext() });

function renderAIButton() {
  const b = $("player-ai");
  b.setAttribute("aria-pressed", String(sideMode === "ai" && $("player").querySelector(".player-sheet").classList.contains("side-open")));
  b.classList.toggle("busy", aiRunning() || !!ai.chat?.busy);
  b.classList.toggle("ready", ai.status?.status === "done");
}

function seekTo(t) {
  const video = $("player-video");
  if (!video.getAttribute("src")) return;
  video.currentTime = t;
  if (video.paused) startPlayback();
}

const timeButton = (t, label) => h("button", { type: "button", class: "ai-time", title: "Πήγαινε σε αυτό το σημείο", onclick: () => seekTo(t) }, label || fmtClock(t));

function renderSide() {
  if (sideMode === "ai") renderAI(); else renderFx();
  renderAIButton();
}

async function saveAISettings(change) {
  const next = { ...(ai.settings || { provider: "claude", model: "", effort: "" }), ...change };
  try {
    ai.settings = await api("/api/ai/settings", { method: "POST", body: next });
    toast("Οι ρυθμίσεις του AI αποθηκεύτηκαν");
  } catch (err) { toast(err.message); }
  if (!$("player").hidden) renderAI();
  renderGlobalAISettings();
  ai.sig = "";
  if (ai.lid) { clearTimeout(ai.timer); pollAI(); }
}

// CLI model presets checked against the official provider documentation.
const AI_PROVIDER_MODELS = {
  claude: AI_MODELS,
  chatgpt: [["", "Προεπιλογή CLI"], ["gpt-6.1-sol", "GPT-6.1 Sol"],
    ["gpt-6.1-terra", "GPT-6.1 Terra"], ["gpt-6-astra", "GPT-6 Astra"],
    ["gpt-6-luna", "GPT-6 Luna"], ["gpt-6-sol", "GPT-6 Sol"]],
  gemini: [["", "Προεπιλογή CLI (Auto)"], ["gemini-3-pro-preview", "Gemini 3 Pro · Preview"],
    ["gemini-3-flash-preview", "Gemini 3 Flash · Preview"],
    ["gemini-2.5-pro", "Gemini 2.5 Pro"], ["gemini-2.5-flash", "Gemini 2.5 Flash"]],
  antigravity: [["", "Προεπιλογή Antigravity"], ["gemini-4-argon-high", "Gemini 4 Argon · High"],
    ["gemini-4-argon-medium", "Gemini 4 Argon · Medium"], ["gemini-3.8-flash-high", "Gemini 3.8 Flash · High"],
    ["gemini-3.8-flash-medium", "Gemini 3.8 Flash · Medium"], ["gemini-3.1-pro-high", "Gemini 3.1 Pro · High"]],
};

const AI_PROVIDERS = [["claude", "Claude"], ["gemini", "Gemini"], ["chatgpt", "ChatGPT · Codex CLI"],
  ["antigravity", "Google Antigravity · agy"]];
const aiProviderName = (provider) => AI_PROVIDERS.find(([key]) => key === provider)?.[1] || "Claude";

function aiSettingsRow() {
  const st = ai.settings || { provider: "claude", model: "", effort: "" };
  const select = (label, options, key, title) => h("label", { class: "ai-select", title },
    h("span", null, label),
    h("select", { onchange: (e) => {
      const value = e.target.value;
      if (key === "provider") saveAISettings({ provider: value, ...(st.profiles?.[value] || { model: "", effort: "" }) });
      else saveAISettings({ [key]: value });
    } }, options.map(([v, text]) => h("option", { value: v, selected: st[key] === v }, text))));
  const models = AI_PROVIDER_MODELS[st.provider] || AI_MODELS;
  const efforts = { claude: AI_EFFORTS, chatgpt: AI_EFFORTS.filter(([v]) => v !== "max"),
    gemini: [], antigravity: AI_EFFORTS.filter(([v]) => ["", "low", "medium", "high"].includes(v)) };
  const custom = !models.some(([id]) => id === (st.model || ""));
  const customInput = h("input", { value: custom ? st.model : "", hidden: !custom,
    placeholder: "Model ID", "aria-label": "Άλλο μοντέλο AI", maxlength: 120,
    onchange: (e) => saveAISettings({ model: e.target.value.trim() }) });
  const modelPicker = h("label", { class: "ai-select" }, h("span", null, "Μοντέλο"),
    h("select", { "aria-label": "Μοντέλο AI", onchange: (e) => {
      const isCustom = e.target.value === "__custom__";
      customInput.hidden = !isCustom;
      if (isCustom) customInput.focus();
      else saveAISettings({ model: e.target.value });
    } }, [...models, ["__custom__", "Άλλο μοντέλο…"]].map(([id, label]) =>
      h("option", { value: id, selected: custom ? id === "__custom__" : id === (st.model || "") }, label))), customInput);
  return h("div", { class: "ai-settings" },
    select("AI", AI_PROVIDERS, "provider", "Ισχύει σε όλη την εφαρμογή: ενημέρωση, σύνοψη, ερωτήσεις και κάρτες"),
    modelPicker,
    efforts[st.provider]?.length ? select("Σκέψη", efforts[st.provider], "effort", "Επίπεδο σκέψης για το επιλεγμένο μοντέλο") : null);
}

async function openGlobalAISettings() {
  try { ai.settings = await api("/api/ai/settings"); }
  catch (err) { toast(err.message); return; }
  $("ai-settings-dialog").hidden = false;
  renderGlobalAISettings();
  $("ai-settings-body").querySelector("select")?.focus();
}

function renderGlobalAISettings() {
  const body = $("ai-settings-body");
  if (!body || $("ai-settings-dialog").hidden) return;
  const st = ai.settings;
  body.replaceChildren(aiSettingsRow(),
    h("p", { class: "muted" }, "Η επιλογή ισχύει για όλες τις νέες ενημερώσεις, συνόψεις, ερωτήσεις και κάρτες. Οι υπάρχουσες απαντήσεις διατηρούνται. Μια εργασία που τρέχει ολοκληρώνεται με το AI που ξεκίνησε."),
    h("p", { class: "muted" }, "Η πρόσβαση στα μοντέλα εξαρτάται από τον λογαριασμό και την έκδοση του CLI σου. Για GPT-6.1 Terra χρειάζεται Codex CLI 0.159.0 ή νεότερο. Τα μοντέλα Preview μπορεί να αλλάξουν."),
    h("p", { class: "muted" }, "Στον Βοηθό AI, το GPT-6 Luna έχει δημόσια αναζήτηση web και πρόσβαση στα ελεγχόμενα εργαλεία ανάγνωσης των συνδεδεμένων δεδομένων σου. Εντολές κελύφους και πρόσβαση σε αυθαίρετα τοπικά αρχεία παραμένουν απενεργοποιημένες."),
    h("ul", null, AI_PROVIDERS.map(([key, label]) => h("li", null,
      `${label}: ${st.providers?.[key]?.installed ? "CLI εγκατεστημένο" : "CLI δεν βρέθηκε"}`))),
    h("p", { class: "muted" }, "Συνδέσου πρώτα στο τερματικό: claude, gemini, codex login ή agy. Το κείμενο και οι εικόνες των επιλεγμένων πηγών στέλνονται στον πάροχο που διάλεξες, με τον λογαριασμό σου. Η εγκατάσταση του CLI δεν επιβεβαιώνει τη σύνδεση ή την πρόσβαση σε μοντέλα."),
    h("p", { class: "muted" }, "Υπότιτλοι: παραμένουν Whisper / Groq. Το Google Calendar χρησιμοποιεί σύνδεσμο Claude: για Gemini / ChatGPT χρησιμοποίησε τη λήψη .ics."));
}

function renderAI() {
  const side = $("player-side");
  const scroll = side.scrollTop;
  ai.els = [];
  const tabs = h("div", { class: "ai-tabs", role: "tablist" }, [["sum", "Σύνοψη"], ["chat", "Ερωτήσεις"]].map(([k, label]) =>
    h("button", { type: "button", role: "tab", "aria-selected": String(ai.tab === k), onclick: () => {
      ai.tab = k;
      try { localStorage.setItem("uf:aitab", k); } catch {}
      renderAI();
      if (k === "chat") { ai.input?.focus(); if (!ai.chat?.busy) pollChat(); }
    } }, label, k === "chat" && ai.chat?.busy ? h("span", { class: "ai-dot" }) : null)));
  const body = ai.tab === "chat" ? renderChat() : renderSummaryTab();
  side.replaceChildren(h("h3", null, "AI καθηγητής"), tabs, aiSettingsRow(), ...body);
  side.scrollTop = scroll;
  if (ai.tab === "sum") updateAIProgress();
  else scrollChat();
}

function renderSummaryTab() {
  const st = ai.status;
  if (!st) return [h("div", { class: "spinner ai-spin" })];
  if (st.status === "unavailable") {
    return [h("p", { class: "ai-note" }, !st.claude
      ? "Χρειάζεται το επιλεγμένο AI CLI εγκατεστημένο και συνδεδεμένο (ρυθμίσεις AI στο μενού)."
      : "Χρειάζεται το Whisper για την απομαγνητοφώνηση (δες το README).")];
  }
  if (st.status === "none") {
    return [h("p", { class: "ai-lead" }, "Ο AI καθηγητής βλέπει τις διαφάνειες και διαβάζει τι ειπώθηκε, και γράφει σύνοψη της διάλεξης ανά ενότητα, με χρονοσημάνσεις που σε πάνε στο σημείο του βίντεο. Κάθε κομμάτι εμφανίζεται μόλις γραφτεί."),
      h("button", { type: "button", class: "btn primary ai-go", onclick: () => startAI() }, icon(ICONS.sparkle),
        st.resume ? `Συνέχεια (${st.resume} κομμάτια έτοιμα)` : "Δημιουργία σύνοψης"),
      h("p", { class: "ai-note" }, st.subs
        ? "Η απομαγνητοφώνηση υπάρχει ήδη (υπότιτλοι), οπότε θέλει μόνο λίγα λεπτά."
        : st.groq ? "Απομαγνητοφώνηση από το Groq: τα πρώτα κομμάτια σε λίγα λεπτά."
          : "Χωρίς κλειδί Groq η απομαγνητοφώνηση γίνεται σε αυτόν τον υπολογιστή και αργεί (το πρώτο κομμάτι σε ~15 λεπτά)."),
      groqBox(st.groq),
      h("p", { class: "ai-note faint" }, "Στο επιλεγμένο AI στέλνεται το κείμενο της διάλεξης και λίγες εικόνες από κάθε κομμάτι μέσω του CLI του, με τον λογαριασμό σου. Κάθε σύνοψη αποθηκεύεται.")];
  }
  const out = [];
  if (st.status === "running") {
    out.push(h("div", { class: "ai-progress" },
      h("div", { class: "row" }, h("span", { class: "spinner" }), h("span", { id: "ai-progress" }),
        h("button", { type: "button", class: "link-btn", onclick: () => changeAI("DELETE") }, "Ακύρωση")),
      h("span", { class: "subs-bar" }, h("i", { id: "ai-bar-dl", class: "dl" }), h("i", { id: "ai-bar" }))));
    if (st.notice) out.push(h("p", { class: "ai-note warn" }, st.notice));
  } else if (st.status === "error") {
    out.push(h("p", { class: "ai-note warn" }, `Η σύνοψη σταμάτησε: ${st.error}`),
      h("button", { type: "button", class: "btn primary ai-go", onclick: () => startAI() },
        st.summary?.sections?.length ? "Συνέχεια από εκεί που σταμάτησε" : "Ξανά"));
  }
  out.push(...renderSummary(st.summary || {}, st));
  return out;
}

const PART_STATES = { transcribe: "Απομαγνητοφώνηση…", queued: "Σε αναμονή για το AI", writing: "Το AI το γράφει…" };

function updateAIProgress() {
  const st = ai.status, txt = $("ai-progress");
  if (!st || !txt || st.status !== "running") return;
  const d = st.duration || 0, pct = (x) => (d ? Math.min(100, Math.round((x / d) * 100)) : 0);
  const parts = st.parts || [], done = parts.filter((p) => p.state === "done").length;
  const bits = [];
  if (st.stage === "queued") bits.push("Σε αναμονή: τελειώνει άλλη απομαγνητοφώνηση");
  else if (!st.partsComplete && st.downloaded < d) bits.push(`Λήψη ${pct(st.downloaded)}%`);
  if (st.stage === "transcribe" && st.done < d) bits.push(`κείμενο ως ${fmtClock(st.done)}${st.engine === "groq" ? " (Groq)" : st.engine === "local" ? " (τοπικά)" : ""}`);
  if (parts.length) bits.push(`${done}/${st.partsComplete ? parts.length : "…"} κομμάτια`);
  if (st.stage === "final") bits.push("γράφεται η γενική σύνοψη");
  txt.textContent = bits.join(" · ") || "Ξεκινά…";
  const bar = $("ai-bar"), dl = $("ai-bar-dl");
  if (dl) dl.style.width = `${st.partsComplete ? 100 : pct(st.downloaded)}%`;
  if (bar) bar.style.width = `${st.partsComplete && parts.length ? Math.round((done / parts.length) * 100) : d && parts.length ? pct(parts.filter((p) => p.state === "done").reduce((m, p) => Math.max(m, p.end), 0)) : 0}%`;
}

function groqBox(hasKey) {
  if (hasKey) {
    return h("p", { class: "ai-note faint" }, "Κλειδί Groq: αποθηκευμένο. ",
      h("button", { type: "button", class: "link-btn", onclick: async () => {
        try { await api("/api/groq", { method: "DELETE", body: {} }); } catch (err) { toast(err.message); }
        ai.sig = "";
        pollAI();
      } }, "Αφαίρεση"));
  }
  const input = h("input", { type: "password", placeholder: "gsk_…", autocomplete: "off", spellcheck: "false", "aria-label": "Κλειδί Groq" });
  const save = h("button", { type: "submit", class: "btn plain" }, "Αποθήκευση");
  return h("form", { class: "ai-groq", onsubmit: async (e) => {
    e.preventDefault();
    save.disabled = true;
    try {
      await api("/api/groq", { method: "POST", body: { key: input.value } });
      toast("Το κλειδί Groq αποθηκεύτηκε");
      ai.sig = "";
      pollAI();
    } catch (err) { toast(err.message); save.disabled = false; }
  } },
    h("label", null, "Γρήγορη απομαγνητοφώνηση με Groq (δωρεάν): φτιάξε κλειδί στο ",
      h("a", { href: "https://console.groq.com/keys", target: "_blank", rel: "noopener noreferrer" }, "console.groq.com/keys"),
      " και επικόλλησέ το εδώ."),
    h("div", { class: "row" }, input, save));
}

function renderSummary(sum, st) {
  const lid = ai.lid, running = st?.status === "running";
  const frame = (f) => h("figure", { class: "ai-frame" },
    h("img", { src: `/api/uniflix/summary/frame?id=${encodeURIComponent(lid)}&f=${encodeURIComponent(f.id)}`, alt: f.caption, loading: "lazy",
      title: "Πήγαινε σε αυτό το σημείο", onclick: () => seekTo(sum.frames?.[f.id] ?? 0) }),
    h("figcaption", null, f.caption),
    f.text ? h("p", { class: "ai-slide-text" }, f.text) : null);
  const sections = sum.sections || [];
  const out = [];
  if (sum.title) {
    const copyBtn = h("button", { type: "button", class: "ai-icon", title: "Αντιγραφή σύνοψης", "aria-label": "Αντιγραφή σύνοψης",
      onclick: () => copyText(summaryText(sum), copyBtn) }, icon(ICONS.copy));
    out.push(h("div", { class: "ai-top" }, h("h4", null, sum.title), copyBtn,
      st?.status === "done" ? h("button", { type: "button", class: "ai-icon", title: "Νέα σύνοψη (με το τωρινό μοντέλο)", "aria-label": "Νέα σύνοψη", onclick: () => {
        if (confirm("Να γραφτεί ξανά η σύνοψη; Η τωρινή θα αντικατασταθεί.")) startAI(true);
      } }, "↻") : null),
      h("p", { class: "ai-overview" }, sum.overview));
  } else if (running && sections.length) {
    out.push(h("div", { class: "ai-sec loading" }, h("div", { class: "ai-sec-head" }, h("strong", null, "Γενική σύνοψη")),
      h("p", null, "Γράφεται όταν τελειώσουν όλα τα κομμάτια.")));
  }
  for (const sec of sections) {
    const el = h("section", { class: "ai-sec" },
      h("div", { class: "ai-sec-head" }, timeButton(sec.start), h("strong", null, sec.title)),
      h("p", null, sec.summary),
      sec.points.length ? h("ul", null, sec.points.map((p) => h("li", null, p))) : null,
      sec.frames.map(frame));
    ai.els.push([sec.start, el]);
    out.push(el);
  }
  // the parts still on their way
  const parts = st?.parts || [];
  if (running || st?.status === "error") {
    for (const p of parts) {
      if (p.state === "done") continue;
      out.push(h("div", { class: `ai-sec loading${p.state === "writing" ? " writing" : ""}` },
        h("div", { class: "ai-sec-head" }, timeButton(p.start, `${fmtClock(p.start)}–${fmtClock(p.end)}`),
          h("strong", null, st.status === "error" ? "Δεν γράφτηκε" : PART_STATES[p.state] || "")),
        st.status === "error" ? null : h("div", { class: "ai-skel" }, h("i"), h("i"), h("i"))));
    }
    if (!st.partsComplete && st.status === "running") {
      const from = parts.length ? parts[parts.length - 1].end : 0;
      out.push(h("div", { class: "ai-sec loading" }, h("div", { class: "ai-sec-head" },
        h("span", { class: "ai-range" }, `${fmtClock(from)}–${st.duration ? fmtClock(st.duration) : "τέλος"}`),
        h("strong", null, st.stage === "queued" ? "Σε αναμονή" : "Λήψη του βίντεο…"))));
    }
  }
  if (sum.announcements?.length) {
    out.push(h("h5", null, "Ανακοινώσεις"), h("ul", { class: "ai-list" },
      sum.announcements.map((a) => h("li", null, timeButton(a.at), " ", a.text))));
  }
  if (sum.terms?.length) {
    out.push(h("h5", null, "Βασικοί όροι"), h("dl", { class: "ai-terms" },
      sum.terms.map((t) => [h("dt", null, timeButton(t.at), " ", t.term), h("dd", null, t.explanation)])));
  }
  if (sum.takeaways?.length) {
    out.push(h("h5", null, "Να θυμάσαι"), h("ul", { class: "ai-list" }, sum.takeaways.map((t) => h("li", null, t))));
  }
  if (st?.status === "done") {
    const model = (sum.model || "").replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2");
    out.push(h("p", { class: "ai-note faint" }, `Από το ${aiProviderName(sum.provider)}${model ? ` (${model}${sum.effort ? `, σκέψη: ${(AI_EFFORTS.find(([v]) => v === sum.effort) || ["", sum.effort])[1].toLowerCase()}` : ""})` : ""} · ${new Date(sum.created).toLocaleDateString("el-GR")}. Μπορεί να έχει λάθη: έλεγξε στο βίντεο.`));
  }
  markAISection();
  return out;
}

function summaryText(sum) {
  const lines = [sum.title, "", sum.overview, ""];
  for (const sec of sum.sections) {
    lines.push(`[${fmtClock(sec.start)}] ${sec.title}`, sec.summary, ...sec.points.map((p) => `• ${p}`));
    for (const f of sec.frames) if (f.text) lines.push(`  (${f.caption}) ${f.text}`);
    lines.push("");
  }
  if (sum.announcements.length) lines.push("Ανακοινώσεις", ...sum.announcements.map((a) => `[${fmtClock(a.at)}] ${a.text}`), "");
  if (sum.terms.length) lines.push("Βασικοί όροι", ...sum.terms.map((t) => `${t.term} [${fmtClock(t.at)}]: ${t.explanation}`), "");
  if (sum.takeaways.length) lines.push("Να θυμάσαι", ...sum.takeaways.map((t) => `• ${t}`));
  return lines.join("\n").trim();
}

function markAISection() {                       // highlights the part of the lecture that's playing
  if (!ai.els.length) return;
  const t = $("player-video").currentTime;
  let now = -1;
  ai.els.forEach(([start], i) => { if (start <= t + 0.5) now = i; });
  ai.els.forEach(([, el], i) => el.classList.toggle("now", i === now));
}

// ---- questions about the lecture
async function pollChat() {
  const lid = ai.lid;
  if (!lid || $("player").hidden) return;
  let r = null;
  try { r = await api(`/api/uniflix/chat?id=${encodeURIComponent(lid)}`); } catch {}
  if (lid !== ai.lid) return;
  if (r) ai.chat = r;
  const sig = r ? JSON.stringify([r.messages.length, r.busy, r.error, r.ready]) : ai.chatSig;
  if (sig !== ai.chatSig) {
    ai.chatSig = sig;
    if (sideMode === "ai") renderAI();          // the chat, or the "answering" dot on its tab
  } else if (r?.busy) {
    const live = $("ai-pending");
    if (live) { live.replaceChildren(...md(r.pending)); scrollChat(); }
  }
  renderAIButton();
  if (r?.busy) ai.chatTimer = setTimeout(pollChat, 600);
}

async function sendQuestion(text) {
  text = text.trim();
  if (!text || ai.chat?.busy) return;
  const lid = ai.lid;
  try {
    ai.chat = await api("/api/uniflix/chat", { method: "POST", body: { id: lid, question: text, ...lectureContext() } });
    if (ai.input) ai.input.value = "";
  } catch (err) { toast(err.message); return; }
  if (lid !== ai.lid) return;
  ai.chatSig = "";
  clearTimeout(ai.chatTimer);
  pollChat();
}

function renderChat() {
  const c = ai.chat;
  if (!c) return [h("div", { class: "spinner ai-spin" })];
  if (!ai.input) {
    ai.input = h("textarea", { rows: 2, placeholder: "Ρώτα κάτι για τη διάλεξη…", "aria-label": "Ερώτηση",
      oninput: (e) => { e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; },
      onkeydown: (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuestion(e.target.value); }
        if (e.key === "Escape") { e.stopPropagation(); e.target.blur(); }
      } });
  }
  ai.input.disabled = !c.ready;
  const list = h("div", { class: "ai-chat", id: "ai-chat" });
  for (const m of c.messages) {
    if (m.role === "user") { list.append(h("div", { class: "ai-msg user" }, m.text)); continue; }
    const copyBtn = h("button", { type: "button", class: "ai-icon", title: "Αντιγραφή απάντησης", "aria-label": "Αντιγραφή απάντησης",
      onclick: () => copyText(m.text, copyBtn) }, icon(ICONS.copy));
    list.append(h("div", { class: "ai-msg bot" }, h("div", { class: "md" }, md(m.text)), h("div", { class: "ai-msg-tools" }, copyBtn)));
  }
  if (c.busy) {
    list.append(h("div", { class: "ai-msg bot" }, h("div", { class: "md", id: "ai-pending" }, md(c.pending)),
      h("span", { class: "ai-typing" }, h("i"), h("i"), h("i"))));
  }
  const out = [];
  if (!c.messages.length && !c.busy) {
    out.push(h("p", { class: "ai-note" }, c.ready
      ? "Ρώτα ό,τι θέλεις για τη διάλεξη: ο καθηγητής ξέρει τι ειπώθηκε και πότε, και σε πάει στο σημείο του βίντεο."
      : "Οι ερωτήσεις χρησιμοποιούν το κείμενο της διάλεξης: φτιάξε πρώτα τη σύνοψη (ή υπότιτλους) από την καρτέλα Σύνοψη."));
    if (c.ready) {
      out.push(h("div", { class: "ai-suggest" }, AI_QUESTIONS.map((q) =>
        h("button", { type: "button", onclick: () => sendQuestion(q) }, q))));
    }
  }
  if (c.messages.length) {
    out.push(h("button", { type: "button", class: "link-btn ai-clear", onclick: async () => {
      if (!confirm("Να σβηστεί η συζήτηση;")) return;
      try { ai.chat = await api(`/api/uniflix/chat?id=${encodeURIComponent(ai.lid)}`, { method: "DELETE", body: {} }); } catch (err) { toast(err.message); }
      ai.chatSig = "";
      renderAI();
    } }, "Νέα συζήτηση"));
  }
  out.push(list);
  if (c.error) out.push(h("p", { class: "ai-note warn" }, `Η απάντηση απέτυχε: ${c.error}`));
  out.push(h("form", { class: "ai-ask", onsubmit: (e) => { e.preventDefault(); sendQuestion(ai.input.value); } },
    ai.input, h("button", { type: "submit", class: "btn primary", disabled: !c.ready || c.busy, title: "Αποστολή (Enter)" }, "Ρώτα")));
  return out;
}

function scrollChat() {
  const side = $("player-side"), list = $("ai-chat");
  if (list && ai.chat?.busy) side.scrollTop = side.scrollHeight;
}

// A small, safe Markdown subset for the answers (text nodes only): paragraphs, lists, **bold**, `code`,
// ``` blocks, and [h:mm:ss] times that jump the video.
const TIME_RE = /\[((?:\d+:)?\d{1,2}:\d{2})(?:\s*[–-]\s*(?:\d+:)?\d{1,2}:\d{2})?\]/;
const parseClock = (s) => s.split(":").reduce((t, x) => t * 60 + Number(x), 0);

function mdInline(text) {
  const out = [];
  const re = new RegExp(`\\*\\*([^*]+)\\*\\*|\`([^\`]+)\`|${TIME_RE.source}`, "g");
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) out.push(h("strong", null, m[1]));
    else if (m[2] != null) out.push(h("code", null, m[2]));
    else out.push(timeButton(parseClock(m[3]), m[0].slice(1, -1).replace(/^0:/, "")));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function md(text) {
  const out = [], lines = (text || "").split("\n");
  let list = null, para = [];
  const flushPara = () => { if (para.length) out.push(h("p", null, mdInline(para.join(" ")))); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara(); list = null;
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      out.push(h("pre", null, code.join("\n")));
      continue;
    }
    const item = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)/);
    if (item) {
      flushPara();
      const tag = item[1] ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== tag) { list = h(tag); out.push(list); }
      list.append(h("li", null, mdInline(item[2])));
      continue;
    }
    const head = line.match(/^#{1,4}\s+(.*)/);
    if (head) { flushPara(); list = null; out.push(h("p", { class: "md-h" }, mdInline(head[1]))); continue; }
    if (!line.trim()) { flushPara(); list = null; continue; }
    list = null;
    para.push(line.trim());
  }
  flushPara();
  return out;
}

// Signed video links are fetched on hover, so a click starts playback without waiting for uniflix.
const videoLinks = new Map();
function videoLink(id) {
  const hit = videoLinks.get(id);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.promise;
  const promise = api("/api/uniflix/play?id=" + encodeURIComponent(id));
  promise.catch(() => videoLinks.delete(id));
  videoLinks.set(id, { at: Date.now(), promise });
  return promise;
}

async function openPlayer(list, index, course) {
  Object.assign(player, { list, index, course, retried: false });
  const lec = list[index];
  const n = [...course.lectures].reverse().indexOf(lec) + 1;
  const dt = lectureDate(lec.date);
  $("player").hidden = false;
  $("player-title").textContent = `${course.name} · ${lectureLabel(lec, course, n)}`;
  $("player-sub").textContent = [dt.day && `${dt.day} ${dt.num} ${dt.mon} ${dt.year}`, lec.teacher, lec.duration].filter(Boolean).join(" · ");
  $("player-prev").disabled = index >= list.length - 1;      // the list is newest first
  $("player-next").disabled = index <= 0;
  $("player-open").href = `https://uniflix.uoa.gr/vod/player?id=${encodeURIComponent(lec.id)}`;
  $("player-error").hidden = true;
  $("player-start").hidden = true;
  $("player-spinner").hidden = false;
  if (!canPlayH264()) {                          // e.g. Falkon / Qt WebEngine and some Chromium builds
    $("player-spinner").hidden = true;
    showPlayerError(noH264Message());
    return;
  }
  applyFx();                                     // still inside the click: a volume boost may start audio
  const video = $("player-video");
  video.pause();
  video.removeAttribute("src");
  video.load();
  clearTimeout(player.watchdog);
  resetSubs(lec.id);
  resetAI(lec.id);
  try {
    const r = await videoLink(lec.id);
    if (player.list[player.index] !== lec || $("player").hidden) return;
    video.preload = "auto";
    video.src = r.stream;
    const pos = savedPosition(lec.id);
    if (pos && pos.t > 5 && (!pos.d || pos.t < pos.d - 10)) {
      video.addEventListener("loadedmetadata", () => { video.currentTime = pos.t; }, { once: true });
    }
    video.addEventListener("loadedmetadata", applyFx, { once: true });
    startPlayback();
    player.watchdog = setTimeout(() => {           // nothing arrived: say so instead of a silent black box
      if (!$("player").hidden && video.readyState < 2 && $("player-error").hidden) {
        $("player-spinner").hidden = true;
        showPlayerError("Το βίντεο αργεί πολύ να φορτώσει από το uniflix.");
      }
    }, 20000);
  } catch (err) {
    $("player-spinner").hidden = true;
    showPlayerError(err.message);
  }
}

function startPlayback() {
  const video = $("player-video");
  $("player-start").hidden = true;
  video.play().catch((err) => {
    if (err.name === "NotAllowedError") {          // the browser blocks autoplay: let the student start it
      $("player-spinner").hidden = true;
      $("player-start").hidden = false;
    } else if (err.name !== "AbortError" && err.name !== "NotSupportedError") {   // media errors: onVideoError
      showPlayerError(`Η αναπαραγωγή απέτυχε (${err.name}).`);
    }
  });
}

function canPlayH264() {
  return !!document.createElement("video").canPlayType('video/mp4; codecs="avc1.4D401F, mp4a.40.2"');
}

function noH264Message() {
  const ua = navigator.userAgent;
  const name = /Falkon/.test(ua) ? "Ο Falkon" : /QtWebEngine/.test(ua) ? "Αυτός ο browser (Qt WebEngine)" : "Αυτός ο browser";
  return `${name} δεν έχει αποκωδικοποιητή H.264, τη μορφή των βίντεο του uniflix. `
    + "Άνοιξε το Student Hub στον Firefox ή στο Chrome (http://127.0.0.1:8765) και θα παίζουν κανονικά.";
}

function showPlayerError(msg) {
  const el = $("player-error");
  el.replaceChildren(msg, " ", h("a", { href: $("player-open").href, target: "_blank", rel: "noopener noreferrer" }, "Άνοιγμα στο uniflix ↗"));
  el.hidden = false;
}

async function onVideoError() {
  const video = $("player-video"), src = video.getAttribute("src");
  if (!src || $("player").hidden) return;
  $("player-spinner").hidden = true;
  const code = video.error ? video.error.code : 0;
  // Ask the relay directly: a failed request reaches the <video> only as "unsupported", without the reason.
  let reason = "";
  try {
    const res = await fetch(src, { headers: { Range: "bytes=0-1" }, credentials: "same-origin" });
    if (!res.ok) reason = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
    else if (!(res.headers.get("Content-Type") || "").startsWith("video/")) reason = `uniflix sent ${res.headers.get("Content-Type")}`;
    res.body && res.body.cancel().catch(() => {});
  } catch {
    reason = "Το Student Hub δεν απαντά. Τρέχει ακόμα ο server;";
  }
  if (video.getAttribute("src") !== src) return;
  if (!reason && !player.retried && (code === 2 || code === 4)) {
    // The relay answers fine now, so the first request hit a passing hiccup: reload once where we were.
    player.retried = true;
    const at = video.currentTime;
    $("player-spinner").hidden = false;
    video.load();
    if (at > 1) video.addEventListener("loadedmetadata", () => { video.currentTime = at; }, { once: true });
    startPlayback();
    return;
  }
  const hwTip = "Δοκίμασε να κλείσεις την επιτάχυνση υλικού (Firefox: Ρυθμίσεις → Γενικά → Επιδόσεις) και ξαναφόρτωσε τη σελίδα.";
  const text = reason ? `Το βίντεο δεν φόρτωσε: ${reason}`
    : code === 3 ? `Ο browser δεν μπόρεσε να αποκωδικοποιήσει το βίντεο. ${hwTip}`
    : code === 4 && !canPlayH264() ? noH264Message()
    : code === 4 ? `Ο browser δεν μπόρεσε να ανοίξει το βίντεο, αν και υποστηρίζει H.264. ${hwTip}`
    : code === 2 ? "Η σύνδεση με το uniflix διακόπηκε. Δοκίμασε ξανά."
    : "Το βίντεο δεν φόρτωσε. Δοκίμασε ξανά.";
  const detail = video.error && video.error.message ? ` — ${video.error.message.slice(0, 300)}` : "";
  showPlayerError(`${text} [κωδ. ${code}${detail}]`);
}

// ---------- player adjustments (side panel): speed, volume boost, contrast, brightness ----------
const FX_DEFAULTS = { rate: 1, gain: 1, contrast: 1, brightness: 1 };
const FX_LIMITS = { rate: [0.5, 4, 0.05], gain: [0, 4, 0.05], contrast: [0.5, 2.5, 0.05], brightness: [0.5, 2, 0.05] };
const pct = (v) => `${Math.round(v * 100)}%`;
const FX_CONTROLS = [
  { key: "rate", label: "Ταχύτητα", fmt: (v) => `${Number(v.toFixed(2))}×`, presets: [1, 1.5, 2, 2.5, 3] },
  { key: "gain", label: "Ένταση", fmt: pct, presets: [1, 1.5, 2, 3] },
  { key: "contrast", label: "Αντίθεση", fmt: pct, presets: [1, 1.3, 1.6, 2] },
  { key: "brightness", label: "Φωτεινότητα", fmt: pct, presets: [1, 1.2, 1.4] },
];
const fx = (() => {
  const out = { ...FX_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem("uf:fx") || "{}") || {};
    for (const k of Object.keys(out)) {
      const v = Number(saved[k]), [lo, hi] = FX_LIMITS[k];
      if (Number.isFinite(v) && saved[k] != null) out[k] = Math.min(hi, Math.max(lo, v));
    }
  } catch {}
  return out;
})();

// Volume above 100% goes through Web Audio. It's wired up only once a boost is wanted (from a click, so the
// browser lets audio start), and the video is same-origin (/api/uniflix/stream) so the audio isn't muted.
const audio = { ctx: null, gain: null };
function ensureAudio() {
  if (audio.ctx) {
    if (audio.ctx.state === "suspended") audio.ctx.resume().catch(() => {});
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource($("player-video"));
    const gain = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();          // keeps boosted speech from clipping
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    source.connect(gain).connect(limiter).connect(ctx.destination);
    Object.assign(audio, { ctx, gain });
  } catch {}
}

function applyFx() {
  const video = $("player-video");
  video.defaultPlaybackRate = fx.rate;                      // survives loading the next lecture
  video.playbackRate = fx.rate;
  video.style.filter = fx.contrast !== 1 || fx.brightness !== 1
    ? `contrast(${fx.contrast}) brightness(${fx.brightness})` : "";
  if (fx.gain !== 1) ensureAudio();
  if (audio.gain) audio.gain.gain.setTargetAtTime(fx.gain, audio.ctx.currentTime, 0.02);
}

function setFx(key, value, rerender = true) {
  const [lo, hi] = FX_LIMITS[key];
  fx[key] = Math.round(Math.min(hi, Math.max(lo, value)) * 100) / 100;
  applyFx();
  try { localStorage.setItem("uf:fx", JSON.stringify(fx)); } catch {}
  if (rerender) renderFx();
}

function renderFx() {
  if (sideMode !== "fx") return;
  const controls = FX_CONTROLS.map((c) => {
    const [lo, hi, step] = FX_LIMITS[c.key];
    const out = h("output", null, c.fmt(fx[c.key]));
    return h("div", { class: "fx" },
      h("label", { class: "fx-head" }, h("span", null, c.label), out),
      h("input", { type: "range", min: lo, max: hi, step, value: fx[c.key], "aria-label": c.label,
        oninput: (e) => { setFx(c.key, Number(e.target.value), false); out.textContent = c.fmt(fx[c.key]); },
        onchange: () => renderFx() }),
      h("div", { class: "fx-presets" }, c.presets.map((p) => h("button", {
        type: "button", "aria-pressed": String(Math.abs(fx[c.key] - p) < 0.001), onclick: () => setFx(c.key, p),
      }, c.fmt(p)))));
  });
  const changed = Object.keys(FX_DEFAULTS).some((k) => fx[k] !== FX_DEFAULTS[k]);
  $("player-side").replaceChildren(h("h3", null, "Ρυθμίσεις"), ...controls,
    h("button", { type: "button", class: "btn plain fx-reset", disabled: !changed, onclick: () => {
      for (const k of Object.keys(FX_DEFAULTS)) setFx(k, FX_DEFAULTS[k], false);
      renderFx();
    } }, "Επαναφορά"),
    h("p", { class: "fx-keys" }, h("kbd", null, "["), " ", h("kbd", null, "]"), " ταχύτητα · ", h("kbd", null, "C"), " υπότιτλοι"));
}

function toggleSide(open, mode = sideMode) {
  const sheet = $("player").querySelector(".player-sheet");
  open = open ?? !(sheet.classList.contains("side-open") && mode === sideMode);
  sideMode = mode;
  sheet.classList.toggle("side-open", open);
  sheet.classList.toggle("side-ai", open && mode === "ai");
  $("player-fx").setAttribute("aria-pressed", String(open && mode === "fx"));
  if (open) renderSide(); else renderAIButton();
  try {
    localStorage.setItem("uf:side", open ? "1" : "0");
    localStorage.setItem("uf:sidemode", mode);
  } catch {}
}

function savePosition(force) {
  const video = $("player-video"), lec = player.list[player.index];
  if (!lec || !video.getAttribute("src") || !video.duration) return;
  const now = Date.now();
  if (!force && now - player.lastSave < 5000) return;
  player.lastSave = now;
  try { localStorage.setItem("uf:" + lec.id, JSON.stringify({ t: Math.floor(video.currentTime), d: Math.floor(video.duration) })); } catch {}
}

function stepPlayer(dir, auto = false) {
  const next = player.index - dir;                         // newest first: "next" lecture is the older index - 1
  if (next < 0 || next >= player.list.length) return;
  if (auto && $("player").hidden) return;
  openPlayer(player.list, next, player.course);
}

function closePlayer() {
  savePosition(true);
  const video = $("player-video");
  clearTimeout(player.watchdog);
  clearTimeout(subs.timer);
  clearTimeout(ai.timer);
  clearTimeout(ai.chatTimer);
  subs.lid = ai.lid = null;
  video.pause();
  video.removeAttribute("src");
  video.load();                                            // stop downloading
  $("player").hidden = true;
  player.index = -1;
  if (state.view.type === "lectures" && state.lectures.data) renderLectures();
}

// ---------- weekly timetable (di.uoa.gr/schedule, only the student's eClass courses) ----------
const TT_DAYS = ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"];
const TT_HOUR_PX = 56;
const fmtHour = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
function noteLabel(n) {
  if (n === "Φ") return "Φροντιστήριο";
  const m = n.match(/αμ\s*mod\s*(\d+)\s*=\s*(\d+)/i);
  return m ? `ΑΜ mod ${m[1]} = ${m[2]}` : n;
}
const notesText = (b) => (b.forMe ? "✓ " : "") + b.notes.map(noteLabel).join(" · ");

let timetableReq = 0;
async function loadTimetable(refresh = false, quiet = false) {
  const T = state.timetable, id = ++timetableReq;
  if (!quiet) {
    T.status = "loading";
    $("view-sub").textContent = "Reading the timetable…";
    $("timetable-body").replaceChildren(h("div", { class: "state" }, h("div", { class: "spinner" }),
      "Reading the timetable from di.uoa.gr…"));
  }
  try {
    const r = await api("/api/dit/timetable" + (refresh ? "?refresh=1" : ""));
    if (id !== timetableReq) return;
    Object.assign(T, { status: "ready", data: r, error: "" });
  } catch (err) {
    if (id !== timetableReq) return;
    Object.assign(T, { status: "error", error: err.message });
  }
  renderEclassNav();
  if (state.view.type === "timetable") renderTimetable();
}

// Monday-based weekday (0-6) and the hour as a decimal, in local time.
function nowSlot(d = new Date()) {
  return { day: (d.getDay() + 6) % 7, hour: d.getHours() + d.getMinutes() / 60 };
}

function nextMeeting(blocks) {
  const now = nowSlot();
  const at = (b) => ((b.day - now.day + 7) % 7) * 24 + b.start - now.hour;     // hours from now
  const current = blocks.find((b) => b.day === now.day && b.start <= now.hour && now.hour < b.end);
  if (current) return { block: current, now: true };
  const upcoming = blocks.map((b) => ({ b, t: at(b) < 0 ? at(b) + 7 * 24 : at(b) })).sort((a, z) => a.t - z.t)[0];
  return upcoming ? { block: upcoming.b, now: false, inHours: upcoming.t } : null;
}

function renderTimetable() {
  const T = state.timetable, d = T.data, body = $("timetable-body");
  if (T.status === "loading") return;
  if (T.status === "error") {
    $("view-sub").textContent = "";
    return body.replaceChildren(h("div", { class: "state" }, h("p", { class: "error" }, T.error),
      h("button", { class: "btn primary", onclick: () => loadTimetable(true) }, "Try again")));
  }
  if (!d) return;
  const q = state.query;
  const hiddenSections = d.blocks.filter((b) => b.forMe === false).length;
  const edit = T.editing;
  const blocks = d.blocks.filter((b) => (T.allSections || b.forMe !== false) && (edit || !b.hidden)
    && (!q || `${b.title} ${b.teacher} ${b.room} ${b.notes.join(" ")}`.toLowerCase().includes(q)));
  const courses = new Set(blocks.map((b) => b.course));
  $("view-sub").textContent = `${d.label} · ${courses.size} μαθήματα`;

  const head = h("div", { class: "lectures-head" },
    hiddenSections ? h("label", { class: "check" },
      h("input", { type: "checkbox", checked: T.allSections ? true : null,
        onchange: (e) => { T.allSections = e.target.checked; renderTimetable(); } }),
      `Δείξε και τα τμήματα άλλων ΑΜ (${hiddenSections})`) : h("span"),
    h("div", { class: "tt-head-actions" },
      h("a", { class: "btn plain", href: d.pdf, target: "_blank", rel: "noopener noreferrer" }, "Πλήρες πρόγραμμα (PDF) ↗"),
      h("button", { type: "button", class: edit ? "btn primary" : "btn plain", "aria-pressed": String(edit),
        onclick: () => { T.editing = !edit; renderTimetable(); } }, edit ? "Τέλος" : "✎ Επεξεργασία")));

  const next = nextMeeting(blocks.filter((b) => b.forMe !== false && !b.hidden));
  const nextCard = next ? h("div", { class: "tt-next", style: `--h:${courseHue(next.block.course)}` },
    h("div", { class: "tt-next-when" }, next.now ? "Τώρα" : next.inHours < 24 && next.block.day === nowSlot().day ? "Σήμερα"
      : next.inHours < 48 ? "Αύριο" : TT_DAYS[next.block.day],
      h("b", null, `${fmtHour(next.block.start)}–${fmtHour(next.block.end)}`)),
    h("div", { class: "tt-next-what" }, h("b", null, next.block.title),
      h("span", null, [next.block.room && `Αίθουσα ${next.block.room}`, next.block.teacher].filter(Boolean).join(" · ")))) : null;

  const days = [0, 1, 2, 3, 4, ...(blocks.some((b) => b.day === 5) ? [5] : [])];
  const from = Math.max(8, Math.floor(Math.min(9, ...blocks.map((b) => b.start))));
  const to = Math.min(22, Math.ceil(Math.max(17, ...blocks.map((b) => b.end))));
  const today = nowSlot();

  const hoursCol = h("div", { class: "tt-hours" }, h("div", { class: "tt-dayhead" }),
    Array.from({ length: to - from }, (_, i) => h("div", { class: "tt-hour", style: `height:${TT_HOUR_PX}px` }, `${from + i}:00`)));
  const dayCols = days.map((day) => {
    const list = blocks.filter((b) => b.day === day);
    const lanes = layoutLanes(list);
    const col = h("div", { class: "tt-col", style: `height:${(to - from) * TT_HOUR_PX}px`,
      onclick: edit ? (e) => {                    // a click on an empty slot starts a new entry there
        if (e.target !== e.currentTarget) return;
        const start = Math.min(to - 1, from + Math.floor((e.offsetY / TT_HOUR_PX) * 2) / 2);
        openTTDialog(null, { day, start, end: start + 1 });
      } : null },
      list.map((b) => {
        const { lane, of } = lanes.get(b);
        return h(edit ? "button" : "div", {
          type: edit ? "button" : null, onclick: edit ? () => openTTDialog(b) : null,
          class: "tt-block" + (b.forMe === false ? " other" : "") + (b.hidden ? " is-hidden" : "") + (b.custom ? " custom" : ""),
          style: `--h:${courseHue(b.course)};top:${(b.start - from) * TT_HOUR_PX}px;height:${(b.end - b.start) * TT_HOUR_PX - 3}px;`
            + `left:calc(${(lane / of) * 100}% + 2px);width:calc(${100 / of}% - 4px)`,
          title: `${b.title}\n${fmtHour(b.start)}–${fmtHour(b.end)} · ${b.room}\n${b.teacher}${b.notes.length ? "\n" + b.notes.map(noteLabel).join(", ") : ""}`,
        },
          h("b", null, b.title, b.edited ? h("span", { class: "tt-edited", title: "Το έχεις αλλάξει" }, " ✎") : null,
            b.hidden ? h("span", { class: "tt-edited" }, " · κρυμμένο") : null),
          h("span", null, [`${fmtHour(b.start)}–${fmtHour(b.end)}`, b.room].filter(Boolean).join(" · ")),
          h("span", { class: "faint" }, b.teacher),
          b.notes.length ? h("span", { class: "tt-note", title: b.forMe ? "Το τμήμα σου, με βάση τον ΑΜ σου" : null }, notesText(b)) : null);
      }),
      day === today.day && today.hour >= from && today.hour < to
        ? h("div", { class: "tt-now", style: `top:${(today.hour - from) * TT_HOUR_PX}px` }) : null);
    return h("div", { class: "tt-day" + (day === today.day ? " today" : "") },
      h("div", { class: "tt-dayhead" }, TT_DAYS[day]), col);
  });
  const grid = h("div", { class: "tt-grid", style: `--days:${days.length}` }, hoursCol, dayCols);

  // phones: the same meetings as a list per day
  const list = h("div", { class: "tt-list" }, days.filter((day) => blocks.some((b) => b.day === day)).map((day) =>
    h("section", { class: "card" + (day === today.day ? " today" : "") }, h("h3", null, TT_DAYS[day]),
      blocks.filter((b) => b.day === day).map((b) => h(edit ? "button" : "div", {
        type: edit ? "button" : null, onclick: edit ? () => openTTDialog(b) : null,
        class: "tt-row" + (b.forMe === false ? " other" : "") + (b.hidden ? " is-hidden" : ""), style: `--h:${courseHue(b.course)}` },
        h("span", { class: "tt-time" }, `${fmtHour(b.start)}–${fmtHour(b.end)}`),
        h("div", null, h("b", null, b.title),
          h("span", { class: "faint" }, [b.room, b.teacher, b.notes.length && notesText(b)].filter(Boolean).join(" · ")))))))) ;

  const missing = d.unmatched.length
    ? h("p", { class: "muted lectures-missing" }, "Δεν βρέθηκαν στο πρόγραμμα: " + d.unmatched.join(", ")) : null;
  body.replaceChildren(head, edit ? ttEditBar() : nextCard || "", blocks.length || edit ? grid : h("div", { class: "state" },
    h("p", { class: "muted" }, q ? "Τίποτα δεν ταιριάζει με την αναζήτηση." : "Κανένα από τα μαθήματά σου δεν είναι στο πρόγραμμα αυτού του εξαμήνου.")),
    blocks.length ? list : "", missing || "");
  body.classList.toggle("tt-editing", edit);
}

// ---------- editing the timetable ----------
const toTime = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
const fromTime = (s) => { const [hh, mm] = (s || "").split(":").map(Number); return hh + (mm || 0) / 60; };
const newId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((x) => x.toString(16).padStart(2, "0")).join("");

async function saveTTEdits(mutate) {
  const T = state.timetable;
  const edits = JSON.parse(JSON.stringify(T.data.edits));
  mutate(edits);
  try {
    await api("/api/dit/timetable/edits", { method: "POST", body: { edits } });
  } catch (err) {
    toast(err.message);
    return false;
  }
  await loadTimetable(false, true);
  return true;
}

function ttEditBar() {
  const T = state.timetable, d = T.data;
  const removed = new Set(d.edits.removeCourses);
  const mine = new Set(d.courses.map((c) => c.title));
  const addable = d.allCourses.filter((t) => !mine.has(t));
  return h("div", { class: "tt-editbar" },
    h("p", { class: "muted" }, "Κάνε κλικ σε μια ώρα για να την αλλάξεις ή να την κρύψεις, ή σε κενό σημείο για νέα."),
    h("div", { class: "tt-edit-actions" },
      h("button", { type: "button", class: "btn primary", onclick: () => openTTDialog(null, { day: nowSlot().day % 5, start: 9, end: 10 }) }, "+ Νέα ώρα"),
      h("select", { class: "year-select", "aria-label": "Προσθήκη μαθήματος από το πρόγραμμα",
        onchange: (e) => { const name = e.target.value; if (name) saveTTEdits((x) => { x.addCourses.push(name); }); } },
        h("option", { value: "" }, "+ Μάθημα από το πρόγραμμα…"), addable.map((t) => h("option", { value: t }, t)))),
    h("div", { class: "sem-picker tt-course-chips" }, d.courses.map((c) => removed.has(c.code)
      ? h("button", { type: "button", class: "removed", title: "Επαναφορά στο πρόγραμμά σου",
          onclick: () => saveTTEdits((x) => { x.removeCourses = x.removeCourses.filter((r) => r !== c.code); }) }, `↺ ${c.title}`)
      : h("button", { type: "button", title: c.code.startsWith("+") ? "Αφαίρεση" : "Απόκρυψη από το πρόγραμμά σου",
          onclick: () => saveTTEdits((x) => {
            if (c.code.startsWith("+")) x.addCourses = x.addCourses.filter((t) => t !== c.title);
            else x.removeCourses.push(c.code);
          }) }, `${c.title} ✕`))));
}

function openTTDialog(block, preset) {
  const b = block || { custom: true, title: "", room: "", teacher: "", notes: [], ...preset };
  const form = $("tt-form");
  const field = (label, input) => h("label", { class: "field" }, h("span", null, label), input);
  const inputs = {
    title: h("input", { value: b.title, maxlength: 120, required: true, placeholder: "π.χ. Εργαστήριο Λειτουργικών" }),
    day: h("select", null, TT_DAYS.map((name, i) => h("option", { value: i, selected: i === b.day }, name))),
    start: h("input", { type: "time", step: 900, min: "06:00", max: "23:45", value: toTime(b.start) }),
    end: h("input", { type: "time", step: 900, min: "06:15", max: "24:00", value: toTime(b.end) }),
    room: h("input", { value: b.room || "", maxlength: 40 }),
    teacher: h("input", { value: b.teacher || "", maxlength: 120 }),
    note: h("input", { value: (b.notes || []).join(" · "), maxlength: 80, placeholder: "π.χ. Φροντιστήριο, Τμήμα 2" }),
  };
  const error = h("p", { class: "error", role: "alert" });
  const close = () => { $("tt-dialog").hidden = true; };
  const left = [];
  if (b.custom && b.id) {
    left.push(h("button", { type: "button", class: "btn plain danger", onclick: async () => {
      if (await saveTTEdits((x) => { x.custom = x.custom.filter((c) => c.id !== b.id); })) close();
    } }, "Διαγραφή"));
  } else if (!b.custom) {
    left.push(h("button", { type: "button", class: "btn plain", onclick: async () => {
      if (await saveTTEdits((x) => { x.hidden = b.hidden ? x.hidden.filter((i) => i !== b.id) : [...x.hidden, b.id]; })) close();
    } }, b.hidden ? "Εμφάνιση" : "Απόκρυψη"));
    if (b.edited) left.push(h("button", { type: "button", class: "btn plain", onclick: async () => {
      if (await saveTTEdits((x) => { delete x.changes[b.id]; })) close();
    } }, "Επαναφορά αρχικού"));
  }
  fill(form, 
    h("h2", null, b.custom ? (b.id ? "Η δική σου ώρα" : "Νέα ώρα") : "Αλλαγή ώρας μαθήματος"),
    !b.custom ? h("p", { class: "muted" }, `Από το επίσημο πρόγραμμα. Οι αλλαγές σου ισχύουν μόνο για σένα.`) : "",
    field("Τίτλος", inputs.title),
    h("div", { class: "tt-form-row" }, field("Ημέρα", inputs.day), field("Από", inputs.start), field("Έως", inputs.end)),
    h("div", { class: "tt-form-row" }, field("Αίθουσα", inputs.room), field("Διδάσκων", inputs.teacher)),
    field("Σημείωση", inputs.note),
    error,
    h("div", { class: "actions tt-form-actions" }, h("div", null, left),
      h("div", null, h("button", { type: "button", class: "btn plain", onclick: close }, "Ακύρωση"),
        h("button", { type: "submit", class: "btn primary" }, "Αποθήκευση"))));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = {
      title: inputs.title.value.trim(), day: Number(inputs.day.value),
      start: fromTime(inputs.start.value), end: fromTime(inputs.end.value),
      room: inputs.room.value.trim(), teacher: inputs.teacher.value.trim(), note: inputs.note.value.trim(),
    };
    if (!v.title) return (error.textContent = "Γράψε έναν τίτλο.");
    if (!(v.end > v.start)) return (error.textContent = "Η ώρα λήξης πρέπει να είναι μετά την έναρξη.");
    const ok = await saveTTEdits((x) => {
      if (!b.custom) x.changes[b.id] = v;
      else if (b.id) x.custom = x.custom.map((c) => (c.id === b.id ? { ...v, id: b.id } : c));
      else x.custom.push({ ...v, id: newId() });
    });
    if (ok) close();
  };
  $("tt-dialog").hidden = false;
  inputs.title.focus();
}

// Side-by-side columns for meetings that overlap on the same day.
function layoutLanes(list) {
  const out = new Map(), groups = [];
  let group = [], end = -1;
  for (const b of [...list].sort((a, z) => a.start - z.start || z.end - a.end)) {
    if (group.length && b.start >= end) { groups.push(group); group = []; end = -1; }
    group.push(b);
    end = Math.max(end, b.end);
  }
  if (group.length) groups.push(group);
  for (const g of groups) {
    const laneEnds = [];
    for (const b of g) {
      let lane = laneEnds.findIndex((e) => e <= b.start);
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = b.end;
      out.set(b, { lane, of: 0 });
    }
    for (const b of g) out.get(b).of = laneEnds.length;
  }
  return out;
}

// ---------- eClass course details: assignments, documents, agenda, gradebook, info ----------
const COURSE_TABS = [                         // [id, label, icon]
  ["work", "Εργασίες", "assignment"], ["ann", "Ανακοινώσεις", "megaphone"], ["docs", "Έγγραφα", "folder"],
  ["agenda", "Ατζέντα", "calendar"], ["grades", "Βαθμολόγιο", "grade"], ["info", "Πληροφορίες", "info"],
];
const courseTab = { tabs: {}, data: {}, req: 0, trail: {}, available: {}, restoreDir: {} };
// eClass's "new since your last visit" items, matched to the tab that shows them (by the tool's path)
const TAB_MODULES = { ann: "/modules/announcements/", work: "/modules/work/", docs: "/modules/document/",
  agenda: "/modules/agenda/", grades: "/modules/gradebook/", info: "/modules/course_description/" };
function tabForNotification(c, n) {
  const tab = Object.keys(TAB_MODULES).find((k) => (n.path || "").includes(TAB_MODULES[k]));
  const avail = courseTab.available[c.code];
  return tab && (tab === "ann" || !avail || avail.includes(tab)) ? tab : null;
}
const GR_MONTHS_FULL = GR_MONTHS;

function currentCourse() {
  const feed = state.view.type === "ann" ? state.view.feed || "" : "";
  return feed.startsWith("ec:") ? state.eclass.courses.find((x) => "ec:" + x.code === feed) : null;
}
function activeCourseTab(c) {
  if (!c) return "ann";
  if (courseTab.tabs[c.code]) return courseTab.tabs[c.code];
  const avail = courseTab.available[c.code];
  return !avail || avail.includes("work") ? "work" : "ann";
}

function courseTabBar(c) {
  const avail = courseTab.available[c.code];
  if (!avail && !courseTab.asking?.[c.code]) {             // learn the course's tabs once, quietly
    (courseTab.asking ||= {})[c.code] = true;
    api("/api/eclass/tools?code=" + encodeURIComponent(c.code))
      .then((r) => { courseTab.available[c.code] = r.tabs; if (currentCourse() === c) renderAnnouncements(); })
      .catch(() => {});
  }
  return h("div", { class: "tabbar course-tabs", role: "tablist" }, COURSE_TABS
    .filter(([id]) => id === "ann" || !avail || avail.includes(id))
    .map(([id, label, ic]) => {
      const open = id === "work" && state.deadlines.items
        ? openDeadlines(state.deadlines.items).filter((w) => w.course === c.code).length : 0;
      const fresh = (c.notifications || []).filter((n) => tabForNotification(c, n) === id).reduce((s, n) => s + n.count, 0);
      return h("button", { type: "button", role: "tab", "aria-selected": String(activeCourseTab(c) === id),
        onclick: () => openCourseTab(c, id) }, icon(ICONS[ic]), label,
        open ? h("span", { class: "tab-count", title: `${open} ανοιχτές προθεσμίες` }, open)
          : fresh ? h("span", { class: "tab-count new", title: `${fresh} νέα από την τελευταία σου επίσκεψη στο eClass` }, fresh) : null);
    }));
}

function openCourseTab(c, tab, dir = "") {
  courseTab.tabs[c.code] = tab;
  if (tab === "docs" && !dir) courseTab.trail[c.code] = [];
  saveLocation();
  renderAnnouncements();
  if (tab !== "ann") loadCourseTab(c, tab, dir);
}

async function loadCourseTab(c, tab, dir = "", refresh = false) {
  const key = `${c.code}|${tab}|${dir}`, id = ++courseTab.req;
  courseTab.view = key;
  saveLocation();
  if (!courseTab.data[key] || refresh) {
    $("course-body").replaceChildren(h("div", { class: "state" }, h("div", { class: "spinner" }), "Reading eClass…"));
    try {
      const qs = new URLSearchParams({ code: c.code, tab });
      if (dir) qs.set("dir", dir);
      if (refresh) qs.set("refresh", "1");
      courseTab.data[key] = await api("/api/eclass/course?" + qs);
      courseTab.available[c.code] = courseTab.data[key].tabs;
    } catch (err) {
      if (id !== courseTab.req) return;
      return $("course-body").replaceChildren(h("div", { class: "state" }, h("p", { class: "error" }, err.message),
        h("button", { class: "btn primary", onclick: () => loadCourseTab(c, tab, dir, true) }, "Try again")));
    }
  }
  if (id !== courseTab.req || courseTab.view !== key) return;
  renderCourseHead();
  renderCourseTab();
}

function renderCourseTab() {
  const c = currentCourse(), tab = activeCourseTab(c);
  if (!c || tab === "ann" || !courseTab.view || !courseTab.view.startsWith(`${c.code}|${tab}|`)) return;
  const d = courseTab.data[courseTab.view];
  if (!d) return;
  const q = state.query;
  let body;
  if (d.blocks) {                    // the page didn't look as expected: show it as it is
    body = d.blocks.length
      ? [tab === "info" ? "" : h("p", { class: "muted small-note" }, "Το περιεχόμενο όπως εμφανίζεται στο eClass:"), renderPageReader(d.blocks, courseTab.view)]
      : [h("div", { class: "state" }, h("p", { class: "muted" }, "Δεν υπάρχει τίποτα εδώ ακόμα."))];
  } else if (tab === "work") body = renderWork(d.items, q);
  else if (tab === "docs") body = renderDocs(c, d, q);
  else if (tab === "agenda") body = renderAgenda(d.events, q);
  else if (tab === "grades") body = renderGradebook(d.books, q);
  $("course-body").replaceChildren(...[body].flat());
}

// Items from before this academic year (which starts on 1 September) are kept, but dimmed and listed last.
function academicYearStart(now = new Date()) {
  return new Date(now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1, 8, 1);
}
const isPastYear = (iso) => !!iso && new Date(iso) < academicYearStart();
const pastYearLabel = () => {
  const y = academicYearStart().getFullYear();
  return `Προηγούμενα ακαδημαϊκά έτη (πριν το ${y}-${String(y + 1).slice(2)})`;
};

// "σε 3 ημέρες", "σε 5 ώρες", "έληξε πριν 2 ημέρες"
function relativeDue(iso) {
  if (!iso) return "";
  const ms = new Date(iso) - new Date(), abs = Math.abs(ms), hours = abs / 36e5, days = Math.round(hours / 24);
  const span = hours < 1 ? "λιγότερο από μία ώρα" : hours < 36 ? `${Math.round(hours)} ${Math.round(hours) === 1 ? "ώρα" : "ώρες"}`
    : `${days} ${days === 1 ? "ημέρα" : "ημέρες"}`;
  return ms >= 0 ? `σε ${span}` : `έληξε πριν ${span}`;
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  return `${GR_DAYS[d.getDay()]} ${d.getDate()} ${GR_MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}, ${toTime(d.getHours() + d.getMinutes() / 60)}`;
}

const STATUS = {
  submitted: ["pass", "✓ Υποβλήθηκε"], pending: ["warn", "Εκκρεμεί"],
  notstarted: ["none", "Δεν ξεκίνησε"], "": ["none", "—"],
};

function workRow(w, withCourse) {
  const late = w.deadline && new Date(w.deadline) < new Date();
  const [cls, label] = w.status === "pending" && late ? ["fail", "Δεν υποβλήθηκε"] : STATUS[w.status] || STATUS[""];
  return h("div", { class: "card work-row" + (w.status === "pending" && !late ? " open" : "") + (isPastYear(w.deadline) ? " past-year" : "") },
    h("div", { class: "work-main" },
      withCourse ? h("span", { class: "work-course", style: `--h:${courseHue(w.course)}` }, w.courseTitle) : null,
      w.url ? h("a", { class: "work-title", href: w.url, target: "_blank", rel: "noopener" }, w.title) : h("b", { class: "work-title" }, w.title),
      h("span", { class: "muted" }, [w.kind, w.deadline ? fmtDateTime(w.deadline) : w.deadlineText,
        // eClass's own "Απομένουν …"/"Έχει λήξει" was true when the page was read; the live countdown replaces it
        w.deadline && /απομ[εέ]νουν|[εέ]χει λ[ηή]ξει|left|expired/i.test(w.note) ? "" : w.note].filter(Boolean).join(" · "))),
    h("div", { class: "work-side" },
      isPastYear(w.deadline) ? null : projectButton(w),
      w.deadline && w.status !== "submitted" ? h("span", { class: "due" + (late ? " late" : "") }, relativeDue(w.deadline)) : null,
      h("span", { class: `pill ${cls}` }, label),
      w.grade ? h("span", { class: "pill pass", title: "Βαθμός" }, w.grade) : null));
}

function renderWork(items, q) {
  const list = items.filter((w) => !q || `${w.title} ${w.kind}`.toLowerCase().includes(q));
  if (!list.length) return h("div", { class: "state" }, h("p", { class: "muted" }, "Καμία εργασία."));
  const soon = list.filter((w) => w.status !== "submitted" && w.deadline && new Date(w.deadline) >= new Date());
  const current = list.filter((w) => !isPastYear(w.deadline)), old = list.filter((w) => isPastYear(w.deadline));
  return [soon.length ? h("p", { class: "muted small-note" }, `${soon.length} με προθεσμία που δεν έχει περάσει, χωρίς υποβολή.`) : "",
    ...current.map((w) => workRow(w, false)),
    old.length ? h("h3", { class: "list-head" }, pastYearLabel()) : "", ...old.map((w) => workRow(w, false))];
}

const FILE_KINDS = [[/\.pdf$/i, "PDF", 0], [/\.(pptx?|odp|key)$/i, "PPT", 20], [/\.(docx?|odt|rtf)$/i, "DOC", 215],
  [/\.(xlsx?|ods|csv)$/i, "XLS", 140], [/\.(zip|rar|7z|tar|gz)$/i, "ZIP", 40], [/\.(png|jpe?g|gif|webp|svg)$/i, "IMG", 290],
  [/\.(mp4|mkv|webm|avi|mov)$/i, "VID", 330], [/\.(c|h|cpp|py|java|js|txt|md|sh)$/i, "TXT", 250]];

// ---------- file viewer: eClass documents, DitLab files and mail attachments, inside the app ----------
// PDFs use the browser's own PDF viewer; Word/PowerPoint/Excel are converted to PDF by the server (LibreOffice);
// Markdown is rendered (safely, as DOM nodes); text and code are shown as text; images can be zoomed.
const VIEW_KINDS = [
  ["pdf", /\.pdf$/i], ["office", /\.(docx?|odt|rtf|pptx?|ppsx?|odp|xlsx?|ods)$/i],
  ["image", /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i], ["md", /\.(md|markdown)$/i], ["csv", /\.(csv|tsv)$/i],
  ["text", /\.(txt|c|h|cpp|hpp|cc|py|java|js|ts|json|xml|sh|sql|log|ini|ya?ml|tex|m|r|go|rs|hs|ml|asm|s|v|vhdl?|css|html?|kt|swift|php|rb|pl|lua|mk|toml|cfg|conf|bib|pro|lisp|scm|erl|ex|cs|sv)$|(^|\/)(makefile|dockerfile|readme)$/i],
];
const viewKind = (name) => (VIEW_KINDS.find(([, re]) => re.test(name || "")) || [null])[0];
const viewer = { list: [], index: 0, zoom: 0, req: 0, mdSource: false, wrap: true };

function viewUrl(item, extra = {}) {
  return "/api/view?" + new URLSearchParams({ ...item.src, t: state.csrf, ...extra });
}

// Opens the viewer if the file can be shown here; returns false so a plain link can do its usual thing.
function openViewer(list, index) {
  const item = list[index];
  if (!item || !viewKind(item.name)) return false;
  Object.assign(viewer, { list: list.filter((x) => viewKind(x.name)), zoom: 0, mdSource: false });
  viewer.index = viewer.list.indexOf(item);
  $("viewer").hidden = false;
  showViewerItem();
  return true;
}

// click handler for links to viewable files (ctrl/middle click still opens the link in a new tab)
const viewOnClick = (list, item) => (e) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  if (openViewer(list, list.indexOf(item))) e.preventDefault();
};

function closeViewer() {
  viewer.req++;
  $("viewer").hidden = true;
  $("viewer-body").replaceChildren();                      // stops a PDF/conversion still loading
}

function stepViewer(dir) {
  const next = viewer.index + dir;
  if (next < 0 || next >= viewer.list.length) return;
  Object.assign(viewer, { index: next, zoom: 0, mdSource: false });
  showViewerItem();
}

function viewerState(...children) {
  return h("div", { class: "viewer-state" }, ...children);
}

function viewerError(item, message) {
  $("viewer-body").replaceChildren(viewerState(
    h("p", null, message),
    h("a", { class: "btn primary", href: viewUrl(item, { dl: "1" }) }, "Λήψη του αρχείου")));
}

function showViewerItem() {
  const item = viewer.list[viewer.index], kind = viewKind(item.name), id = ++viewer.req;
  const badge = FILE_KINDS.find(([re]) => re.test(item.name)) || [null, (item.name.split(".").pop() || "").slice(0, 4).toUpperCase() || "FILE", 200];
  const b = $("viewer-badge");
  b.textContent = badge[1];
  b.style.setProperty("--h", badge[2]);
  $("viewer-title").textContent = item.title || item.name;
  $("viewer-sub").textContent = [item.title && item.title !== item.name ? item.name : "", ...(item.sub || [])].filter(Boolean).join(" · ");
  $("viewer-nav").hidden = viewer.list.length < 2;
  $("viewer-pos").textContent = `${viewer.index + 1} από ${viewer.list.length}`;
  $("viewer-download").href = viewUrl(item, { dl: "1" });
  $("viewer-tab").href = kind === "office" ? viewUrl(item, { as: "pdf" }) : viewUrl(item);
  $("viewer-prev").disabled = viewer.index <= 0;
  $("viewer-next").disabled = viewer.index >= viewer.list.length - 1;
  $("viewer-tools").replaceChildren();
  const body = $("viewer-body");
  body.className = `viewer-body kind-${kind}`;
  body.scrollTop = 0;

  if (kind === "pdf") {
    body.replaceChildren(h("iframe", { class: "viewer-frame", title: item.name, src: viewUrl(item) }));
  } else if (kind === "office") {
    body.replaceChildren(viewerState(h("div", { class: "spinner" }), h("p", null, "Μετατροπή σε PDF με το LibreOffice…"),
      h("p", { class: "muted" }, "Την πρώτη φορά θέλει λίγα δευτερόλεπτα· μετά ανοίγει αμέσως.")));
    api(viewUrl(item).replace("/api/view?", "/api/view/prepare?")).then(() => {
      if (id !== viewer.req) return;
      body.replaceChildren(h("iframe", { class: "viewer-frame", title: item.name, src: viewUrl(item, { as: "pdf" }) }));
    }).catch((err) => { if (id === viewer.req) viewerError(item, err.message); });
  } else if (kind === "image") {
    showImage(item);
  } else {
    body.replaceChildren(viewerState(h("div", { class: "spinner" })));
    fetch(viewUrl(item), { credentials: "same-origin" }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Σφάλμα ${res.status}`);
      return res.text();
    }).then((text) => {
      if (id !== viewer.req) return;
      viewer.text = text;
      renderTextView(kind);
    }).catch((err) => { if (id === viewer.req) viewerError(item, err.message); });
  }
}

function toolButton(label, title, onclick, pressed) {
  return h("button", { type: "button", class: "viewer-tool", title, "aria-label": title, "aria-pressed": pressed == null ? null : String(pressed), onclick }, label);
}

// ---- images: fit to the window, or zoom (buttons, Ctrl+wheel, double click) and drag to move around
function showImage(item) {
  const body = $("viewer-body");
  const img = h("img", { src: viewUrl(item), alt: item.name, draggable: "false" });
  const stage = h("div", { class: "viewer-image" }, img);
  const label = h("span", { class: "viewer-zoom" }, "");
  const apply = () => {
    const fit = !viewer.zoom;
    stage.classList.toggle("fit", fit);
    img.style.width = fit ? "" : `${Math.round(img.naturalWidth * viewer.zoom)}px`;
    const shown = fit ? (img.naturalWidth ? img.clientWidth / img.naturalWidth : 1) : viewer.zoom;
    label.textContent = `${Math.round(shown * 100)}%`;
  };
  const zoomBy = (f, cx, cy) => {
    const before = viewer.zoom || (img.naturalWidth ? img.clientWidth / img.naturalWidth : 1);
    const rect = stage.getBoundingClientRect();
    const px = (cx ?? rect.left + rect.width / 2) - rect.left + stage.scrollLeft, py = (cy ?? rect.top + rect.height / 2) - rect.top + stage.scrollTop;
    viewer.zoom = Math.min(8, Math.max(0.05, before * f));
    apply();
    const k = viewer.zoom / before;                 // keep the point under the cursor in place
    stage.scrollLeft = px * k - ((cx ?? rect.left + rect.width / 2) - rect.left);
    stage.scrollTop = py * k - ((cy ?? rect.top + rect.height / 2) - rect.top);
  };
  img.addEventListener("load", apply);
  img.addEventListener("error", () => viewerError(item, "Η εικόνα δεν μπόρεσε να ανοίξει."));
  img.addEventListener("dblclick", (e) => { if (viewer.zoom) { viewer.zoom = 0; apply(); } else zoomBy(2, e.clientX, e.clientY); });
  stage.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  }, { passive: false });
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    if (!viewer.zoom || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add("dragging");
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    stage.scrollLeft = drag.l - (e.clientX - drag.x);
    stage.scrollTop = drag.t - (e.clientY - drag.y);
  });
  const end = () => { drag = null; stage.classList.remove("dragging"); };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  viewer.zoomBy = zoomBy;
  viewer.zoomFit = () => { viewer.zoom = 0; apply(); };
  viewer.zoomActual = () => { viewer.zoom = 1; apply(); };
  $("viewer-tools").replaceChildren(
    toolButton("−", "Σμίκρυνση (−)", () => zoomBy(1 / 1.25)), label, toolButton("+", "Μεγέθυνση (+)", () => zoomBy(1.25)),
    toolButton("Προσαρμογή", "Όλη η εικόνα στο παράθυρο (0)", viewer.zoomFit), toolButton("100%", "Πραγματικό μέγεθος (1)", viewer.zoomActual));
  body.replaceChildren(stage);
}

// ---- Markdown, CSV, text and code
function renderTextView(kind) {
  const body = $("viewer-body"), text = viewer.text;
  const tools = [];
  if (kind === "md") {
    tools.push(toolButton("Προβολή", "Μορφοποιημένο", () => { viewer.mdSource = false; renderTextView(kind); }, !viewer.mdSource),
      toolButton("Κείμενο", "Το Markdown όπως είναι γραμμένο", () => { viewer.mdSource = true; renderTextView(kind); }, viewer.mdSource));
  }
  if (kind === "text" || viewer.mdSource) {
    tools.push(toolButton("Αναδίπλωση", "Αναδίπλωση μεγάλων γραμμών", () => { viewer.wrap = !viewer.wrap; renderTextView(kind); }, viewer.wrap));
  }
  const copyBtn = h("button", { type: "button", class: "viewer-tool icon", title: "Αντιγραφή όλου του κειμένου", "aria-label": "Αντιγραφή",
    onclick: () => copyText(text, copyBtn) }, icon(ICONS.copy));
  tools.push(copyBtn);
  $("viewer-tools").replaceChildren(...tools);
  if (kind === "md" && !viewer.mdSource) {
    body.replaceChildren(h("article", { class: "viewer-md" }, mdDocument(text)));
  } else if (kind === "csv") {
    body.replaceChildren(csvTable(text, viewer.list[viewer.index].name.toLowerCase().endsWith(".tsv") ? "\t" : null));
  } else {
    const lines = text.replace(/\n$/, "").split("\n");
    const pre = h("pre", { class: "viewer-text" + (viewer.wrap ? " wrap" : "") },
      lines.slice(0, 50000).map((ln) => h("span", { class: "ln" }, ln, "\n")));
    fill(body, pre, lines.length > 50000 ? h("p", { class: "muted viewer-more" }, `Εμφανίζονται οι πρώτες 50.000 από ${lines.length} γραμμές.`) : null);
  }
}

function parseCsv(text, sep) {
  sep = sep || ((text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",");
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
      if (rows.length > 5000) break;
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function csvTable(text, sep) {
  const rows = parseCsv(text, sep);
  if (!rows.length) return viewerState(h("p", { class: "muted" }, "Το αρχείο είναι άδειο."));
  return h("div", { class: "viewer-table" }, h("table", null,
    h("thead", null, h("tr", null, rows[0].map((c) => h("th", null, c)))),
    h("tbody", null, rows.slice(1).map((r) => h("tr", null, r.map((c) => h("td", null, c)))))));
}

// A fuller Markdown renderer than the chat's: headings, nested lists, task lists, quotes, code blocks, tables,
// links (http, https, mailto only), images (as links: remote images are blocked here), emphasis. DOM nodes
// only, never HTML strings, so a file can't inject anything.
function mdSpans(text) {
  const out = [];
  const re = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)[^)]*\)|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)[^)]*\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g;
  let last = 0, m;
  const safeHref = (u) => /^(https?:|mailto:)/i.test(u) ? u : null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) out.push(h("code", null, m[1]));
    else if (m[2] != null || m[3] != null) out.push(h("strong", null, mdSpans(m[2] ?? m[3])));
    else if (m[4] != null) out.push(h("del", null, mdSpans(m[4])));
    else if (m[5] != null || m[6] != null) out.push(h("em", null, mdSpans(m[5] ?? m[6])));
    else if (m[8] != null) {
      const href = safeHref(m[8]);
      out.push(href ? h("a", { href, target: "_blank", rel: "noopener noreferrer", class: "md-img" }, `🖼 ${m[7] || "εικόνα"}`) : h("span", { class: "md-img" }, `🖼 ${m[7] || m[8]}`));
    } else if (m[10] != null) {
      const href = safeHref(m[10]);
      out.push(href ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, mdSpans(m[9])) : h("span", { class: "md-link" }, mdSpans(m[9])));
    } else {
      const url = m[11] || m[12];
      out.push(h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, url));
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function mdDocument(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || "");
  const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { i++; continue; }
    if ((m = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/))) {            // fenced code
      const fence = m[1], code = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i]);
      i++;
      out.push(h("pre", { class: "md-code" }, h("code", { "data-lang": m[2] || null }, code.join("\n"))));
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) { out.push(h(`h${m[1].length}`, null, mdSpans(m[2]))); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push(h("hr")); i++; continue; }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(h("blockquote", null, mdDocument(quote.join("\n"))));
      continue;
    }
    if (line.includes("|") && isTableSep(lines[i + 1])) {
      const head = cells(line), align = cells(lines[i + 1]).map((c) => c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : "");
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) body.push(cells(lines[i++]));
      const td = (tag, c, k) => h(tag, { style: align[k] ? `text-align:${align[k]}` : null }, mdSpans(c));
      out.push(h("div", { class: "viewer-table" }, h("table", null, h("thead", null, h("tr", null, head.map((c, k) => td("th", c, k)))),
        h("tbody", null, body.map((r) => h("tr", null, r.map((c, k) => td("td", c, k))))))));
      continue;
    }
    if (listRe.test(line)) {                       // a list, with nesting by indentation
      const stack = [];
      while (i < lines.length && (listRe.test(lines[i]) || (lines[i].trim() && /^\s{2,}/.test(lines[i]) && stack.length))) {
        const lm = lines[i].match(listRe);
        if (!lm) {                                // continuation line of the previous item
          stack[stack.length - 1].li.append(" ", ...mdSpans(lines[i].trim()));
          i++;
          continue;
        }
        const indent = lm[1].replace(/\t/g, "    ").length, ordered = /\d/.test(lm[2]);
        while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
        let top = stack[stack.length - 1];
        if (!top || indent > top.indent) {
          const list = h(ordered ? "ol" : "ul");
          if (ordered && parseInt(lm[2], 10) !== 1) list.start = parseInt(lm[2], 10);
          if (top) top.li.append(list); else out.push(list);
          top = { indent, list, li: null };
          stack.push(top);
        }
        const task = lm[3].match(/^\[([ xX])\]\s+(.*)$/);
        top.li = h("li", { class: task ? "task" : null },
          task ? h("input", { type: "checkbox", disabled: true, checked: task[1] !== " " }) : null, mdSpans(task ? task[2] : lm[3]));
        top.list.append(top.li);
        i++;
      }
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>)/.test(lines[i]) && !listRe.test(lines[i]) &&
           !(lines[i].includes("|") && isTableSep(lines[i + 1]))) para.push(lines[i++]);
    const nodes = [];
    para.forEach((p, k) => {                         // two trailing spaces or a backslash: a line break
      nodes.push(...mdSpans(p.replace(/(\s{2,}|\\)$/, "").trim()));
      if (k < para.length - 1) nodes.push(/(\s{2,}|\\)$/.test(p) ? h("br") : " ");
    });
    out.push(h("p", null, nodes));
  }
  return out;
}

function renderDocs(c, d, q) {
  const trail = courseTab.trail[c.code] || (courseTab.trail[c.code] = []);
  const crumbs = h("div", { class: "doc-crumbs" },
    h("button", { type: "button", class: "btn plain", onclick: () => openCourseTab(c, "docs") }, "Έγγραφα"),
    trail.map((t, i) => [h("span", { class: "muted" }, "›"),
      h("button", { type: "button", class: "btn plain", onclick: () => { courseTab.trail[c.code] = trail.slice(0, i + 1); loadCourseTab(c, "docs", t.dir); } }, t.name)]));
  const matching = d.items.filter((x) => !q || x.name.toLowerCase().includes(q) || (x.comment || "").toLowerCase().includes(q));
  const items = [...matching.filter((x) => !isPastYear(x.when)), ...matching.filter((x) => isPastYear(x.when))];
  const firstOld = items.find((x) => isPastYear(x.when));
  const files = [];
  const rows = items.flatMap((x) => [x === firstOld ? h("div", { class: "doc-divider" }, pastYearLabel()) : null, docRow(c, x, trail, files)]);
  return [crumbs, rows.length ? h("div", { class: "card doc-list" }, rows) : h("div", { class: "state" }, h("p", { class: "muted" }, "Ο φάκελος είναι άδειος."))];
}

function docRow(c, x, trail, files) {
  const old = isPastYear(x.when) ? " past-year" : "";
  if (x.dir) {
    return h("button", { type: "button", class: "doc-row folder" + old, onclick: () => {
      courseTab.trail[c.code] = [...trail, { dir: x.dir, name: x.name }];
      loadCourseTab(c, "docs", x.dir);
    } }, h("span", { class: "file-badge folder" }, icon(ICONS.folder)), h("span", { class: "doc-name" }, x.name),
    h("span", { class: "muted" }, x.date));
  }
  const src = x.url || x.download;
  const name = decodeURIComponent((src.split("?")[0].split("/").pop() || x.name));
  const kind = FILE_KINDS.find(([re]) => re.test(name)) || [null, (name.split(".").pop() || "").slice(0, 4).toUpperCase() || "FILE", 200];
  const item = { name, title: x.name, sub: [x.size, x.date].filter(Boolean), src: { src: "eclass", url: src } };
  files.push(item);
  return h("a", { class: "doc-row" + old, href: `/api/eclass/file?url=${encodeURIComponent(src)}`, target: "_blank", rel: "noopener",
    title: viewKind(name) ? `${name} · προβολή μέσα στην εφαρμογή (Ctrl+κλικ: νέα καρτέλα)` : name, onclick: viewOnClick(files, item) },
    h("span", { class: "file-badge", style: `--h:${kind[2]}` }, kind[1]),
    h("span", { class: "doc-name" }, x.name, x.comment ? h("small", { class: "muted" }, x.comment) : null),
    h("span", { class: "muted" }, [x.size, x.date].filter(Boolean).join(" · ")));
}

function renderAgenda(events, q) {
  const list = events.filter((e) => !q || `${e.title} ${e.description}`.toLowerCase().includes(q));
  if (!list.length) return h("div", { class: "state" }, h("p", { class: "muted" }, "Κανένα γεγονός στην ατζέντα."));
  const now = new Date();
  const upcoming = list.filter((e) => new Date(e.end || e.start) >= now);
  const past = list.filter((e) => new Date(e.end || e.start) < now).reverse();
  const row = (e) => {
    const d = new Date(e.start);
    return h("div", { class: "card agenda-row" + (e.kind === "deadline" ? " deadline" : "") },
      h("div", { class: "agenda-date" }, h("b", null, d.getDate()), h("span", null, `${GR_MONTHS[d.getMonth()]} ${d.getFullYear()}`)),
      h("div", { class: "agenda-main" },
        h("b", null, e.title, e.kind === "deadline" ? h("span", { class: "pill warn" }, "Προθεσμία") : null),
        h("span", { class: "muted" }, `${GR_DAYS[d.getDay()]} ${toTime(d.getHours() + d.getMinutes() / 60)}`
          + (e.end ? `–${toTime(new Date(e.end).getHours() + new Date(e.end).getMinutes() / 60)}` : "") + (new Date(e.start) >= now ? ` · ${relativeDue(e.start)}` : "")),
        e.description ? h("p", null, e.description) : null));
  };
  return [upcoming.length ? h("h3", { class: "list-head" }, "Επόμενα") : "", ...upcoming.map(row),
    past.length ? h("h3", { class: "list-head" }, "Παλαιότερα") : "", ...past.map(row)];
}

function renderGradebook(books, q) {
  if (!books.length) return h("div", { class: "state" }, h("p", { class: "muted" }, "Δεν υπάρχει βαθμολόγιο."));
  return books.map((b) => h("section", { class: "card" },
    b.title ? h("h3", null, b.title) : null,
    h("table", { class: "grade-table" },
      h("thead", null, h("tr", null, ["Δραστηριότητα", "Τύπος", "Βαρύτητα", "Βαθμός", "Συνολικά"].map((t) => h("th", null, t)))),
      h("tbody", null, b.rows.filter((r) => !q || r.title.toLowerCase().includes(q)).map((r) => h("tr", null,
        h("td", null, r.title, r.date && r.date !== "-" ? h("small", { class: "muted" }, ` · ${r.date}`) : null),
        h("td", null, r.type), h("td", null, r.weight),
        h("td", null, h("span", { class: "pill " + (r.grade && r.grade !== "-" ? "pass" : "none") }, r.grade || "—")),
        h("td", null, r.total || "—")))))));
}

// ---------- deadlines across all courses ----------
async function loadDeadlines(refresh = false) {
  const D = state.deadlines;
  D.status = "loading";
  if (state.view.type === "deadlines") $("deadlines-body").replaceChildren(h("div", { class: "state" }, h("div", { class: "spinner" }), "Reading the assignments of your courses…"));
  try {
    D.items = (await api("/api/eclass/deadlines" + (refresh ? "?refresh=1" : ""))).items;
    D.status = "ready";
  } catch (err) {
    Object.assign(D, { status: "error", error: err.message });
  }
  renderEclassNav();
  if (currentCourse()) renderCourseHead();         // the Εργασίες tab shows the course's open deadlines
  if (state.view.type === "deadlines") renderDeadlines();
}

const openDeadlines = (items) => items.filter((w) => w.status === "pending" && w.deadline && new Date(w.deadline) >= new Date());

function renderDeadlines() {
  const D = state.deadlines, body = $("deadlines-body");
  if (D.status === "loading") return;
  if (D.status === "error") {
    return body.replaceChildren(h("div", { class: "state" }, h("p", { class: "error" }, D.error),
      h("button", { class: "btn primary", onclick: () => loadDeadlines(true) }, "Try again")));
  }
  const q = state.query;
  const items = (D.items || []).filter((w) => !q || `${w.title} ${w.courseTitle}`.toLowerCase().includes(q));
  const open = openDeadlines(items);
  const older = items.filter((w) => !open.includes(w) && isPastYear(w.deadline));
  const rest = items.filter((w) => !open.includes(w) && !older.includes(w));
  const groups = [
    ["Επόμενες προθεσμίες", open],
    ["Χωρίς προθεσμία", rest.filter((w) => !w.deadline && w.status !== "submitted")],
    ["Υποβλήθηκαν", rest.filter((w) => w.status === "submitted").reverse()],
    ["Έληξαν χωρίς υποβολή", rest.filter((w) => w.deadline && w.status !== "submitted" && new Date(w.deadline) < new Date()).reverse()],
    [pastYearLabel(), older.reverse()],
  ];
  $("view-sub").textContent = open.length ? `${open.length} ανοιχτές προθεσμίες` : "Καμία ανοιχτή προθεσμία";
  body.replaceChildren(...(items.length ? groups.filter(([, l]) => l.length).flatMap(([title, l]) =>
    [h("h3", { class: "list-head" }, title), ...l.map((w) => workRow(w, true))])
    : [h("div", { class: "state" }, h("p", { class: "muted" }, "Δεν βρέθηκαν εργασίες στα μαθήματά σου."))]));
}

// ---------- reading eClass pages (Πληροφορίες, and any tab shown as the page itself) ----------
// One open, closable box per section; selectable text; search that ignores accents and case, one colour per word.
const HL_COLORS = 5;
const readerState = {};                         // course tab key -> { query, closed: Set of box indexes, at }

// Same-length folding (one char -> one char), so match positions map straight back onto the text.
const foldChar = (ch) => { const b = ch.normalize("NFD")[0].toLowerCase(); return b === "ς" ? "σ" : b; };
const fold = (s) => [...s].map(foldChar).join("");
const searchTerms = (q) => [...new Set(fold(q || "").split(/\s+/).filter((w) => w.length >= 2))].slice(0, 8);
const isWordChar = (ch) => /[\p{L}\p{N}]/u.test(ch || "");

// Text with each search word wrapped in <mark class="hl hl-N">; returns [nodes, matches].
function markTerms(text, terms) {
  if (!terms.length || !text) return [[text], 0];
  const chars = [...text], folded = chars.map(foldChar).join("");
  const hits = [];
  terms.forEach((term, n) => {                   // matches start at a word: "εργασ" finds "εργασίες", not "διεργασίες"
    for (let i = folded.indexOf(term); i >= 0; i = folded.indexOf(term, i + 1)) {
      if (!isWordChar(folded[i - 1])) hits.push([i, i + term.length, n]);
    }
  });
  hits.sort((a, z) => a[0] - z[0] || z[1] - a[1]);
  const out = [];
  let pos = 0, count = 0;
  for (const [s, e, n] of hits) {
    if (s < pos) continue;                      // overlapping a previous match
    if (s > pos) out.push(chars.slice(pos, s).join(""));
    out.push(h("mark", { class: `hl hl-${n % HL_COLORS}` }, chars.slice(s, e).join("")));
    pos = e; count++;
  }
  if (pos < chars.length) out.push(chars.slice(pos).join(""));
  return [out, count];
}

function readerSections(blocks) {
  const out = [];
  let cur = null;
  for (const b of blocks) {
    if (b.t === "section" || b.t === "h") {
      cur = { title: b.t === "section" ? b.text : blockText(b).trim(), blocks: [] };
      out.push(cur);
    } else {
      if (!cur) { cur = { title: "", blocks: [] }; out.push(cur); }
      cur.blocks.push(b);
    }
  }
  return out.filter((s) => s.title || s.blocks.length);
}

function readerInline(list, terms, tally) {
  return list.map((x) => {
    const [nodes, n] = markTerms(x.text.replace(/\s+/g, " "), terms);
    tally.n += n;
    return x.href ? h("a", { href: x.href, target: "_blank", rel: "noopener noreferrer" }, nodes) : nodes;
  });
}

function readerBody(blocks, terms, tally) {
  const body = h("div", { class: "doc reader-body" });
  let list = null;
  for (const b of blocks) {
    if (b.t !== "li") list = null;
    if (b.t === "p") body.append(h("p", null, readerInline(b.inl, terms, tally)));
    else if (b.t === "li") {
      if (!list) { list = h("ul"); body.append(list); }
      list.append(h("li", null, readerInline(b.inl, terms, tally)));
    } else if (b.t === "table") {
      body.append(h("div", { class: "table-wrap" }, h("table", null, b.rows.map((r) => h("tr", null,
        r.cells.map((c) => h(r.head ? "th" : "td", null, readerInline(c.links.length === 1 && c.links[0].text.trim() === c.text.trim()
          ? [{ text: c.text, href: c.links[0].href }] : [{ text: c.text }, ...c.links.filter((l) => l.text.trim() !== c.text.trim())
            .map((l) => ({ text: " " + l.text, href: l.href }))], terms, tally))))))));
    }
  }
  return body;
}

// A section as plain text, built from its content (not from the screen, so closed sections copy in full too).
function sectionText(s) {
  const line = (b) => blockText(b).replace(/\s+/g, " ").trim();
  const parts = [];
  let list = [];
  const flush = () => { if (list.length) parts.push(list.join("\n")); list = []; };
  for (const b of s.blocks) {
    if (b.t === "li") { list.push("• " + line(b)); continue; }
    flush();
    if (b.t === "p" && line(b)) parts.push(line(b));
    else if (b.t === "table") parts.push(b.rows.map((r) => r.cells.map((c) => c.text.replace(/\s+/g, " ").trim()).join("\t")).join("\n"));
  }
  flush();
  return [s.title, ...parts].filter(Boolean).join("\n\n");
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {                                     // older browsers: copy through a selection
    const ta = h("textarea", { style: "position:fixed;opacity:0" }, text);
    document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  if (button) {                                  // the copy icon turns into a tick for a moment
    button.replaceChildren(icon(ICONS.check));
    button.classList.add("done");
    setTimeout(() => { button.replaceChildren(icon(ICONS.copy)); button.classList.remove("done"); }, 1400);
  }
}

function renderPageReader(blocks, key) {
  const rs = readerState[key] || (readerState[key] = { closed: new Set() });
  const terms = searchTerms(state.query);        // the toolbar search highlights matches here too
  const sections = readerSections(blocks);
  const content = h("div", { class: "reader-boxes" }, sections.map((s, i) => {
    const tally = { n: 0 };
    const [title, tn] = markTerms(s.title, terms);
    const body = readerBody(s.blocks, terms, tally);
    return h("details", { class: "card reader-box", open: rs.closed.has(i) && !(tally.n + tn) ? null : true,
      ontoggle: (e) => { e.target.open ? rs.closed.delete(i) : rs.closed.add(i); } },
      h("summary", null, h("span", { class: "reader-toggle", "aria-hidden": "true" }),
        h("span", { class: "reader-title" }, s.title ? title : "Γενικά"),
        h("button", { type: "button", class: "plain-icon reader-copy", title: "Αντιγραφή της ενότητας", "aria-label": "Αντιγραφή της ενότητας",
          onclick: (e) => { e.preventDefault(); copyText(sectionText(s), e.currentTarget); } },
          icon(ICONS.copy))),
      body);
  }));
  return h("div", { class: "reader" },
    h("div", { class: "reader-actions" },
      h("button", { type: "button", class: "plain-icon", title: "Αντιγραφή όλων", "aria-label": "Αντιγραφή όλων",
        onclick: (e) => copyText(sections.map(sectionText).join("\n\n\n"), e.currentTarget) }, icon(ICONS.copy)),
      h("button", { type: "button", class: "plain-icon sign", title: "Άνοιγμα όλων", "aria-label": "Άνοιγμα όλων",
        onclick: () => [...content.children].forEach((d) => { d.open = true; }) }, "+"),
      h("button", { type: "button", class: "plain-icon sign", title: "Κλείσιμο όλων", "aria-label": "Κλείσιμο όλων",
        onclick: () => [...content.children].forEach((d) => { d.open = false; }) }, "−")),
    content);
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
  saveLocation();
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

function fileRow(it, showPath, files) {
  const parts = [icon(it.isDir ? ICONS.folder : ICONS.file),
    h("span", { class: "name" }, it.name, showPath ? h("small", {}, it.path) : null),
    h("span", { class: "meta" }, it.isDir || !it.size ? "" : sizeFmt(it.size)),
    h("span", { class: "meta" }, it.modified ? dateFmt.format(new Date(it.modified)) : "")];
  return h("li", {}, it.isDir
    ? h("button", { class: "file-row dir", onclick: () => loadDitlabFolder(it.path) }, parts)
    : h("a", { class: "file-row", href: ditlabFileLink(it.path), target: "_blank", rel: "noopener", onclick: viewOnClick(files, files.find((f) => f.it === it)) }, parts));
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
  const files = list.filter((it) => !it.isDir).map((it) => ({ it, name: it.name, sub: [it.size ? sizeFmt(it.size) : "", it.modified ? dateFmt.format(new Date(it.modified)) : ""].filter(Boolean),
    src: { src: "ditlab", path: it.path } }));
  const rows = list.map((it) => fileRow(it, d.results !== null, files));
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

// ---------- sidebar: collapsible, reorderable sections and an adjustable width ----------
const SIDEBAR_WIDTH = { min: 200, max: 440, default: 250 };
const readPref = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writePref = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

const sidebarMobile = () => matchMedia("(max-width: 820px)").matches;

function syncSidebarVisibility() {
  const app = $("app");
  const open = sidebarMobile() ? app.classList.contains("nav-open") : !app.classList.contains("sidebar-closed");
  $("sidebar").inert = !open;
  $("sidebar").setAttribute("aria-hidden", String(!open));
  $("menu-btn").setAttribute("aria-expanded", String(open));
  $("menu-btn").setAttribute("aria-label", open ? "Hide categories" : "Show categories");
  $("menu-btn").title = open ? "Hide menu" : "Show menu";
}

function setSidebarOpen(open, persist = true) {
  if (sidebarMobile()) $("app").classList.toggle("nav-open", open);
  else {
    $("app").classList.toggle("sidebar-closed", !open);
    if (persist) writePref("sidebar:hidden", !open);
  }
  if (!open && $("sidebar").contains(document.activeElement)) $("menu-btn").focus();
  syncSidebarVisibility();
}

function closeMobileSidebar() {
  $("app").classList.remove("nav-open");
  syncSidebarVisibility();
}

function setupSidebar() {
  $("app").classList.toggle("sidebar-closed", readPref("sidebar:hidden", false) === true);
  syncSidebarVisibility();
  matchMedia("(max-width: 820px)").addEventListener("change", closeMobileSidebar);
  $("sidebar-close").addEventListener("click", () => setSidebarOpen(false));
  const nav = $("nav-sections");
  const sections = () => [...nav.querySelectorAll(":scope > .nav-section")];
  const saveOrder = () => writePref("sidebar:order", sections().map((s) => s.dataset.section));

  // saved order first; sections added in later versions keep their place at the end
  const order = readPref("sidebar:order", []);
  for (const key of order) {
    const s = nav.querySelector(`:scope > [data-section="${CSS.escape(key)}"]`);
    if (s) nav.append(s);
  }
  for (const s of sections()) if (!order.includes(s.dataset.section)) nav.append(s);

  // sections start closed; only the ones the student opens are remembered
  const opened = new Set(readPref("sidebar:open", []));
  try { localStorage.removeItem("sidebar:collapsed"); } catch {}
  for (const s of sections()) {
    const head = s.querySelector(".nav-head"), key = s.dataset.section;
    head.prepend(h("span", { class: "chev", "aria-hidden": "true" }), h("span", { class: "grip", "aria-hidden": "true" }));
    head.tabIndex = 0;
    head.setAttribute("role", "button");
    head.title = "Κλικ: άνοιγμα/κλείσιμο · σύρε για μετακίνηση (ή Alt+↑/↓)";
    const setOpen = (open) => {
      s.classList.toggle("collapsed", !open);
      head.setAttribute("aria-expanded", String(open));
      open ? opened.add(key) : opened.delete(key);
      writePref("sidebar:open", [...opened]);
    };
    setOpen(opened.has(key));
    head.addEventListener("click", (e) => { if (!e.target.closest(".icon-btn")) setOpen(s.classList.contains("collapsed")); });
    head.addEventListener("keydown", (e) => {
      if (e.target !== head) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(s.classList.contains("collapsed")); }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {     // keyboard reordering
        e.preventDefault();
        const visible = sections().filter((x) => x.offsetParent !== null);
        const i = visible.indexOf(s), other = visible[e.key === "ArrowUp" ? i - 1 : i + 1];
        if (other) { e.key === "ArrowUp" ? other.before(s) : other.after(s); saveOrder(); head.focus(); }
      }
    });

    // drag the heading to move the whole section
    head.draggable = true;
    head.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", key);
      s.classList.add("dragging");
    });
    head.addEventListener("dragend", () => {
      s.classList.remove("dragging");
      for (const x of sections()) x.classList.remove("drop-before", "drop-after");
    });
  }
  const dragged = () => nav.querySelector(".nav-section.dragging");
  const target = (e) => {
    const s = e.target.closest && e.target.closest(".nav-section");
    if (!s || s === dragged()) return null;
    const r = s.getBoundingClientRect();
    return { s, before: e.clientY < r.top + r.height / 2 };
  };
  nav.addEventListener("dragover", (e) => {
    if (!dragged()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const t = target(e);
    for (const x of sections()) x.classList.remove("drop-before", "drop-after");
    if (t) t.s.classList.add(t.before ? "drop-before" : "drop-after");
  });
  nav.addEventListener("drop", (e) => {
    const s = dragged(), t = target(e);
    if (!s) return;
    e.preventDefault();
    if (t) (t.before ? t.s.before(s) : t.s.after(s));
    saveOrder();
  });

  // width: drag the sidebar's edge (double-click resets, arrow keys nudge)
  const app = $("app"), handle = $("sidebar-resizer");
  const setWidth = (w, save = true) => {
    w = Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, w)));
    app.style.setProperty("--sidebar-w", `${w}px`);
    handle.setAttribute("aria-valuenow", String(w));
    if (save) writePref("sidebar:width", w);
  };
  setWidth(Number(readPref("sidebar:width", SIDEBAR_WIDTH.default)) || SIDEBAR_WIDTH.default, false);
  handle.setAttribute("aria-valuemin", String(SIDEBAR_WIDTH.min));
  handle.setAttribute("aria-valuemax", String(SIDEBAR_WIDTH.max));
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const left = $("sidebar").getBoundingClientRect().left;
    const move = (ev) => setWidth(ev.clientX - left, false);
    const up = (ev) => {
      setWidth(ev.clientX - left);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
  handle.addEventListener("dblclick", () => setWidth(SIDEBAR_WIDTH.default));
  handle.addEventListener("keydown", (e) => {
    const now = Number(handle.getAttribute("aria-valuenow"));
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setWidth(now + (e.key === "ArrowRight" ? 16 : -16)); }
  });
}

// ---------- wiring ----------
function init() {
  initStudentAssistant();
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
  $("ai-settings-btn").addEventListener("click", openGlobalAISettings);
  $("ai-settings-close").addEventListener("click", () => { $("ai-settings-dialog").hidden = true; $("ai-settings-btn").focus(); });
  setupSidebar();
  setInterval(() => { if (state.timetable.data && !$("app").hidden) renderEclassNav(); }, 60 * 1000);   // "τώρα" marks
  renderThemeButton();
  $("theme-btn").addEventListener("click", () => {
    const order = ["auto", "light", "dark"];
    const next = order[(order.indexOf(currentTheme()) + 1) % order.length];
    setTheme(next);
    toast(`Θέμα: ${THEMES[next]}`);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentTheme() === "auto" && state.view.type === "mail" && state.current) renderReader();
  });
  $("compose-btn").addEventListener("click", () => openCompose());
  $("compose-cancel").addEventListener("click", closeCompose);
  $("compose-form").addEventListener("submit", onSend);
  $("add-feed-btn").addEventListener("click", openFeedDialog);
  $("feed-cancel").addEventListener("click", () => ($("feed-dialog").hidden = true));
  $("feed-form").addEventListener("submit", onAddFeed);
  $("menu-btn").addEventListener("click", () => {
    const open = $("menu-btn").getAttribute("aria-expanded") === "true";
    setSidebarOpen(!open);
  });
  $("scrim").addEventListener("click", closeMobileSidebar);
  $("more-btn").addEventListener("click", () => { state.page += 1; loadMail({ append: true }); });
  $("refresh-btn").addEventListener("click", () => {
    if (state.view.type === "mail") { state.page = 0; loadMail({ refresh: true }); refreshUnreadCount(); }
    else if (state.view.type === "ditlab") openDitlab(true);
    else if (state.view.type === "grades") loadGrades(true);
    else if (state.view.type === "lectures") loadLectures(true);
    else if (state.view.type === "timetable") loadTimetable(true);
    else if (state.view.type === "deadlines") loadDeadlines(true);
    else if (state.view.type === "briefing") startBriefing(true);
    else if (state.view.type === "projects") loadProjects(true);
    else if (state.view.type === "study") loadStudy();
    else if (state.view.type === "piazza") loadPiazza(true);
    else if (state.view.type === "tools") renderTools();
    else if (currentCourse() && activeCourseTab(currentCourse()) !== "ann") {
      const c = currentCourse(), [, tab, dir] = courseTab.view.split("|");
      loadCourseTab(c, tab, dir, true);
    }
    else if (state.view.type === "studies") loadStudies(state.studies.tab, true);
    else {
      loadAnnouncements(true);
      if (state.view.cat && topicKeys[state.view.cat] && state.inst.id === "uoa")
        loadTopicAnnouncements(state.view.cat, state.topicPageByCategory.get(state.view.cat) || 0, true);
      if (state.eclass.enabled) loadEclass(true);
    }
  });
  $("eclass-refresh").addEventListener("click", () => loadEclass(true));
  $("player-close").addEventListener("click", closePlayer);
  $("player").addEventListener("click", (e) => { if (e.target === $("player")) closePlayer(); });
  $("player-prev").addEventListener("click", () => stepPlayer(-1));
  $("player-next").addEventListener("click", () => stepPlayer(1));
  const video = $("player-video");
  video.addEventListener("timeupdate", () => savePosition(false));
  video.addEventListener("pause", () => savePosition(true));
  video.addEventListener("ended", () => { savePosition(true); stepPlayer(1, true); });
  video.addEventListener("error", onVideoError);
  video.addEventListener("waiting", () => { $("player-spinner").hidden = false; });
  for (const ev of ["playing", "pause", "canplay"]) video.addEventListener(ev, () => { $("player-spinner").hidden = true; });
  video.addEventListener("play", () => { $("player-start").hidden = true; });
  video.addEventListener("playing", () => { $("player-error").hidden = true; });
  $("player-start").addEventListener("click", startPlayback);
  $("proj-dialog").addEventListener("click", (e) => { if (e.target === $("proj-dialog")) $("proj-dialog").hidden = true; });
  $("study-dialog").addEventListener("click", (e) => { if (e.target === $("study-dialog")) $("study-dialog").hidden = true; });
  $("study-close").addEventListener("click", closeSession);
  $("viewer-close").addEventListener("click", closeViewer);
  $("viewer-prev").addEventListener("click", () => stepViewer(-1));
  $("viewer-next").addEventListener("click", () => stepViewer(1));
  $("viewer").addEventListener("click", (e) => { if (e.target === $("viewer")) closeViewer(); });
  $("player-cc").addEventListener("click", toggleSubs);
  $("player-fx").addEventListener("click", () => toggleSide(undefined, "fx"));
  $("player-ai").addEventListener("click", () => toggleSide(undefined, "ai"));
  $("player-video").addEventListener("timeupdate", markAISection);
  try { toggleSide(localStorage.getItem("uf:side") !== "0" && innerWidth > 820); } catch { toggleSide(innerWidth > 820); }
  const searchMail = debounce(() => { state.page = 0; state.selected = null; loadMail(); }, 350);
  const searchAnn = debounce(renderAnnouncements, 120);
  const searchDitlab = debounce(ditlabSearch, 400);
  const searchLectures = debounce(renderLectures, 120);
  $("search").addEventListener("input", () => {
    state.query = $("search").value.trim().toLowerCase();
    if (state.view.type === "mail") searchMail();
    else if (state.view.type === "ditlab") searchDitlab();
    else if (state.view.type === "grades") renderGrades();
    else if (state.view.type === "lectures") searchLectures();
    else if (state.view.type === "timetable") renderTimetable();
    else if (state.view.type === "deadlines") renderDeadlines();
    else if (state.view.type === "briefing") renderBriefing();
    else if (state.view.type === "projects") renderProjects();
    else if (state.view.type === "study") renderStudy();
    else if (state.view.type === "piazza") renderPiazza();
    else if (currentCourse() && activeCourseTab(currentCourse()) !== "ann") renderCourseTab();
    else if (state.view.type === "studies") renderStudies();
    else searchAnn();
  });

  document.addEventListener("keydown", (e) => {
    if (!$("ai-settings-dialog").hidden) {
      if (e.key === "Escape") {
        $("ai-settings-dialog").hidden = true;
        $("ai-settings-btn").focus();
      }
      if (e.key === "Tab") {
        const controls = [...$("ai-settings-dialog").querySelectorAll("button, select, input")];
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    if (e.key === "Escape") {
      if (!$("viewer").hidden) closeViewer();
      else if (!$("study-dialog").hidden) $("study-dialog").hidden = true;
      else if (!$("player").hidden && !$("study").hidden) closePlayer();
      else if (!$("study").hidden) closeSession();
      else if (!$("proj-dialog").hidden) $("proj-dialog").hidden = true;
      else if (!$("player").hidden) closePlayer();
      else if (!$("tt-dialog").hidden) $("tt-dialog").hidden = true;
      else if (!$("compose").hidden) closeCompose();
      else if (!$("feed-dialog").hidden) $("feed-dialog").hidden = true;
      else closeMobileSidebar();
      return;
    }
    if ($("app").hidden || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (!$("study").hidden && $("viewer").hidden && $("player").hidden) {
      if ((e.key === " " || e.key === "Enter") && !session.flipped) { e.preventDefault(); flipCard(); }
      else if ((e.key === "ArrowRight" || e.key === " ") && session.flipped && e.target.tagName !== "BUTTON") { e.preventDefault(); nextCard(); }
      else if (e.key === "ArrowRight" && session.flipped) { e.preventDefault(); nextCard(); }
      return;
    }
    if (!$("viewer").hidden) {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); stepViewer(e.key === "ArrowLeft" ? -1 : 1); }
      if (viewer.zoomBy && viewKind(viewer.list[viewer.index]?.name) === "image") {
        if (e.key === "+" || e.key === "=") viewer.zoomBy(1.25);
        if (e.key === "-") viewer.zoomBy(1 / 1.25);
        if (e.key === "0") viewer.zoomFit();
        if (e.key === "1") viewer.zoomActual();
      }
      return;
    }
    if (!$("player").hidden) {
      if (e.key === "c") { e.preventDefault(); toggleSubs(); }
      if (e.key === "]" || e.key === "[") { e.preventDefault(); setFx("rate", fx.rate + (e.key === "]" ? 0.25 : -0.25)); }
      return;
    }
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
