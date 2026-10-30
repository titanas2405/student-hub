"use strict";

const studentAssistant = { data: null, timer: 0, request: 0, signature: "",
  access: { project: "", read: false, write: false, delete: false, run: false }, accessLoaded: false, defaultTypes: "" };
const ASSISTANT_TOOLS = { overview: "Επισκόπηση", courses: "Μαθήματα", course: "Στοιχεία μαθήματος", deadlines: "Προθεσμίες",
  news: "Ανακοινώσεις", folder: "Άνοιγμα φακέλου", search_files: "Αναζήτηση σε υποφακέλους", document: "Ανάγνωση εγγράφου",
  mail_search: "Αναζήτηση email", mail_read: "Ανάγνωση email", grades: "Βαθμολογίες", timetable: "Πρόγραμμα",
  calendar: "Ημερολόγιο", projects: "Projects", study: "Κάρτες μελέτης", lectures: "Βιντεοδιαλέξεις", lecture: "Κείμενο διάλεξης", piazza: "Piazza",
  project_files: "Αρχεία project", project_read: "Ανάγνωση αρχείου", project_write: "Εγγραφή αρχείου", project_delete: "Διαγραφή αρχείου", project_run: "Εντολή" };
const assistantTool = (entry) => {
  const [tool, ...rest] = String(entry).split(": ");
  return (ASSISTANT_TOOLS[tool] || tool) + (rest.length ? ": " + rest.join(": ") : "");
};

// Read/write/delete/command access to one project: only offered in the Projects tab, off until switched on.
function assistantAccessActive() {
  const a = studentAssistant.access;
  return state.view.type === "projects" && !!a.project && ["read", "write", "delete", "run"].some((p) => a[p]);
}

async function loadAssistantAccess() {
  try {
    const data = await api("/api/assistant/access");
    studentAssistant.accessLoaded = true;
    studentAssistant.defaultTypes = data.defaultTypes;
    const local = data.projects.filter((p) => p.local);
    fill($("assistant-project"), local.length ? local.map((p) => h("option", { value: p.id }, p.name))
      : h("option", { value: "" }, "Κανένα project σε αυτόν τον υπολογιστή"));
    if (!local.some((p) => p.id === studentAssistant.access.project)) studentAssistant.access.project = local[0]?.id || "";
    $("assistant-project").value = studentAssistant.access.project;
    $("assistant-types").value = data.types;
    $("assistant-args").value = data.args;
  } catch (err) { $("assistant-access-status").textContent = err.message; }
  renderAssistantAccess();
}

function renderAssistantAccess() {
  const panel = $("assistant-access");
  if (!panel) return;
  const show = state.view.type === "projects";
  panel.hidden = !show;
  const a0 = studentAssistant.access, names = { read: "ανάγνωση", write: "εγγραφή", delete: "διαγραφή", run: "εντολές" };
  const granted = Object.keys(names).filter((p) => a0[p]);
  const badge = $("assistant-access-badge");
  badge.hidden = !granted.length || !a0.project;
  badge.classList.toggle("off", !show);
  badge.textContent = show
    ? `Πρόσβαση στο ${$("assistant-project").selectedOptions[0]?.textContent || "project"}: ${granted.map((p) => names[p]).join(", ")}`
    : "Η πρόσβαση στο project ισχύει μόνο στην καρτέλα Projects· εδώ ο βοηθός δεν αλλάζει αρχεία.";
  if (!show) return;
  if (!studentAssistant.accessLoaded) { studentAssistant.accessLoaded = true; loadAssistantAccess(); return; }
  const a = studentAssistant.access;
  for (const button of panel.querySelectorAll("[data-perm]")) {
    button.setAttribute("aria-pressed", String(!!a[button.dataset.perm]));
    button.disabled = !a.project;
  }
  if (!a.project) $("assistant-access-badge").hidden = true;
  const on = ["read", "write", "delete", "run"].filter((p) => a[p]);
  $("assistant-access-note").textContent = !a.project ? "Δημιούργησε ή άνοιξε ένα project για να δώσεις πρόσβαση."
    : !on.length ? "Το AI δεν έχει πρόσβαση στο project. Πάτησε ό,τι επιτρέπεις."
    : (a.delete || a.run ? "Προσοχή: " : "") + "Το AI μπορεί να " + [a.read && "διαβάζει", a.write && "γράφει", a.delete && "διαγράφει", a.run && "τρέχει εντολές"].filter(Boolean).join(", ") +
      " μόνο σε αυτό το project. Κάθε αλλαγή φαίνεται στην απάντηση και κρατιέται αντίγραφο ασφαλείας." +
      (a.run ? " Οι εντολές τρέχουν με τα δικαιώματά σου." : "");
}

function resetStudentAssistant() {
  clearTimeout(studentAssistant.timer);
  studentAssistant.request++;
  studentAssistant.data = null;
  studentAssistant.signature = "";
  $("student-assistant").hidden = true;
  $("app").classList.remove("assistant-open");
  $("assistant-toggle").setAttribute("aria-expanded", "false");
  $("assistant-messages").replaceChildren();
  $("assistant-status").textContent = "";
  $("assistant-question").value = "";
  Object.assign(studentAssistant.access, { project: "", read: false, write: false, delete: false, run: false });
  studentAssistant.accessLoaded = false;
}

function toggleStudentAssistant(open = $("student-assistant").hidden) {
  $("student-assistant").hidden = !open;
  $("app").classList.toggle("assistant-open", open);
  $("assistant-toggle").setAttribute("aria-expanded", String(open));
  clearTimeout(studentAssistant.timer);
  if (open) {
    pollStudentAssistant();
    $("assistant-question").focus();
  } else $("assistant-toggle").focus();
}

async function pollStudentAssistant() {
  clearTimeout(studentAssistant.timer);
  if ($("student-assistant").hidden || $("app").hidden) return;
  const request = studentAssistant.request;
  try {
    const data = await api("/api/assistant");
    if (request !== studentAssistant.request) return;
    studentAssistant.data = data;
    renderStudentAssistant();
    if (data.busy) studentAssistant.timer = setTimeout(pollStudentAssistant, 1800);
  } catch (err) {
    if (request === studentAssistant.request) $("assistant-status").textContent = err.message;
  }
}

function assistantSource(ref) {
  return h("button", { type: "button", class: "assistant-source", title: ref.id, onclick: () => {
    if (ref.file) {
      const file = ref.file;
      const item = { name: ref.title, src: { src: file.source } };
      if (file.source === "eclass") item.src.url = file.url;
      if (file.source === "ditlab") item.src.path = file.path;
      if (file.source === "mail") Object.assign(item.src, { folder: file.folder, uid: file.uid, i: file.part });
      if (!openViewer([item], 0)) window.open(viewUrl(item), "_blank", "noopener");
      return;
    }
    if (ref.view === "mail") {
      navigate({ type: "mail", folder: ref.folder, unread: false });
      openMessage({ uid: ref.uid, unread: false });
    } else if (ref.view === "course") navigate({ type: "ann", feed: "ec:" + ref.course });
    else if (["briefing", "grades", "timetable", "deadlines", "projects", "study", "piazza", "lectures", "ann"].includes(ref.view)) {
      navigate({ type: ref.view });
    }
  } }, "↗ ", ref.title);
}

function assistantAnswer(message) {
  if (message.role === "user") return h("div", { class: "assistant-answer user-text" }, message.text);
  const body = h("div", { class: "assistant-answer" }, mdDocument(message.text || ""));
  const sources = new Map((message.sources || []).map((ref) => [ref.id, ref]));
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement.closest("pre, code, a, button")) texts.push(walker.currentNode);
  }
  for (const node of texts) {
    const pattern = /\[([A-Za-z][A-Za-z0-9:_-]{0,79})\]/g;
    const fragment = document.createDocumentFragment();
    let last = 0, match;
    while ((match = pattern.exec(node.textContent))) {
      const ref = sources.get(match[1]);
      if (!ref && !/^[A-Z]\d+$/.test(match[1])) continue;
      fragment.append(document.createTextNode(node.textContent.slice(last, match.index)));
      if (ref) {
        const button = assistantSource(ref);
        button.classList.add("assistant-citation");
        button.textContent = `[${ref.id}]`;
        button.title = ref.title;
        fragment.append(button);
      } else fragment.append(h("span", { class: "assistant-citation unavailable", title: "Η πηγή δεν είναι διαθέσιμη σε αυτή την απάντηση" }, match[0]));
      last = pattern.lastIndex;
    }
    if (last) {
      fragment.append(document.createTextNode(node.textContent.slice(last)));
      node.replaceWith(fragment);
    }
  }
  return body;
}

function renderStudentAssistant() {
  const data = studentAssistant.data || { messages: [] };
  const signature = JSON.stringify(data.messages);
  if (signature !== studentAssistant.signature) {
    studentAssistant.signature = signature;
    const list = $("assistant-messages"), nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
    list.replaceChildren(...data.messages.map((message) => h("article", { class: "assistant-message " + message.role },
      h("small", null, message.role === "user" ? "Εσύ" : aiProviderName(message.provider)),
      assistantAnswer(message),
      message.sources?.length ? h("div", { class: "assistant-sources", "aria-label": "Πηγές" }, message.sources.map(assistantSource)) : null)));
    if (nearBottom || data.messages.at(-1)?.role === "user") list.scrollTop = list.scrollHeight;
  }
  fill($("assistant-status"), data.busy ? h("span", { class: "spinner" }) : null,
    data.error || (data.busy ? (data.activity?.length ? assistantTool(data.activity.at(-1)) : "Σκέφτομαι…") : data.messages.length ? "Έτοιμο" : "Κάνε μια ερώτηση για να ξεκινήσουμε."));
  $("assistant-send").disabled = !!data.busy;
  $("assistant-stop").hidden = !data.busy;
  $("assistant-clear").disabled = !!data.busy;
  const activity = $("assistant-activity");
  activity.replaceChildren(...(data.activity || []).map((tool) => h("li", null, assistantTool(tool))));
  $("assistant-activity-wrap").hidden = !(data.activity?.length);
  $("assistant-provider").textContent = data.provider ? aiProviderName(data.provider) : "Επιλεγμένο AI CLI";
}

async function sendStudentAssistant(question) {
  question = (question || $("assistant-question").value).trim();
  if (!question || studentAssistant.data?.busy) return;
  $("assistant-send").disabled = true;
  const request = ++studentAssistant.request;
  try {
    const access = assistantAccessActive() ? studentAssistant.access : null;
    const data = await api("/api/assistant", { method: "POST", body: { question, access } });
    if (request !== studentAssistant.request) return;
    $("assistant-question").value = "";
    studentAssistant.data = data;
    renderStudentAssistant();
    pollStudentAssistant();
  } catch (err) {
    if (request === studentAssistant.request) {
      $("assistant-status").textContent = err.message;
      $("assistant-send").disabled = false;
    }
  }
}

function initStudentAssistant() {
  $("assistant-toggle").addEventListener("click", () => toggleStudentAssistant());
  $("assistant-close").addEventListener("click", () => toggleStudentAssistant(false));
  $("assistant-settings").addEventListener("click", openGlobalAISettings);
  $("assistant-form").addEventListener("submit", (event) => { event.preventDefault(); sendStudentAssistant(); });
  $("assistant-question").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendStudentAssistant(); }
    if (event.key === "Escape") { event.stopPropagation(); toggleStudentAssistant(false); }
  });
  for (const button of document.querySelectorAll("[data-assistant-prompt]")) {
    button.addEventListener("click", () => sendStudentAssistant(button.dataset.assistantPrompt));
  }
  const cancel = async (clear) => {
    const request = ++studentAssistant.request;
    clearTimeout(studentAssistant.timer);
    try {
      const data = await api("/api/assistant", { method: "DELETE", body: { clear } });
      if (request !== studentAssistant.request) return;
      studentAssistant.data = data;
      renderStudentAssistant();
    } catch (err) { if (request === studentAssistant.request) $("assistant-status").textContent = err.message; }
  };
  for (const button of document.querySelectorAll("#assistant-access [data-perm]")) {
    button.addEventListener("click", () => {
      const perm = button.dataset.perm, a = studentAssistant.access;
      a[perm] = !a[perm];
      if (a[perm] && perm !== "read") a.read = true;           // changing files needs seeing them
      if (!a.read) a.write = a.delete = a.run = false;
      renderAssistantAccess();
    });
  }
  $("assistant-project").addEventListener("change", () => {
    Object.assign(studentAssistant.access, { project: $("assistant-project").value, read: false, write: false, delete: false, run: false });
    renderAssistantAccess();
  });
  $("assistant-types-reset").addEventListener("click", () => { $("assistant-types").value = studentAssistant.defaultTypes; });
  $("assistant-access-save").addEventListener("click", async () => {
    try {
      const data = await api("/api/assistant/access", { method: "POST", body: { types: $("assistant-types").value, args: $("assistant-args").value } });
      $("assistant-types").value = data.types;
      $("assistant-access-status").textContent = "Αποθηκεύτηκε.";
    } catch (err) { $("assistant-access-status").textContent = err.message; }
  });
  $("assistant-stop").addEventListener("click", () => cancel(false));
  $("assistant-clear").addEventListener("click", () => cancel(true));
}
