// Protokoll Recorder - Frontend (app.js)
// Fokus: Funktionen wieder stabil (Transkription + Aufnahme Start/Stop) ohne Layout-Änderungen.
// Endpoints:
//  - POST /api/createProtocol   (JSON: { meta, notes })
//  - POST /api/transcribe       (multipart/form-data: audio)
//  - GET  /ping                 (optional)

let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let audioBlob = null;
let isRecording = false;

// Timer
let timerHandle = null;
let startedAt = 0;

const $ = (id) => document.getElementById(id);

const el = {
  apiBase: $("apiBase"),
  btnSaveApi: $("btnSaveApi"),

  date: $("date"),
  time: $("time"),
  // optional combined datetime-local
  dateTime: $("dateTime"),

  location: $("location"),
  title: $("title"),
  participantsCustomer: $("participantsCustomer"),
  participantsInternal: $("participantsInternal"),

  btnRecord: $("btnRecord"),
  // optional separate stop button if present
  btnStop: $("btnStop"),
  btnClearAudio: $("btnClearAudio"),
  recTimer: $("recTimer"),
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

function normalizeApiBase(v) {
  v = (v || "").trim();
  if (!v) return "";
  return v.replace(/\/+$/, "");
}

function getApiBase() {
  const fromInput = normalizeApiBase(el.apiBase?.value);
  if (fromInput) return fromInput;
  return normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
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
    .map((s) => s.replace(/^\-\s*/, ""));
}

function setBusy(isBusy, msg) {
  if (el.btnGenerate) el.btnGenerate.disabled = isBusy;
  if (el.btnReset) el.btnReset.disabled = isBusy;

  // Transcribe button: only if audio present
  if (el.btnTranscribe) {
    const hasAudio = !!audioBlob || (el.fileAudio && el.fileAudio.files && el.fileAudio.files.length > 0);
    el.btnTranscribe.disabled = isBusy || !hasAudio;
  }

  if (isBusy && el.result) el.result.value = msg || "Bitte warten ...";
}

async function safeJson(resp) {
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await resp.json();
  const t = await resp.text();
  return { error: t || "Unbekannte Antwort (kein JSON)" };
}

// -------- Protokoll --------
async function createProtocol() {
  try {
    const base = getApiBase();
    if (!base) {
      alert("Bitte unten eine API-URL eintragen und auf „Speichern“ drücken.");
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
      notes: (el.notes?.value || "").trim(),
    };

    const resp = await fetch(apiUrl("/api/createProtocol"), {
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
    setBusy(false);
  }
}

function resetFields() {
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
}

async function copyResult() {
  try {
    const t = el.result?.value || "";
    if (!t) return;
    await navigator.clipboard.writeText(t);
    alert("In Zwischenablage kopiert.");
  } catch (e) {
    alert("Kopieren nicht möglich: " + (e.message || String(e)));
  }
}

// -------- Audio --------
function mmss(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function startTimer() {
  stopTimer();
  startedAt = Date.now();
  if (el.recTimer) el.recTimer.textContent = "00:00";
  timerHandle = setInterval(() => {
    const sec = (Date.now() - startedAt) / 1000;
    if (el.recTimer) el.recTimer.textContent = mmss(sec);
  }, 250);
}

function stopTimer() {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

function setRecordBtnUI(recording) {
  if (!el.btnRecord) return;
  el.btnRecord.classList.add("rec"); // sorgt für rot via CSS
  // Fallback, falls CSS fehlt
  el.btnRecord.style.background = "#b91c1c";
  el.btnRecord.style.color = "#fff";
  el.btnRecord.textContent = recording ? "Stop" : "Aufnahme starten";
}

function updateTranscribeEnabled() {
  if (!el.btnTranscribe) return;
  const hasAudio = !!audioBlob || (el.fileAudio && el.fileAudio.files && el.fileAudio.files.length > 0);
  el.btnTranscribe.disabled = !hasAudio;
}

async function startRecording() {
  try {
    if (isRecording) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Audio-Aufnahme wird von diesem Browser nicht unterstützt. Bitte Audio-Datei hochladen.");
      return;
    }

    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    audioBlob = null;

    try {
      mediaRecorder = new MediaRecorder(audioStream);
    } catch (e) {
      // iOS Safari kann MediaRecorder je nach Version nicht
      audioStream.getTracks().forEach((t) => t.stop());
      audioStream = null;
      alert("Aufnahme ist in diesem Safari nicht verfügbar. Bitte Audio-Datei hochladen.");
      return;
    }

    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) audioChunks.push(ev.data);
    };

    mediaRecorder.onstop = () => {
      try {
        const type = mediaRecorder.mimeType || "audio/webm";
        audioBlob = new Blob(audioChunks, { type });
        if (el.player) el.player.src = URL.createObjectURL(audioBlob);
      } catch (_) {}

      try { audioStream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
      audioStream = null;

      isRecording = false;
      stopTimer();
      setRecordBtnUI(false);

      if (el.btnClearAudio) el.btnClearAudio.disabled = false;
      updateTranscribeEnabled();
    };

    mediaRecorder.start();
    isRecording = true;
    setRecordBtnUI(true);
    startTimer();

    if (el.btnClearAudio) el.btnClearAudio.disabled = false;
    if (el.btnTranscribe) el.btnTranscribe.disabled = true; // erst nach stop / file select
  } catch (e) {
    alert("Audio-Aufnahme nicht möglich: " + (e.message || String(e)));
    try { audioStream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
    audioStream = null;
  }
}

function stopRecording() {
  if (!isRecording) return;

  try {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      try { mediaRecorder.requestData(); } catch (_) {}
      mediaRecorder.stop();
    }
  } catch (e) {
    // Fallback: Stream hart stoppen und UI reset
    try { audioStream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
    audioStream = null;
    isRecording = false;
    stopTimer();
    setRecordBtnUI(false);
    alert("Stoppen der Aufnahme war nicht möglich. Bitte nochmal versuchen.");
    return;
  }

  // Fallback falls onstop nicht feuert
  setTimeout(() => {
    if (isRecording) {
      try { audioStream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
      audioStream = null;
      isRecording = false;
      stopTimer();
      setRecordBtnUI(false);
      updateTranscribeEnabled();
    }
  }, 1200);
}

function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

function clearAudio() {
  audioChunks = [];
  audioBlob = null;
  if (el.player) {
    el.player.removeAttribute("src");
    el.player.load();
  }
  if (el.fileAudio) el.fileAudio.value = "";
  if (el.btnClearAudio) el.btnClearAudio.disabled = true;
  if (el.recTimer) el.recTimer.textContent = "00:00";
  updateTranscribeEnabled();
}

// -------- Transcribe (Upload oder Aufnahme) --------
async function transcribe() {
  try {
    const base = getApiBase();
    if (!base) {
      alert("Bitte unten eine API-URL eintragen und speichern.");
      return;
    }

    const file = (el.fileAudio && el.fileAudio.files && el.fileAudio.files[0]) ? el.fileAudio.files[0] : null;
    const useBlob = !file && audioBlob;

    if (!file && !useBlob) {
      alert("Bitte erst eine Audioaufnahme erstellen oder eine Audiodatei auswählen.");
      return;
    }

    setBusy(true, "Transkribiere Audio ...");

    const fd = new FormData();
    if (file) {
      fd.append("audio", file, file.name || "upload.m4a");
    } else {
      fd.append("audio", audioBlob, "recording.webm");
    }

    const resp = await fetch(apiUrl("/api/transcribe"), { method: "POST", body: fd });
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
    setBusy(false);
  }
}

// -------- Init --------
function init() {
  // gespeicherte API URL reinladen
  const stored = normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
  if (stored && el.apiBase) el.apiBase.value = stored;

  if (el.btnSaveApi) {
    el.btnSaveApi.addEventListener("click", () => {
      const norm = normalizeApiBase(el.apiBase?.value);
      if (!norm) {
        alert("Bitte eine gültige API-URL eingeben.");
        return;
      }
      setApiBase(norm);
      alert("API-URL gespeichert.");
    });
  }

  if (el.btnGenerate) el.btnGenerate.addEventListener("click", createProtocol);
  if (el.btnReset) el.btnReset.addEventListener("click", resetFields);
  if (el.btnCopy) el.btnCopy.addEventListener("click", copyResult);

  // Audio buttons
  if (el.btnRecord) el.btnRecord.addEventListener("click", toggleRecording);
  if (el.btnStop) el.btnStop.addEventListener("click", stopRecording);
  if (el.btnClearAudio) el.btnClearAudio.addEventListener("click", clearAudio);

  // File select enables transcribe
  if (el.fileAudio) {
    el.fileAudio.addEventListener("change", () => {
      // Wenn eine Datei gewählt wurde, Aufnahme-Blob nicht verwenden
      audioBlob = null;
      if (el.player && el.fileAudio.files && el.fileAudio.files[0]) {
        el.player.src = URL.createObjectURL(el.fileAudio.files[0]);
      }
      updateTranscribeEnabled();
      if (el.btnClearAudio) el.btnClearAudio.disabled = false;
    });
  }

  if (el.btnTranscribe) el.btnTranscribe.addEventListener("click", transcribe);

  // Initial UI
  setRecordBtnUI(false);
  updateTranscribeEnabled();
  if (el.btnClearAudio) el.btnClearAudio.disabled = true;
  if (el.recTimer) el.recTimer.textContent = "00:00";
}

document.addEventListener("DOMContentLoaded", init);
