// app.js – Vorschlag B (stabil auf iOS): Aufnahme über Datei-Picker, keine MediaRecorder-API
// Upload/„Audio aufnehmen“ (iOS) -> Transkribieren -> Notizen -> Protokoll -> Copy/PDF bleibt wie gehabt.

const $ = (id) => document.getElementById(id);

function normalizeApiBase(v) {
  v = (v || "").trim();
  if (!v) return "";
  return v.replace(/\/+$/, "");
}

function getApiBase(el) {
  const fromInput = normalizeApiBase(el.apiBase?.value);
  if (fromInput) return fromInput;
  return normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
}

function setApiBase(el, v) {
  const base = normalizeApiBase(v);
  if (el.apiBase) el.apiBase.value = base;
  if (base) localStorage.setItem("protocol_api_base", base);
}

function apiUrl(el, path) {
  const base = getApiBase(el);
  if (!path.startsWith("/")) path = "/" + path;
  return base + path;
}

async function safeJson(resp) {
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await resp.json();
  const t = await resp.text();
  return { error: t || "Unbekannte Antwort (kein JSON)" };
}

function normalizeList(text) {
  return (text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^\-\s*/, ""));
}

function hasSelectedFile(el) {
  return !!(el.fileAudio && el.fileAudio.files && el.fileAudio.files.length > 0);
}

function updateTranscribeEnabled(el) {
  if (!el.btnTranscribe) return;
  el.btnTranscribe.disabled = !hasSelectedFile(el);
}

function setBusy(el, busy, msg) {
  if (el.btnGenerate) el.btnGenerate.disabled = busy;
  if (el.btnReset) el.btnReset.disabled = busy;
  if (el.btnTranscribe) el.btnTranscribe.disabled = busy || !hasSelectedFile(el);
  if (busy && el.result && msg) el.result.value = msg;
}

// -------- Protokoll --------
async function createProtocol(el) {
  try {
    const base = getApiBase(el);
    if (!base) {
      alert("Bitte unten eine API-URL eintragen und auf „Speichern“ drücken.");
      return;
    }

    setBusy(el, true, "Erstelle Protokoll ...");

    const payload = {
      meta: {
        date: el.date?.value || "",
        time: el.time?.value || "",
        location: (el.location?.value || "").trim(),
        title: (el.title?.value || "").trim(),
        participantsCustomer: normalizeList(el.participantsCustomer?.value),
        participantsInternal: normalizeList(el.participantsInternal?.value),
      },
      notes: (el.notes?.value || "").trim(),
    };

    const resp = await fetch(apiUrl(el, "/api/createProtocol"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || "Erstellung fehlgeschlagen");

    const text = (data.protocolText || data.text || "").trim();
    if (!text) throw new Error("Antwort war leer (kein Protokolltext).");

    el.result.value = text;
    if (el.btnCopy) el.btnCopy.disabled = !text;
    if (el.btnPDF) el.btnPDF.disabled = !text;
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    setBusy(el, false);
  }
}

function resetFields(el) {
  if (el.date) el.date.value = "";
  if (el.time) el.time.value = "";
  if (el.dateTime) el.dateTime.value = "";
  if (el.location) el.location.value = "";
  if (el.title) el.title.value = "";
  if (el.participantsCustomer) el.participantsCustomer.value = "";
  if (el.participantsInternal) el.participantsInternal.value = "";
  if (el.notes) el.notes.value = "";
  if (el.result) el.result.value = "";
  if (el.btnCopy) el.btnCopy.disabled = true;
  if (el.btnPDF) el.btnPDF.disabled = true;

  if (el.fileAudio) el.fileAudio.value = "";
  if (el.player) { el.player.removeAttribute("src"); el.player.load(); }
  if (el.btnClearAudio) el.btnClearAudio.disabled = true;
  updateTranscribeEnabled(el);
}

async function copyResult(el) {
  try {
    const t = el.result?.value || "";
    if (!t) return;
    await navigator.clipboard.writeText(t);
    alert("In Zwischenablage kopiert.");
  } catch (e) {
    alert("Kopieren nicht möglich: " + (e.message || String(e)));
  }
}

// -------- Transcribe (nur Datei) --------
async function transcribe(el) {
  try {
    const base = getApiBase(el);
    if (!base) {
      alert("Bitte unten eine API-URL eintragen und speichern.");
      return;
    }
    if (!hasSelectedFile(el)) {
      alert("Bitte erst eine Audiodatei auswählen/aufnehmen.");
      return;
    }

    setBusy(el, true, "Transkribiere Audio ...");

    const file = el.fileAudio.files[0];
    const fd = new FormData();
    fd.append("audio", file, file.name || "audio.m4a");

    const resp = await fetch(apiUrl(el, "/api/transcribe"), { method: "POST", body: fd });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || `Transkription fehlgeschlagen (${resp.status})`);

    const transcript = (data.transcript || data.text || "").trim();
    if (!transcript) {
      alert("Transkription war leer.");
      return;
    }

    if (el.notes) el.notes.value = transcript + "\n\n" + (el.notes.value || "");
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    setBusy(el, false);
  }
}

function init() {
  const el = {
    apiBase: $("apiBase"),
    btnSaveApi: $("btnSaveApi"),

    date: $("date"),
    time: $("time"),
    dateTime: $("dateTime"),

    location: $("location"),
    title: $("title"),
    participantsCustomer: $("participantsCustomer"),
    participantsInternal: $("participantsInternal"),

    // Audio
    btnRecord: $("btnRecord"),
    btnClearAudio: $("btnClearAudio"),
    player: $("player"),
    fileAudio: $("fileAudio"),
    btnTranscribe: $("btnTranscribe"),

    notes: $("notes"),
    btnGenerate: $("btnGenerate"),
    btnReset: $("btnReset"),

    result: $("result"),
    btnCopy: $("btnCopy"),
    btnPDF: $("btnPDF"),
  };

  const stored = normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
  if (stored && el.apiBase) el.apiBase.value = stored;

  if (el.btnSaveApi) {
    el.btnSaveApi.addEventListener("click", () => {
      const norm = normalizeApiBase(el.apiBase?.value);
      if (!norm) { alert("Bitte eine gültige API-URL eingeben."); return; }
      setApiBase(el, norm);
      alert("API-URL gespeichert.");
    });
  }

  if (el.btnGenerate) el.btnGenerate.addEventListener("click", () => createProtocol(el));
  if (el.btnReset) el.btnReset.addEventListener("click", () => resetFields(el));
  if (el.btnCopy) el.btnCopy.addEventListener("click", () => copyResult(el));

  if (el.btnRecord) {
    el.btnRecord.style.background = "#b91c1c";
    el.btnRecord.style.color = "#fff";
    el.btnRecord.addEventListener("click", () => el.fileAudio?.click());
  }

  if (el.fileAudio) {
    el.fileAudio.addEventListener("change", () => {
      if (hasSelectedFile(el) && el.player) el.player.src = URL.createObjectURL(el.fileAudio.files[0]);
      if (el.btnClearAudio) el.btnClearAudio.disabled = !hasSelectedFile(el);
      updateTranscribeEnabled(el);
    });
  }

  if (el.btnClearAudio) {
    el.btnClearAudio.addEventListener("click", () => {
      if (el.fileAudio) el.fileAudio.value = "";
      if (el.player) { el.player.removeAttribute("src"); el.player.load(); }
      el.btnClearAudio.disabled = true;
      updateTranscribeEnabled(el);
    });
  }

  if (el.btnTranscribe) el.btnTranscribe.addEventListener("click", () => transcribe(el));

  if (el.btnClearAudio) el.btnClearAudio.disabled = true;
  updateTranscribeEnabled(el);
}

document.addEventListener("DOMContentLoaded", init);
