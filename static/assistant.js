"use strict";

const studentAssistant = { data: null, timer: 0, request: 0, signature: "" };
const ASSISTANT_TOOLS = { overview: "Επισκόπηση", courses: "Μαθήματα", course: "Στοιχεία μαθήματος", deadlines: "Προθεσμίες",
  news: "Ανακοινώσεις", folder: "Άνοιγμα φακέλου", search_files: "Αναζήτηση σε υποφακέλους", document: "Ανάγνωση εγγράφου",
  mail_search: "Αναζήτηση email", mail_read: "Ανάγνωση email", grades: "Βαθμολογίες", timetable: "Πρόγραμμα",
  calendar: "Ημερολόγιο", projects: "Projects", study: "Κάρτες μελέτης", lectures: "Βιντεοδιαλέξεις", lecture: "Κείμενο διάλεξης", piazza: "Piazza" };

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
    data.error || (data.busy ? (ASSISTANT_TOOLS[data.activity?.at(-1)] || "Σκέφτομαι…") : data.messages.length ? "Έτοιμο" : "Κάνε μια ερώτηση για να ξεκινήσουμε."));
  $("assistant-send").disabled = !!data.busy;
  $("assistant-stop").hidden = !data.busy;
  $("assistant-clear").disabled = !!data.busy;
  const activity = $("assistant-activity");
  activity.replaceChildren(...(data.activity || []).map((tool) => h("li", null, ASSISTANT_TOOLS[tool] || tool)));
  $("assistant-activity-wrap").hidden = !(data.activity?.length);
  $("assistant-provider").textContent = data.provider ? aiProviderName(data.provider) : "Επιλεγμένο AI CLI";
}

async function sendStudentAssistant(question) {
  question = (question || $("assistant-question").value).trim();
  if (!question || studentAssistant.data?.busy) return;
  $("assistant-send").disabled = true;
  const request = ++studentAssistant.request;
  try {
    const data = await api("/api/assistant", { method: "POST", body: { question } });
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
  $("assistant-stop").addEventListener("click", () => cancel(false));
  $("assistant-clear").addEventListener("click", () => cancel(true));
}
