// Protokoll Recorder v3 (Safari/iOS-friendly)
// Endpoints:
//  - POST /api/createProtocol   (JSON: { meta, notes })
//  - POST /api/transcribe       (multipart/form-data: audio)
//  - GET  /ping                 (optional)

let mediaRecorder = null;
let streamRef = null;
let audioChunks = [];
let audioBlob = null;

let isRecording = false;
let recStartMs = 0;
let recTimerHandle = null;

const $ = (id) => document.getElementById(id);

const el = {
  apiBase: $("apiBase"),
  btnSaveApi: $("btnSaveApi"),
  apiStatus: $("apiStatus"),

  date: $("date"),
  time: $("time"),
  location: $("location"),
  title: $("title"),
  participantsCustomer: $("participantsCustomer"),
  participantsInternal: $("participantsInternal"),

  btnRecToggle: $("btnRecToggle"),
  recLabel: $("recLabel"),
  recTimer: $("recTimer"),
  btnClearAudio: $("btnClearAudio"),
  player: $("player"),
  btnTranscribe: $("btnTranscribe"),
  fileAudio: $("fileAudio"),

  notes: $("notes"),
  btnGenerate: $("btnGenerate"),
  btnReset: $("btnReset"),

  result: $("result"),
  btnCopy: $("btnCopy"),
  btnPDF: $("btnPDF"),
};

function normalizeApiBase(v) {
  v = (v || "").trim();
  if (!v) return "";
  // trailing slash entfernen
  v = v.replace(/\/+$/, "");
  return v;
}

function getApiBase() {
  const fromInput = normalizeApiBase(el.apiBase?.value);
  if (fromInput) return fromInput;

  const fromStore = normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
  return fromStore;
}

function setApiBase(v) {
  const base = normalizeApiBase(v);
  if (el.apiBase) el.apiBase.value = base;
  if (base) localStorage.setItem("protocol_api_base", base);
}

function apiUrl(path) {
  const base = getApiBase();
  if (!path.startsWith("/")) path = "/" + path;
  return base + path;
}

function normalizeList(text) {
  return (text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^\-\s*/, "")); // führendes "- " entfernen
}

function setBusy(isBusy, msg) {
  if (el.btnGenerate) el.btnGenerate.disabled = isBusy;
  if (el.btnTranscribe) el.btnTranscribe.disabled = isBusy || !audioBlob;
  if (el.btnReset) el.btnReset.disabled = isBusy;

  if (isBusy && msg && el.result) {
    el.result.value = msg;
  }
}

async function safeJson(resp) {
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await resp.json();
  const t = await resp.text();
  return { error: t || "Unbekannte Antwort (kein JSON)" };
}

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function startTimer() {
  recStartMs = Date.now();
  if (el.recTimer) el.recTimer.textContent = "00:00";
  if (recTimerHandle) clearInterval(recTimerHandle);
  recTimerHandle = setInterval(() => {
    if (!isRecording) return;
    const ms = Date.now() - recStartMs;
    el.recTimer.textContent = fmtTime(ms);
  }, 250);
}

function stopTimer() {
  if (recTimerHandle) clearInterval(recTimerHandle);
  recTimerHandle = null;
}

function setRecUi(recording) {
  isRecording = recording;
  if (!el.btnRecToggle) return;

  if (recording) {
    el.btnRecToggle.classList.add("recording");
    if (el.recLabel) el.recLabel.textContent = "Stop";
    startTimer();
  } else {
    el.btnRecToggle.classList.remove("recording");
    if (el.recLabel) el.recLabel.textContent = "Aufnahme starten";
    stopTimer();
  }

  el.btnClearAudio.disabled = recording || !audioBlob;
  el.btnTranscribe.disabled = recording || !audioBlob;
}

async function createProtocol() {
  try {
    const base = getApiBase();
    if (!base) {
      alert("Bitte unten eine API-URL eintragen und auf „Speichern“ drücken.");
      return;
    }

    const notes = (el.notes?.value || "").trim();
    if (!notes) {
      alert("Bitte erst Notizen eintragen (oder transkribieren).");
      return;
    }

    setBusy(true, "Erstelle Protokoll ...");

    const payload = {
      meta: {
        date: el.date?.value || "",
        time: el.time?.value || "",
        location: (el.location?.value || "").trim(),
        title: (el.title?.value || "").trim(),
        participantsCustomer: normalizeList(el.participantsCustomer?.value),
        participantsInternal: normalizeList(el.participantsInternal?.value),
      },
      notes,
    };

    const resp = await fetch(apiUrl("/api/createProtocol"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || "Erstellung fehlgeschlagen");

    // Worker sollte nur das Protokoll zurückgeben, z.B. { protocolText: "..." } oder { text: "..." }
    const text = (data.protocolText || data.text || "").trim();
    if (!text) throw new Error("Antwort war leer (kein protocolText/text).");

    el.result.value = text;
    el.btnCopy.disabled = !text;
    el.btnPDF.disabled = !text;
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    setBusy(false);
  }
}

function resetFields() {
  el.date.value = "";
  el.time.value = "";
  el.location.value = "";
  el.title.value = "";
  el.participantsCustomer.value = "";
  el.participantsInternal.value = "";
  el.notes.value = "";
  el.result.value = "";
  clearAudio();
  el.btnCopy.disabled = true;
  el.btnPDF.disabled = true;
}

async function copyResult() {
  try {
    const t = el.result.value || "";
    if (!t) return;
    await navigator.clipboard.writeText(t);
    alert("In Zwischenablage kopiert.");
  } catch (e) {
    alert("Kopieren nicht möglich: " + (e.message || String(e)));
  }
}

// --- Audio ---
function hasRecorderSupport() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

async function startRecording() {
  if (!hasRecorderSupport()) {
    alert("Aufnahme wird in Safari/iOS hier nicht unterstützt. Bitte „Sprachnotiz hochladen“ nutzen.");
    return;
  }

  try {
    streamRef = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    audioBlob = null;

    // best effort mimeType
    const opts = {};
    try {
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) opts.mimeType = "audio/webm;codecs=opus";
      else if (MediaRecorder.isTypeSupported("audio/webm")) opts.mimeType = "audio/webm";
      else if (MediaRecorder.isTypeSupported("audio/mp4")) opts.mimeType = "audio/mp4";
    } catch {}

    mediaRecorder = new MediaRecorder(streamRef, opts);

    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) audioChunks.push(ev.data);
    };

    mediaRecorder.onstop = () => {
      try {
        const mt = mediaRecorder.mimeType || "audio/webm";
        audioBlob = new Blob(audioChunks, { type: mt });
        el.player.src = URL.createObjectURL(audioBlob);
      } finally {
        // tracks stoppen
        if (streamRef) streamRef.getTracks().forEach((t) => t.stop());
        streamRef = null;
        setRecUi(false);
      }
    };

    mediaRecorder.start();
    setRecUi(true);
  } catch (e) {
    setRecUi(false);
    alert("Audio-Aufnahme nicht möglich: " + (e.message || String(e)));
  }
}

function stopRecording() {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  } catch {
    setRecUi(false);
  }
}

function clearAudio() {
  audioChunks = [];
  audioBlob = null;
  if (el.player) {
    el.player.removeAttribute("src");
    el.player.load();
  }
  if (el.fileAudio) el.fileAudio.value = "";
  setRecUi(false);
  el.btnClearAudio.disabled = true;
  el.btnTranscribe.disabled = true;
}

async function transcribeToNotes() {
  try {
    const base = getApiBase();
    if (!base) {
      alert("Bitte unten eine API-URL eintragen und speichern.");
      return;
    }
    if (!audioBlob) {
      alert("Bitte erst aufnehmen oder eine Sprachnotiz hochladen.");
      return;
    }

    setBusy(true, "Transkribiere Audio ...");

    const fd = new FormData();
    // Dateiendung egal, Worker liest die Bytes
    fd.append("audio", audioBlob, "audio");

    const resp = await fetch(apiUrl("/api/transcribe"), { method: "POST", body: fd });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || "Transkription fehlgeschlagen");

    const transcript = (data.transcript || data.text || "").trim();
    if (!transcript) {
      alert("Transkription war leer.");
      return;
    }

    // Transkript nach oben einfügen, damit du es direkt bearbeiten kannst
    const existing = (el.notes.value || "").trim();
    el.notes.value = transcript + (existing ? "\n\n" + existing : "");
    el.notes.focus();
    // Cursor ans Ende des eingefügten Transkripts
    el.notes.setSelectionRange(transcript.length, transcript.length);
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    setBusy(false);
  }
}

function handleFilePicked(file) {
  if (!file) return;
  audioBlob = file;
  audioChunks = [];
  el.player.src = URL.createObjectURL(audioBlob);
  el.btnTranscribe.disabled = false;
  el.btnClearAudio.disabled = false;
}

// --- Init ---
function init() {
  // gespeicherte API URL reinladen
  const stored = normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
  if (stored) el.apiBase.value = stored;

  el.btnSaveApi.addEventListener("click", () => {
    const norm = normalizeApiBase(el.apiBase.value);
    if (!norm) {
      el.apiStatus.textContent = "Bitte gültige URL eingeben.";
      return;
    }
    setApiBase(norm);
    el.apiStatus.textContent = "Gespeichert.";
    setTimeout(() => (el.apiStatus.textContent = ""), 2000);
  });

  el.btnGenerate.addEventListener("click", createProtocol);
  el.btnReset.addEventListener("click", resetFields);
  el.btnCopy.addEventListener("click", copyResult);

  // Recording toggle
  el.btnRecToggle.addEventListener("click", async () => {
    if (isRecording) stopRecording();
    else await startRecording();
  });

  el.btnClearAudio.addEventListener("click", clearAudio);
  el.btnTranscribe.addEventListener("click", transcribeToNotes);

  el.fileAudio.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    handleFilePicked(f);
  });

  // initial UI state
  setRecUi(false);

  // PDF Button bleibt wie gehabt (pdf.js kümmert sich darum)
}

document.addEventListener("DOMContentLoaded", init);
