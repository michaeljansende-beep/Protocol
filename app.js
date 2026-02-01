// Protokoll Recorder - app.js (Rollback-Stabil)
// Ziel: Buttons reagieren + Audio aufnehmen/stoppen + Upload transkribieren + Protokoll erstellen.
// Keine Layout-/PDF-Änderungen. API läuft serverseitig (Worker).

let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let audioBlob = null;
let isRecording = false;

let isStopping = false;
let stopFallbackHandle = null;

function pickRecorderMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac'
  ];
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  for (const t of candidates) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {}
  }
  return '';
}

function mimeToExt(mime) {
  const m = (mime || '').toLowerCase();
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('aac')) return 'aac';
  if (m.includes('mpeg')) return 'mp3';
  return 'webm';
}


let timerHandle = null;
let startedAt = 0;

const $ = (id) => document.getElementById(id);

function mmss(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

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

function startTimer(el) {
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

function setRecordBtnUI(el, recording) {
  if (!el.btnRecord) return;
  // Rot sicherstellen (Fallback, falls CSS nicht greift)
  el.btnRecord.classList.add("rec");
  el.btnRecord.style.background = "#b91c1c";
  el.btnRecord.style.color = "#fff";
  el.btnRecord.textContent = recording ? "Stop" : "Aufnahme starten";
}

function hasSelectedFile(el) {
  return !!(el.fileAudio && el.fileAudio.files && el.fileAudio.files.length > 0);
}

function updateTranscribeEnabled(el) {
  if (!el.btnTranscribe) return;
  el.btnTranscribe.disabled = !(hasSelectedFile(el) || !!audioBlob);
}

function setBusy(el, busy, msg) {
  if (el.btnGenerate) el.btnGenerate.disabled = busy;
  if (el.btnReset) el.btnReset.disabled = busy;
  if (el.btnTranscribe) el.btnTranscribe.disabled = busy || !(hasSelectedFile(el) || !!audioBlob);
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

// -------- Audio --------
async function startRecording() {
  setStatus('Starte Aufnahme ...');

  audioBlob = null;
  audioChunks = [];
  updateTranscribeEnabled();

  try {
    // iOS/Safari: Aufnahmen laufen stabiler, wenn wir explizit Audio-Constraints setzen.
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const mimeType = pickRecorderMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);

    mediaRecorder.ondataavailable = (e) => {
      if (e && e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onerror = (e) => {
      console.error('MediaRecorder error:', e);
      setStatus('Fehler bei der Aufnahme.');
    };

    mediaRecorder.onstop = async () => {
      try {
        // Stoppen wir erst hier (nachdem der Recorder finalisiert hat) den Stream,
        // sonst kann iOS/Safari ein 0-Byte-Blob liefern.
        if (audioStream) {
          audioStream.getTracks().forEach((t) => t.stop());
        }
      } catch (e) {}

      if (stopFallbackHandle) {
        clearTimeout(stopFallbackHandle);
        stopFallbackHandle = null;
      }

      const finalMime = (mediaRecorder && mediaRecorder.mimeType) ? mediaRecorder.mimeType : '';
      const blob = new Blob(audioChunks, { type: finalMime || 'audio/webm' });

      // Auf iOS kann es vorkommen, dass kein Chunk kommt -> dann ist die Aufnahme leer.
      if (!blob || blob.size === 0) {
        audioBlob = null;
        setStatus('Aufnahme leer.');
        alert('Hinweis: iOS hat kein Audio geliefert. Bitte erneut aufnehmen.');
      } else {
        audioBlob = blob;
        audioEl.src = URL.createObjectURL(audioBlob);
        setStatus('Aufnahme bereit.');
      }

      isRecording = false;
      isStopping = false;
      stopTimer();
      setRecordBtnUI(false);
      updateTranscribeEnabled();
    };

    isRecording = true;
    isStopping = false;
    setRecordBtnUI(true);
    startTimer();

    // Wichtig: timeslice sorgt dafür, dass dataavailable regelmäßig feuert (iOS-Fix)
    mediaRecorder.start(250);

    setStatus('Aufnahme läuft ...');
  } catch (err) {
    console.error(err);
    setStatus('Mikrofon-Zugriff nicht möglich.');
    alert('Mikrofon-Zugriff nicht möglich. Bitte iOS-Sprachnotiz (.m4a) hochladen.');
    isRecording = false;
    isStopping = false;
    setRecordBtnUI(false);
    stopTimer();
    updateTranscribeEnabled();
  }
}




function stopRecording() {
  if (!mediaRecorder || !isRecording || isStopping) return;

  isStopping = true;
  setStatus('Stoppe Aufnahme ...');

  // Sicherheitsnetz: falls iOS das onstop nicht liefert
  if (stopFallbackHandle) clearTimeout(stopFallbackHandle);
  stopFallbackHandle = setTimeout(() => {
    try {
      if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
    } catch (e) {}
    isRecording = false;
    isStopping = false;
    setRecordBtnUI(false);
    stopTimer();
    updateTranscribeEnabled();
    setStatus('Aufnahme gestoppt (Fallback).');
  }, 4000);

  try {
    // flush
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try { mediaRecorder.requestData(); } catch (e) {}
      mediaRecorder.stop();
    }
  } catch (e) {
    console.error(e);
    isStopping = false;
  }
}




function toggleRecording(el) {
  if (isRecording) stopRecording(el);
  else startRecording(el);
}

function clearAudio(el) {
  audioChunks = [];
  audioBlob = null;
  if (el.player) {
    el.player.removeAttribute("src");
    el.player.load();
  }
  if (el.fileAudio) el.fileAudio.value = "";
  if (el.btnClearAudio) el.btnClearAudio.disabled = true;
  if (el.recTimer) el.recTimer.textContent = "00:00";
  updateTranscribeEnabled(el);
}

// -------- Transcribe --------
async function transcribe(el) {
  try {
    const base = getApiBase(el);
    if (!base) {
      alert("Bitte unten eine API-URL eintragen und speichern.");
      return;
    }

    const file = hasSelectedFile(el) ? el.fileAudio.files[0] : null;
    const useBlob = !file && audioBlob;

    if (!file && !useBlob) {
      alert("Bitte erst eine Audioaufnahme erstellen oder eine Audiodatei auswählen.");
      return;
    }

    setBusy(el, true, "Transkribiere Audio ...");

    const fd = new FormData();
    if (file) fd.append("audio", file, file.name || "upload.m4a");
    else fd.append("audio", audioBlob, "recording.webm");

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

// -------- Init --------
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

    btnRecord: $("btnRecord"),
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
      setApiBase(el, norm);
      alert("API-URL gespeichert.");
    });
  }

  if (el.btnGenerate) el.btnGenerate.addEventListener("click", () => createProtocol(el));
  if (el.btnReset) el.btnReset.addEventListener("click", () => resetFields(el));
  if (el.btnCopy) el.btnCopy.addEventListener("click", () => copyResult(el));

  if (el.btnRecord) el.btnRecord.addEventListener("click", () => toggleRecording(el));
  if (el.btnStop) el.btnStop.addEventListener("click", () => stopRecording(el));
  if (el.btnClearAudio) el.btnClearAudio.addEventListener("click", () => clearAudio(el));

  if (el.fileAudio) {
    el.fileAudio.addEventListener("change", () => {
      audioBlob = null; // Datei hat Vorrang
      if (el.player && hasSelectedFile(el)) el.player.src = URL.createObjectURL(el.fileAudio.files[0]);
      if (el.btnClearAudio) el.btnClearAudio.disabled = false;
      updateTranscribeEnabled(el);
    });
  }

  if (el.btnTranscribe) el.btnTranscribe.addEventListener("click", () => transcribe(el));

  // Initial UI
  setRecordBtnUI(el, false);
  updateTranscribeEnabled(el);
  if (el.btnClearAudio) el.btnClearAudio.disabled = true;
  if (el.recTimer) el.recTimer.textContent = "00:00";
}

document.addEventListener("DOMContentLoaded", init);
