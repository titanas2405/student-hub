"use strict";

// Extra tools share the app's DOM helpers and download behavior.
async function uploadTool(operation, files, fields = {}) {
  if (!files.length || files.length > 20) throw new Error("Choose between 1 and 20 files.");
  if (files.some((file) => !file.size) || files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024)
    throw new Error("Choose nonempty files totalling at most 50 MB.");
  const form = new FormData();
  for (const file of files) form.append("files", file);
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const response = await fetch(`/api/tools/process?op=${encodeURIComponent(operation)}`, {
    method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": state.csrf }, body: form,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401) showLogin("Your session ended. Please sign in again.");
    throw new Error(error.error || "Couldn't process this file.");
  }
  return response;
}

function toolSize(bytes) {
  return bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;
}

function toolField(label, input) {
  return h("label", { class: "field" }, h("span", {}, label), input);
}

function toolStatus() { return h("p", { role: "status", "aria-live": "polite" }); }

function requireToolPrograms(capabilities, names, button, status, setup) {
  button.disabled = true;
  capabilities.then((data) => {
    const missing = names.filter((name) => !data[name]);
    button.disabled = !!missing.length;
    if (missing.length) status.textContent = `${setup} Missing: ${missing.join(", ")}.`;
  }).catch((err) => { status.textContent = err.message; });
}

function orderedToolFiles(input) {
  let files = [];
  const list = h("ol", { class: "tool-file-order" });
  const render = () => fill(list, files.map((file, index) => h("li", {},
    h("span", {}, file.name),
    h("button", { type: "button", class: "btn plain", disabled: index === 0, "aria-label": `Move ${file.name} up`, onclick: () => {
      [files[index - 1], files[index]] = [files[index], files[index - 1]]; render();
    } }, "↑"),
    h("button", { type: "button", class: "btn plain", disabled: index === files.length - 1, "aria-label": `Move ${file.name} down`, onclick: () => {
      [files[index], files[index + 1]] = [files[index + 1], files[index]]; render();
    } }, "↓"))));
  input.addEventListener("change", () => { files = Array.from(input.files); render(); });
  return { list, files: () => [...files] };
}

async function imagesToPdf(files, progress = () => {}) {
  if (!files.length || files.length > 20 || files.some((f) => !f.size) || files.reduce((s, f) => s + f.size, 0) > 50 * 1048576)
    throw new Error("Choose 1–20 nonempty images totalling at most 50 MB.");
  const encoder = new TextEncoder(), objects = [];
  const text = (value) => encoder.encode(value);
  objects.push(text("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(text(`<< /Type /Pages /Count ${files.length} /Kids [${files.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`));
  for (let i = 0; i < files.length; i++) {
    progress(i + 1, files.length);
    let image;
    try {
      image = await createImageBitmap(files[i]);
      if (image.width * image.height > 40000000) throw new Error("Choose images under 40 megapixels.");
      const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!jpeg) throw new Error("Couldn't read this image.");
      const wide = canvas.width > canvas.height, pw = wide ? 842 : 595, ph = wide ? 595 : 842;
      const fit = Math.min((pw - 48) / canvas.width, (ph - 48) / canvas.height);
      const w = canvas.width * fit, height = canvas.height * fit;
      const content = text(`q ${w.toFixed(3)} 0 0 ${height.toFixed(3)} ${((pw - w) / 2).toFixed(3)} ${((ph - height) / 2).toFixed(3)} cm /Im0 Do Q`);
      const pageId = 3 + i * 3;
      objects.push(text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${pageId + 1} 0 R >> >> /Contents ${pageId + 2} 0 R >>`));
      objects.push(new Blob([text(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.size} >>\nstream\n`), jpeg, text("\nendstream")]));
      objects.push(new Blob([text(`<< /Length ${content.length} >>\nstream\n`), content, text("\nendstream")]));
    } finally { image?.close(); }
  }
  const chunks = [text("%PDF-1.4\n")], offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, i) => {
    offsets.push(offset);
    const chunk = new Blob([text(`${i + 1} 0 obj\n`), object, text("\nendobj\n")]);
    chunks.push(chunk); offset += chunk.size;
  });
  chunks.push(text(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return new Blob(chunks, { type: "application/pdf" });
}

function pdfToolCards(card, capabilities) {
  const compressFile = h("input", { type: "file", accept: ".pdf", "aria-label": "PDF to compress" });
  const quality = h("select", { "aria-label": "PDF compression quality" },
    h("option", { value: "ebook" }, "Balanced · 150 dpi"), h("option", { value: "screen" }, "Smallest · 72 dpi"), h("option", { value: "printer" }, "High quality · 300 dpi"));
  const compressStatus = toolStatus();
  const compress = h("button", { type: "button", class: "btn primary", onclick: async () => {
    compress.disabled = true; compressStatus.textContent = "Compressing PDF…";
    try {
      const file = compressFile.files[0];
      const response = await uploadTool("compress", file ? [file] : [], { quality: quality.value });
      const blob = await response.blob();
      if (blob.size >= file.size) { compressStatus.textContent = `Already optimized: ${toolSize(file.size)}. Try the smallest preset; no larger file was downloaded.`; return; }
      downloadToolFile(blob, file.name.replace(/\.pdf$/i, "") + "-compressed.pdf");
      compressStatus.textContent = `${toolSize(file.size)} → ${toolSize(blob.size)} · ${(100 * (1 - blob.size / file.size)).toFixed(1)}% smaller. Downloaded.`;
    } catch (err) { compressStatus.textContent = err.message; }
    finally { compress.disabled = false; }
  } }, "Compress PDF");
  requireToolPrograms(capabilities, ["gs", "pdfinfo"], compress, compressStatus, "Install Ghostscript and Poppler to enable PDF compression.");

  const mergeFile = h("input", { type: "file", accept: ".pdf", multiple: true, "aria-label": "PDFs to merge" });
  const order = orderedToolFiles(mergeFile), mergeStatus = toolStatus();
  const merge = h("button", { type: "button", class: "btn primary", onclick: async () => {
    merge.disabled = true; mergeStatus.textContent = "Merging PDFs…";
    try {
      const files = order.files();
      if (files.length < 2) throw new Error("Choose at least two PDFs.");
      const response = await uploadTool("merge", files);
      downloadToolFile(await response.blob(), "merged.pdf"); mergeStatus.textContent = "Merged PDF downloaded.";
    } catch (err) { mergeStatus.textContent = err.message; }
    finally { merge.disabled = false; }
  } }, "Merge PDFs");
  requireToolPrograms(capabilities, ["pdfunite", "pdfinfo"], merge, mergeStatus, "Install Poppler to enable merging.");
  const splitFile = h("input", { type: "file", accept: ".pdf", "aria-label": "PDF to split" });
  const pages = h("input", { type: "text", placeholder: "1-3, 5, 8-10", "aria-label": "Pages to extract" });
  const splitStatus = toolStatus();
  const split = h("button", { type: "button", class: "btn primary", onclick: async () => {
    split.disabled = true; splitStatus.textContent = "Extracting pages…";
    try {
      const response = await uploadTool("split", Array.from(splitFile.files), { pages: pages.value });
      downloadToolFile(await response.blob(), "extracted-pages.pdf"); splitStatus.textContent = "Selected pages downloaded as one PDF.";
    } catch (err) { splitStatus.textContent = err.message; }
    finally { split.disabled = false; }
  } }, "Extract selected pages");
  requireToolPrograms(capabilities, ["pdfunite", "pdfseparate", "pdfinfo"], split, splitStatus, "Install Poppler to enable page extraction.");

  const imageFiles = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true, "aria-label": "Images for PDF" });
  const imageOrder = orderedToolFiles(imageFiles), imageStatus = toolStatus();
  const imageButton = h("button", { type: "button", class: "btn primary", onclick: async () => {
    imageButton.disabled = true;
    try {
      const pdf = await imagesToPdf(imageOrder.files(), (i, total) => { imageStatus.textContent = `Adding image ${i} of ${total}…`; });
      downloadToolFile(pdf, "notes.pdf"); imageStatus.textContent = "PDF downloaded.";
    } catch (err) { imageStatus.textContent = err.message; }
    finally { imageButton.disabled = false; }
  } }, "Create PDF");
  return [
    card("PDF compressor", "Reduce PDFs before uploading assignments. Up to 50 MB and 300 pages. Compression can reduce image quality and changes invalidate digital signatures.", compressFile, quality, compress, compressStatus),
    card("PDF merge & split", "Merge 2–20 PDFs in the order below, or extract pages into a new PDF. Up to 50 MB and 300 pages total. Documents are processed on this computer.",
      toolField("PDFs to merge", mergeFile), order.list, merge, mergeStatus,
      toolField("PDF to split", splitFile), toolField("Pages (in the order you want)", pages), split, splitStatus),
    card("Images → PDF", "Combine up to 20 photos or screenshots into one PDF. Reorder them below. Fits each image on an A4 page; large images are resized to 2400 px. Runs in your browser.",
      imageFiles, imageOrder.list, imageButton, imageStatus),
  ];
}

function archiveToolCard(card) {
  const input = h("input", { type: "file", accept: ".zip", "aria-label": "ZIP to extract" });
  const status = toolStatus(), list = h("div", { class: "tool-archive-list" });
  const inspect = h("button", { type: "button", class: "btn primary", onclick: async () => {
    const file = input.files[0];
    inspect.disabled = input.disabled = true; status.textContent = "Reading ZIP…"; fill(list);
    try {
      const response = await uploadTool("zip-list", file ? [file] : []), data = await response.json();
      const files = data.entries.filter((entry) => !entry.directory);
      status.textContent = `${files.length} files · ${toolSize(files.reduce((sum, entry) => sum + entry.size, 0))} extracted. Choose a file to download.`;
      fill(list, files.map((entry) => {
        const button = h("button", { type: "button", class: "btn plain", onclick: async () => {
          button.disabled = true; status.textContent = `Extracting ${entry.path}…`;
          try {
            const result = await uploadTool("zip-entry", [file], { entry: entry.path });
            downloadToolFile(await result.blob(), entry.path.split("/").pop());
            status.textContent = `Downloaded ${entry.path}.`;
          } catch (err) { status.textContent = err.message; }
          finally { button.disabled = false; }
        } }, "Download");
        return h("div", { class: "tool-archive-entry" }, h("span", {}, `${entry.path} · ${toolSize(entry.size)}`), button);
      }));
    } catch (err) { status.textContent = err.message; }
    finally { inspect.disabled = input.disabled = false; }
  } }, "Open ZIP");
  input.addEventListener("change", () => { fill(list); status.textContent = ""; });
  return card("ZIP extractor", "Browse an archive and download individual files without opening it elsewhere. Up to 50 MB compressed, 200 MB extracted and 2,000 entries. Password-protected archives aren't supported.", input, inspect, status, list);
}

const TOOL_UNITS = {
  Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, inches: 0.0254, feet: 0.3048, miles: 1609.344 },
  Weight: { kg: 1, g: 0.001, mg: 0.000001, tonnes: 1000, pounds: 0.45359237, ounces: 0.028349523125 },
  Temperature: { "°C": 1, "°F": 1, K: 1 },
  "Data size": { B: 1, KB: 1000, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824, bits: 0.125 },
  Time: { seconds: 1, minutes: 60, hours: 3600, days: 86400, weeks: 604800 },
};

function convertToolUnits(category, value, from, to) {
  const units = TOOL_UNITS[category];
  if (!Number.isFinite(value) || !units || !(from in units) || !(to in units)) throw new Error("Enter a valid number and units.");
  let result;
  if (category === "Temperature") {
    const c = from === "°F" ? (value - 32) * 5 / 9 : from === "K" ? value - 273.15 : value;
    if (c < -273.15 - 1e-9) throw new Error("Temperature cannot be below absolute zero.");
    result = to === "°F" ? c * 9 / 5 + 32 : to === "K" ? c + 273.15 : c;
  } else {
    if (value < 0 && category !== "Length") throw new Error("Enter a nonnegative value.");
    result = value * units[from] / units[to];
  }
  if (!Number.isFinite(result)) throw new Error("This value is too large.");
  return result;
}

function gradeToolResult(current, weight, target, maximum) {
  if (![current, weight, target, maximum].every(Number.isFinite) || maximum <= 0 || weight <= 0 || weight > 100 ||
      current < 0 || current > maximum || target < 0 || target > maximum)
    throw new Error("Enter valid grades within your scale and an exam weight above 0% and up to 100%.");
  return (target - current * (1 - weight / 100)) / (weight / 100);
}

function gradeToolCard(card) {
  const number = (label, value, min, max) => h("input", { type: "number", value, min, max, step: "any", "aria-label": label });
  const maximum = number("Grade scale maximum", "10", "0.01", "1000");
  const current = number("Current coursework average", "7", "0", "1000");
  const weight = number("Final exam weight percent", "60", "0.01", "100");
  const target = number("Target final grade", "5", "0", "1000");
  const result = toolStatus();
  const calculate = () => {
    try {
      const inputs = [current, weight, target, maximum];
      if (inputs.some((input) => !input.value.trim())) throw new Error("Fill in all four fields.");
      const needed = gradeToolResult(...inputs.map((input) => Number(input.value)));
      result.textContent = needed <= 0 ? "Your coursework already meets this target; you need 0 on the exam mathematically." :
        needed > Number(maximum.value) ? `You would need ${needed.toFixed(2)} / ${maximum.value}, which exceeds this scale.` :
        `You need at least ${(Math.ceil((needed - 1e-10) * 100) / 100).toFixed(2)} / ${maximum.value} on the final exam.`;
    } catch (err) { result.textContent = err.message; }
  };
  [maximum, current, weight, target].forEach((input) => input.addEventListener("input", calculate));
  calculate();
  return card("Grade calculator", "Calculate the exam score needed for your target. Coursework means the average of everything except the final exam. Course rules may require a separate minimum exam score.",
    toolField("Grade scale maximum (e.g. 10 or 100)", maximum), toolField("Current coursework average", current),
    toolField("Final exam weight (%)", weight), toolField("Target final grade", target), result);
}

function unitToolCard(card) {
  const category = h("select", { "aria-label": "Unit category" }, Object.keys(TOOL_UNITS).map((name) => h("option", { value: name }, name)));
  const value = h("input", { type: "number", value: "1", step: "any", "aria-label": "Value to convert" });
  const from = h("select", { "aria-label": "From unit" }), to = h("select", { "aria-label": "To unit" });
  const result = toolStatus();
  const calculate = () => {
    try {
      if (!value.value.trim()) throw new Error("Enter a value to convert.");
      const converted = convertToolUnits(category.value, Number(value.value), from.value, to.value);
      result.textContent = `${value.value} ${from.value} = ${Number(converted.toPrecision(12))} ${to.value}`;
    } catch (err) { result.textContent = err.message; }
  };
  const populate = () => {
    const units = Object.keys(TOOL_UNITS[category.value]);
    fill(from, units.map((name) => h("option", { value: name }, name)));
    fill(to, units.map((name) => h("option", { value: name }, name)));
    to.value = units[1] || units[0]; calculate();
  };
  category.addEventListener("change", populate);
  [value, from, to].forEach((input) => input.addEventListener("input", calculate));
  const swap = h("button", { type: "button", class: "btn", onclick: () => { const old = from.value; from.value = to.value; to.value = old; calculate(); } }, "Swap units");
  populate();
  return card("Unit converter", "Length, weight, temperature, time and data sizes. KB/MB/GB use powers of 1000; KiB/MiB/GiB use powers of 1024.",
    toolField("Category", category), toolField("Value", value), toolField("From", from), toolField("To", to), swap, result);
}

let toolTimerInterval = 0;
function resetExtraTools() { clearInterval(toolTimerInterval); toolTimerInterval = 0; }

function studyTimerCard(card) {
  const mode = h("select", { "aria-label": "Timer session type" }, h("option", { value: "25" }, "Study · 25 min"),
    h("option", { value: "5" }, "Short break · 5 min"), h("option", { value: "15" }, "Long break · 15 min"));
  const minutes = h("input", { type: "number", min: "1", max: "180", step: "1", value: "25", "aria-label": "Timer duration in minutes" });
  const clock = h("div", { class: "tool-timer", role: "timer", "aria-live": "off" }, "25:00");
  const status = toolStatus();
  let remaining = 25 * 60000, deadline = 0, completed = 0;
  const paint = () => {
    const seconds = Math.ceil(remaining / 1000);
    clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  const button = h("button", { type: "button", class: "btn primary" }, "Start");
  const stop = () => {
    clearInterval(toolTimerInterval); toolTimerInterval = 0; deadline = 0;
    mode.disabled = minutes.disabled = false; button.textContent = "Start";
  };
  const reset = () => {
    stop(); remaining = Number(minutes.value) * 60000;
    if (!Number.isInteger(Number(minutes.value)) || remaining < 60000 || remaining > 180 * 60000) {
      remaining = 25 * 60000; minutes.value = "25";
    }
    paint(); status.textContent = "Timer reset.";
  };
  button.addEventListener("click", () => {
    if (deadline) {
      remaining = Math.max(0, deadline - Date.now()); stop(); paint(); status.textContent = "Paused."; return;
    }
    if (!Number.isInteger(Number(minutes.value)) || Number(minutes.value) < 1 || Number(minutes.value) > 180) {
      status.textContent = "Choose a whole number of minutes between 1 and 180."; return;
    }
    if (!remaining) remaining = Number(minutes.value) * 60000;
    deadline = Date.now() + remaining; button.textContent = "Pause"; mode.disabled = minutes.disabled = true;
    status.textContent = "Timer running. You can switch tabs; keep Student Hub open.";
    const tick = () => {
      remaining = Math.max(0, deadline - Date.now()); paint();
      if (!remaining) {
        const study = mode.value === "25"; if (study) completed++;
        stop(); status.textContent = `${study ? "Study session" : "Break"} complete! ${completed} study sessions completed. Choose your next session.`;
        toast(study ? "Study session complete. Time for a break!" : "Break complete. Ready to study?");
      }
    };
    resetExtraTools(); toolTimerInterval = setInterval(tick, 250); tick();
  });
  mode.addEventListener("change", () => { minutes.value = mode.value; reset(); });
  minutes.addEventListener("change", reset);
  return card("Study timer", "Pomodoro sessions with short and long breaks, or set your own duration. Pause and resume any time. The timer keeps running across tabs while this page stays open; reopening the page resets it.",
    mode, toolField("Duration in minutes", minutes), clock,
    h("div", { class: "tool-actions" }, button, h("button", { type: "button", class: "btn", onclick: reset }, "Reset")), status);
}

const HUMANIZER_OPTIONS = {
  language: { same: "Same as the original", en: "English", el: "Ελληνικά (Greek)" },
  tone: { student: "Natural student voice", academic: "Academic, but readable", casual: "Casual and friendly", professional: "Professional (emails, CVs)" },
  level: { simple: "Simple and clear", natural: "Natural, varied", rich: "Rich, expressive" },
  length: { keep: "Keep about the same", shorter: "Make it shorter", longer: "Expand a little" },
};
const HUMANIZER_RULES = {
  language: {
    same: "Write in the same language as the original text.",
    en: "Write the result in natural English, the way a native speaker writes.",
    el: "Write the result in natural, modern Greek (Ελληνικά), the way a native speaker writes.",
  },
  tone: {
    student: "Write like a thoughtful university student explaining this in their own words: confident but not showy.",
    academic: "Keep an academic register suitable for a university assignment, but make it flow like a real person wrote it, not a template.",
    casual: "Use a relaxed, conversational tone, as if talking to a classmate.",
    professional: "Use a polite, clear, professional tone suitable for emails to professors, applications or a CV.",
  },
  level: {
    simple: "Prefer short, plain sentences and everyday words.",
    natural: "Mix short and longer sentences and use ordinary vocabulary.",
    rich: "Use varied sentence structure and precise, expressive vocabulary, without sounding pretentious.",
  },
  length: {
    keep: "Keep the length roughly the same (within about 10%).",
    shorter: "Make it noticeably more concise (about 20-30% shorter) without losing any key point.",
    longer: "Expand it slightly (about 20% longer) with natural transitions or clarifications, but do not invent facts.",
  },
};

// Builds the prompt only; the user pastes it into the AI chat of their choice.
function humanizerPrompt({ text = "", language = "same", tone = "student", level = "natural", length = "keep", keepTerms = true, notes = "" } = {}) {
  const pick = (kind, key) => HUMANIZER_RULES[kind][key] || Object.values(HUMANIZER_RULES[kind])[0];
  const rules = [
    "Keep the original meaning, facts, arguments and structure. Do not add new claims, examples or sources.",
    pick("language", language), pick("tone", tone), pick("level", level), pick("length", length),
    "Vary sentence length and rhythm; avoid starting sentences the same way.",
    'Avoid typical AI-sounding phrases and filler such as "delve", "in today\'s fast-paced world", "it is important to note", "furthermore", "moreover", "in conclusion", "a testament to", "navigate the complexities", "plays a crucial role".',
    "Avoid overusing em dashes, semicolons, lists of three and rhetorical questions. Don't add headings or bullet points that weren't in the original.",
    "Prefer active voice and concrete wording over vague, generic statements.",
  ];
  if (keepTerms) rules.push("Keep technical terms, names, numbers, formulas, code and citations exactly as they are.");
  if (notes.trim()) rules.push(notes.trim());
  return [
    "You are an experienced editor. Rewrite the text below so that it reads naturally, as if a real person wrote it, while staying faithful to the original.",
    "", "Rules:", ...rules.map((rule, i) => `${i + 1}. ${rule}`), "",
    "Reply with only the rewritten text: no introduction, no explanation, no notes.", "",
    "Text:", '"""', text.trim() || "[paste your text here]", '"""',
  ].join("\n");
}

function humanizerToolCard(card) {
  const options = { text: "", language: "same", tone: "student", level: "natural", length: "keep", keepTerms: true, notes: "" };
  const input = h("textarea", { rows: "8", placeholder: "Paste the text you want to sound more natural…", "aria-label": "Text to humanize" });
  const output = h("textarea", { rows: "10", readonly: true, class: "tool-prompt", "aria-label": "Generated humanizer prompt" });
  const status = toolStatus();
  const update = () => { output.value = humanizerPrompt(options); };
  const choice = (key, label) => {
    const select = h("select", { "aria-label": label }, Object.entries(HUMANIZER_OPTIONS[key]).map(([value, text]) => h("option", { value }, text)));
    select.value = options[key];
    select.addEventListener("change", () => { options[key] = select.value; update(); });
    return toolField(label, select);
  };
  const notes = h("input", { type: "text", maxlength: "300", placeholder: "e.g. use British spelling", "aria-label": "Extra instructions" });
  const keep = h("input", { type: "checkbox", checked: true, "aria-label": "Keep technical terms unchanged" });
  input.addEventListener("input", () => { options.text = input.value; update(); });
  notes.addEventListener("input", () => { options.notes = notes.value; update(); });
  keep.addEventListener("change", () => { options.keepTerms = keep.checked; update(); });
  const copy = async (site) => {
    if (!options.text.trim()) { status.textContent = "Paste your text first."; return; }
    await copyText(output.value);
    status.textContent = site ? "Prompt copied. Paste it into the chat that just opened." : "Prompt copied. Paste it into ChatGPT, Claude or Gemini.";
    if (site) window.open(site, "_blank", "noopener,noreferrer");
  };
  update();
  return card("Humanizer", "Builds a prompt that asks an AI chat to rewrite your text so it reads naturally. Paste your text, choose the style, then copy the prompt. Nothing is sent anywhere from here. Check your course's rules on AI use.",
    input, choice("language", "Language"), choice("tone", "Tone"), choice("level", "Vocabulary"), choice("length", "Length"),
    toolField("Extra instructions (optional)", notes),
    h("label", { class: "check" }, keep, "Keep technical terms, numbers, code and citations unchanged"),
    toolField("Prompt", output),
    h("div", { class: "tool-actions" },
      h("button", { type: "button", class: "btn primary", onclick: () => copy() }, "Copy prompt"),
      h("button", { type: "button", class: "btn", onclick: () => copy("https://chatgpt.com/") }, "Copy & open ChatGPT ↗"),
      h("button", { type: "button", class: "btn", onclick: () => copy("https://claude.ai/new") }, "Copy & open Claude ↗"),
      h("button", { type: "button", class: "btn", onclick: () => copy("https://gemini.google.com/app") }, "Copy & open Gemini ↗")),
    status);
}

function additionalToolGroups(card, capabilities) {
  const [pdfCompressor, pdfEditor, imagePdf] = pdfToolCards(card, capabilities);
  return {
    Documents: [pdfCompressor, pdfEditor],
    Images: [imagePdf],
    Archives: [archiveToolCard(card)],
    Text: [humanizerToolCard(card)],
    Study: [studyTimerCard(card), gradeToolCard(card)],
    Converters: [unitToolCard(card)],
  };
}

function renderToolTabs(body, groups) {
  const names = Object.keys(groups);
  let selected = names[0];
  try {
    const saved = sessionStorage.getItem("hub:tools-tab");
    if (names.includes(saved)) selected = saved;
  } catch {}
  const buttons = [], panels = [];
  const select = (name, focus = false) => {
    selected = name;
    buttons.forEach((button, i) => {
      const active = names[i] === name;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      panels[i].hidden = !active;
      if (active && focus) button.focus();
    });
    try { sessionStorage.setItem("hub:tools-tab", name); } catch {}
  };
  const tabs = h("div", { class: "tools-tabs", role: "tablist", "aria-label": "Tool categories" });
  for (const [index, name] of names.entries()) {
    const key = name.toLowerCase();
    const tabId = `tools-tab-${key}`, panelId = `tools-panel-${key}`;
    const button = h("button", {
      id: tabId, class: "tools-tab", type: "button", role: "tab", "aria-controls": panelId,
      onclick: () => select(name),
      onkeydown: (event) => {
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % names.length;
        else if (event.key === "ArrowLeft") next = (index + names.length - 1) % names.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = names.length - 1;
        if (next !== undefined) { event.preventDefault(); select(names[next], true); }
      },
    }, name, h("span", { class: "tools-tab-count", "aria-hidden": "true" }, groups[name].length));
    buttons.push(button);
    tabs.append(button);
    panels.push(h("div", { id: panelId, role: "tabpanel", "aria-labelledby": tabId, tabindex: "0", class: "tools-grid tools-panel" }, groups[name]));
  }
  fill(body, h("p", { class: "muted tools-intro" }, "Choose a category to find a tool. PDF processing and ZIP extraction run on the computer running Student Hub; other tools run in your browser."), tabs, panels);
  select(selected);
}

// ---------- everyday tools ----------
function downloadToolFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ZIP uses raw DEFLATE; CompressionStream's zlib wrapper is removed below.
async function compressFolderZip(files, progress = () => {}) {
  if (!files.length) throw new Error("Choose a folder containing files.");
  if (files.length > 2000 || files.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024)
    throw new Error("Choose a folder with at most 2,000 files and 200 MB total.");
  if (typeof CompressionStream === "undefined") throw new Error("Folder compression needs a newer browser with CompressionStream support.");
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    table[n] = c;
  }
  const local = [], central = [], seen = new Set();
  let offset = 0, centralSize = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i], path = file.webkitRelativePath || file.name;
    if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..") || seen.has(path))
      throw new Error("The folder contains an invalid or duplicate file path.");
    seen.add(path);
    const name = new TextEncoder().encode(path);
    if (name.length > 65535) throw new Error("A file path is too long for ZIP.");
    progress(i + 1, files.length);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let crc = 0xffffffff;
    for (const b of bytes) crc = (crc >>> 8) ^ table[(crc ^ b) & 255];
    crc = (crc ^ 0xffffffff) >>> 0;
    const packed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
    const raw = packed.subarray(2, packed.length - 4);
    const method = raw.length < bytes.length ? 8 : 0;
    const data = method ? raw : bytes;
    const date = new Date(file.lastModified || Date.now());
    const year = Math.min(2107, Math.max(1980, date.getFullYear()));
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const header = new Uint8Array(30 + name.length), hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true); hv.setUint16(4, 20, true); hv.setUint16(6, 0x800, true);
    hv.setUint16(8, method, true); hv.setUint16(10, dosTime, true); hv.setUint16(12, dosDate, true);
    hv.setUint32(14, crc, true); hv.setUint32(18, data.length, true); hv.setUint32(22, bytes.length, true);
    hv.setUint16(26, name.length, true); header.set(name, 30);
    const entry = new Uint8Array(46 + name.length), ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true); ev.setUint16(4, 20, true); ev.setUint16(6, 20, true);
    entry.set(header.subarray(6, 28), 8); ev.setUint32(42, offset, true); entry.set(name, 46);
    local.push(header, data); central.push(entry);
    offset += header.length + data.length; centralSize += entry.length;
  }
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true);
  view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: "application/zip" });
}

function renderTools() {
  const body = $("tools-body");
  if (body.childElementCount) return; // Keep selected files and text when switching tabs.
  const card = (title, description, ...children) => h("section", { class: "tool-card" },
    h("h2", {}, title), h("p", { class: "muted" }, description), ...children);
  const pdfFile = h("input", { type: "file", accept: ".doc,.docx,.odt", "aria-label": "Word document" });
  const pdfStatus = h("p", { role: "status", "aria-live": "polite" });
  const pdfButton = h("button", { type: "button", class: "btn primary", disabled: true }, "Convert to PDF");
  let pdfAvailable = false;
  pdfFile.addEventListener("change", () => { pdfButton.disabled = !pdfAvailable || !pdfFile.files.length; pdfStatus.textContent = ""; });
  const toolsCapabilities = api("/api/tools");
  toolsCapabilities.then((data) => {
    pdfAvailable = data.pdf;
    pdfButton.disabled = !pdfAvailable || !pdfFile.files.length;
    if (!pdfAvailable) pdfStatus.textContent = "Install LibreOffice on the computer running Student Hub to enable PDF conversion.";
  }).catch((err) => { pdfStatus.textContent = err.message; });
  pdfButton.addEventListener("click", async () => {
    const file = pdfFile.files[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["doc", "docx", "odt"].includes(ext)) { pdfStatus.textContent = "Choose a .doc, .docx or .odt file."; return; }
    if (!file.size || file.size > 20 * 1024 * 1024) { pdfStatus.textContent = "Choose a nonempty file up to 20 MB."; return; }
    pdfButton.disabled = pdfFile.disabled = true;
    pdfStatus.textContent = "Converting… This may take up to 90 seconds.";
    try {
      const res = await fetch(`/api/tools/pdf?ext=${ext}`, { method: "POST", credentials: "same-origin",
        headers: { "X-CSRF-Token": state.csrf, "Content-Type": "application/octet-stream" }, body: file });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) showLogin("Your session ended. Please sign in again.");
        throw new Error(data.error || "Conversion failed");
      }
      downloadToolFile(await res.blob(), file.name.replace(/\.[^.]+$/, "") + ".pdf");
      pdfStatus.textContent = "PDF downloaded. Temporary files have been deleted.";
    } catch (err) { pdfStatus.textContent = err.message; }
    finally { pdfButton.disabled = !pdfAvailable; pdfFile.disabled = false; }
  });

  const imageFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", "aria-label": "Image to convert" });
  const format = h("select", { "aria-label": "Output image format" },
    h("option", { value: "image/png" }, "PNG"), h("option", { value: "image/jpeg" }, "JPG"), h("option", { value: "image/webp" }, "WebP"));
  const imageStatus = h("p", { role: "status" });
  const imageButton = h("button", { type: "button", class: "btn primary" }, "Convert image");
  imageButton.addEventListener("click", async () => {
    const file = imageFile.files[0];
    if (!file) { imageStatus.textContent = "Choose an image first."; return; }
    if (file.size > 20 * 1024 * 1024) { imageStatus.textContent = "Choose an image up to 20 MB."; return; }
    imageButton.disabled = true;
    imageStatus.textContent = "Converting…";
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 40000000) throw new Error("Choose an image under 40 megapixels.");
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (format.value === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(bitmap, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, format.value, 0.92));
      if (!blob || blob.type !== format.value) throw new Error("This browser doesn't support that output format.");
      const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[format.value];
      downloadToolFile(blob, file.name.replace(/\.[^.]+$/, "") + "." + ext);
      imageStatus.textContent = `${bitmap.width} × ${bitmap.height} image downloaded.`;
    } catch (err) { imageStatus.textContent = err.message || "Couldn't read this image."; }
    finally { bitmap?.close(); imageButton.disabled = false; }
  });

  const compressFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", "aria-label": "Image to compress" });
  const compressFormat = h("select", { "aria-label": "Compressed image format" },
    h("option", { value: "image/jpeg" }, "JPG"), h("option", { value: "image/webp" }, "WebP (supports transparency)"));
  const quality = h("input", { id: "compress-quality", type: "range", min: "10", max: "95", value: "75" });
  const qualityLabel = h("label", { for: "compress-quality" }, "Quality: 75%");
  quality.addEventListener("input", () => { qualityLabel.textContent = `Quality: ${quality.value}%`; });
  const maxSize = h("select", { "aria-label": "Maximum image dimensions" },
    h("option", { value: "0" }, "Keep original dimensions"),
    h("option", { value: "2560" }, "Maximum 2560 px"),
    h("option", { value: "1920" }, "Maximum 1920 px"),
    h("option", { value: "1280" }, "Maximum 1280 px"));
  const compressStatus = h("p", { role: "status", "aria-live": "polite" });
  const compressButton = h("button", { type: "button", class: "btn primary" }, "Compress & download");
  compressButton.addEventListener("click", async () => {
    const file = compressFile.files[0];
    if (!file) { compressStatus.textContent = "Choose an image first."; return; }
    if (!file.size || file.size > 20 * 1024 * 1024) { compressStatus.textContent = "Choose a nonempty image up to 20 MB."; return; }
    const mime = compressFormat.value, limit = Number(maxSize.value), requestedQuality = Number(quality.value) / 100;
    compressButton.disabled = true;
    compressStatus.textContent = "Compressing…";
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 40000000) throw new Error("Choose an image under 40 megapixels.");
      const scale = limit ? Math.min(1, limit / Math.max(bitmap.width, bitmap.height)) : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (mime === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, requestedQuality));
      if (!blob || blob.type !== mime) throw new Error("This browser doesn't support that output format.");
      const size = (bytes) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
      if (blob.size >= file.size) {
        compressStatus.textContent = `Original: ${size(file.size)}. This version would be ${size(blob.size)}. Try lower quality or smaller dimensions to reduce the size.`;
        return;
      }
      downloadToolFile(blob, file.name.replace(/\.[^.]+$/, "") + "-compressed." + (mime === "image/jpeg" ? "jpg" : "webp"));
      compressStatus.textContent = `${size(file.size)} → ${size(blob.size)} · ${(100 * (1 - blob.size / file.size)).toFixed(1)}% smaller · ${canvas.width} × ${canvas.height} px. Downloaded.`;
    } catch (err) { compressStatus.textContent = err.message || "Couldn't compress this image."; }
    finally { bitmap?.close(); compressButton.disabled = false; }
  });

  const folderFile = h("input", { type: "file", webkitdirectory: true, multiple: true, "aria-label": "Folder to compress" });
  const folderStatus = h("p", { role: "status", "aria-live": "polite" });
  const folderButton = h("button", { type: "button", class: "btn primary", disabled: true }, "Compress folder to ZIP");
  const folderSize = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  folderFile.addEventListener("change", () => {
    const files = Array.from(folderFile.files);
    folderButton.disabled = !files.length;
    folderStatus.textContent = files.length ? `${files.length} files · ${folderSize(files.reduce((sum, file) => sum + file.size, 0))}` : "No files selected.";
  });
  folderButton.addEventListener("click", async () => {
    const files = Array.from(folderFile.files);
    folderButton.disabled = folderFile.disabled = true;
    try {
      const zip = await compressFolderZip(files, (current, total) => { folderStatus.textContent = `Compressing file ${current} of ${total}…`; });
      const name = files[0].webkitRelativePath?.split("/")[0] || "folder";
      downloadToolFile(zip, name + ".zip");
      const original = files.reduce((sum, file) => sum + file.size, 0);
      const change = original ? 100 * (1 - zip.size / original) : 0;
      folderStatus.textContent = `${files.length} files · ${folderSize(original)} → ${folderSize(zip.size)} · ZIP downloaded.` +
        (change > 0 ? ` ${change.toFixed(1)}% smaller.` : " Already compressed files may not shrink further.");
    } catch (err) { folderStatus.textContent = err.message || "Couldn't compress this folder."; }
    finally { folderFile.disabled = false; folderButton.disabled = !folderFile.files.length; }
  });

  const counter = h("p", { role: "status" }, "0 words · 0 characters · 0 characters without spaces");
  const text = h("textarea", { rows: "8", placeholder: "Paste your essay or notes here…", "aria-label": "Text to count" });
  text.addEventListener("input", () => {
    const value = text.value;
    counter.textContent = `${value.trim() ? value.trim().split(/\s+/u).length : 0} words · ${Array.from(value).length} characters · ${Array.from(value.replace(/\s/gu, "")).length} characters without spaces`;
  });
  const groups = additionalToolGroups(card, toolsCapabilities);
  groups.Documents.unshift(card("Word → PDF", "Convert .doc, .docx and .odt documents to PDF. Maximum 20 MB. Uses local LibreOffice; fonts and layout may vary slightly.", pdfFile, pdfButton, pdfStatus));
  groups.Images.unshift(
    card("Image converter", "Convert PNG, JPG and WebP images. JPG uses a white background for transparent areas.", imageFile, format, imageButton, imageStatus),
    card("Image compressor", "Reduce image file sizes before uploading assignments. Lower quality makes smaller files. JPG replaces transparency with white. Everything stays in your browser.",
      compressFile, compressFormat, qualityLabel, quality, maxSize, compressButton, compressStatus));
  groups.Archives.unshift(card("Folder compressor → ZIP", "Choose a folder to create one compressed ZIP, keeping its subfolders. Up to 200 MB and 2,000 files. Runs in your browser. Empty folders aren't included; photos, videos and PDFs may not shrink much.",
    folderFile, folderButton, folderStatus));
  groups.Text.unshift(card("Word & character counter", "Check the length of an assignment or abstract. Text is kept only while this page is open.", text, counter,
    h("button", { type: "button", class: "btn", onclick: () => { text.value = ""; text.dispatchEvent(new Event("input")); } }, "Clear text")));
  renderToolTabs(body, groups);
}
