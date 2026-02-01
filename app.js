// Protokoll Recorder - app.js (Audio-Fix / kompatibel zu mehreren index-Varianten)
// Ziel: Layout NICHT anfassen. Dieses Skript macht Audio-Aufnahme + Upload/Transkription robust,
// auch wenn sich IDs in index.html zwischen Versionen leicht unterscheiden.

let mediaRecorder = null;
let audioChunks = [];
let audioBlob = null;
let recStartTs = 0;
let recTimerInterval = null;
let recStream = null;

const $ = (id) => document.getElementById(id);

// --- Element-Mapping (kompatibel zu älteren/neueren index-Versionen) ---
const el = {
  // API
  apiBase: $("apiBase"),
  btnSaveApi: $("btnSaveApi"),

  // Meta
  date: $("date"),
  time: $("time"),
  datetime: $("datetime"), // falls ein kombiniertes Feld existiert
  location: $("location"),
  title: $("title"),
  participantsCustomer: $("participantsCustomer"),
  participantsInternal: $("participantsInternal"),

  // Notes & protocol
  notes: $("notes"),
  btnGenerate: $("btnGenerate"),
  btnReset: $("btnReset"),

  // Result
  result: $("result"),
  btnCopy: $("btnCopy"),
  btnPDF: $("btnPDF"),

  // Close
  btnClose: $("btnClose"),

  // Audio (neue IDs)
  btnRecToggle: $("btnRecToggle"),
  recLabel: $("recLabel"),
  recTimer: $("recTimer"),
  btnClearAudio: $("btnClearAudio"),
  player: $("player"),
  audioFile: $("audioFile"),
  btnTranscribe: $("btnTranscribe"),
  audioStatus: $("audioStatus"),

  // Audio (alte IDs – fallback)
  btnRecord: $("btnRecord"),
  btnStop: $("btnStop"),
  fileAudio: $("fileAudio"),
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

  const tBtn = getTranscribeButton();
  if (tBtn) tBtn.disabled = isBusy || !hasAnyAudioSelected();

  if (isBusy) {
    if (el.result) el.result.value = (msg || "Bitte warten ...");
  }
}

async function safeJson(resp) {
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await resp.json();
  const t = await resp.text();
  return { error: t || "Unbekannte Antwort (kein JSON)" };
}

// -------------------------
// Protokoll erstellen
// -------------------------
function getMeta() {
  // Wenn es ein kombiniertes datetime Feld gibt (type=datetime-local), splitten wir es sauber.
  let date = el.date?.value || "";
  let time = el.time?.value || "";

  const dt = el.datetime?.value || "";
  if (dt) {
    // dt kann "YYYY-MM-DDTHH:MM" sein
    const parts = dt.split("T");
    if (parts[0]) date = parts[0];
    if (parts[1]) time = parts[1].slice(0, 5);
  }

  return {
    date,
    time,
    location: (el.location?.value || "").trim(),
    title: (el.title?.value || "").trim(),
    participantsCustomer: normalizeList(el.participantsCustomer?.value),
    participantsInternal: normalizeList(el.participantsInternal?.value),
  };
}

async function createProtocol() {
  try {
    const base = getApiBase();
    if (!base) {
      alert('Bitte unten eine API-URL eintragen und auf „Speichern“ drücken.');
      return;
    }

    setBusy(true, "Erstelle Protokoll ...");

    const payload = {
      meta: getMeta(),
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
    if (!text) throw new Error("Antwort war leer (kein protocolText/text).");

    if (el.result) el.result.value = text;
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
  if (el.datetime) el.datetime.value = "";
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

// -------------------------
// Audio helpers
// -------------------------
function setAudioStatus(msg) {
  if (el.audioStatus) {
    el.audioStatus.textContent = msg || "";
  }
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function updateRecTimer() {
  if (!el.recTimer) return;
  const elapsed = (Date.now() - recStartTs) / 1000;
  el.recTimer.textContent = fmtTime(elapsed);
}

function getRecordButton() {
  return el.btnRecToggle || el.btnRecord;
}

function getStopButton() {
  return el.btnStop || null;
}

function getTranscribeButton() {
  return el.btnTranscribe || null;
}

function getFileInput() {
  return el.audioFile || el.fileAudio || null;
}

function hasAnyAudioSelected() {
  const fi = getFileInput();
  if (fi && fi.files && fi.files.length > 0) return true;
  return !!audioBlob;
}

function setRecordingUI(recording) {
  // In this app we use ONE toggle button (btnRecord). A separate btnStop may exist in older builds.
  const hasSeparateStop = !!el.btnStop;
  const toggleBtn = el.btnRecord;
  const stopBtn = el.btnStop;

  if (hasSeparateStop) {
    // Legacy UI (Start + Stop)
    if (toggleBtn) toggleBtn.disabled = recording;
    if (stopBtn) stopBtn.disabled = !recording;
    if (toggleBtn) toggleBtn.classList.toggle('recording', recording);
    if (stopBtn) stopBtn.classList.toggle('recording', recording);
  } else {
    // Current UI (single toggle)
    if (!toggleBtn) return;
    toggleBtn.disabled = false; // never disable; user must be able to stop
    toggleBtn.classList.toggle('recording', recording);

    // Make the state very obvious even if CSS doesn't load (cache / PWA edge cases)
    toggleBtn.style.background = recording ? '#b00020' : '';
    toggleBtn.style.borderColor = recording ? '#b00020' : '';
    toggleBtn.textContent = recording ? 'Stop' : 'Aufnahme starten';
  }

  if (el.recHelp) {
    el.recHelp.textContent = recording
      ? 'Aufnahme läuft ...'
      : 'Hinweis: Aufnahme funktioniert je nach iOS/Safari-Version. Alternativ einfach eine Sprachnotiz (z.B. .m4a) auswählen und transkribieren.';
  }
}

let recordTimerInt = null;
let recordSeconds = 0;
let recordBusy = false;           // debounce start/stop
let requestDataInt = null;        // helps iOS deliver chunks reliably

function startTimer() {
  stopTimer();
  recordSeconds = 0;
  el.recordTimer.textContent = '00:00';
  recordTimerInt = setInterval(() => {
    recordSeconds += 1;
    el.recordTimer.textContent = formatTime(recordSeconds);
  }, 1000);
}

function stopTimer() {
  if (recordTimerInt) {
    clearInterval(recordTimerInt);
    recordTimerInt = null;
  }
}

function safeClearRequestData() {
  if (requestDataInt) {
    clearInterval(requestDataInt);
    requestDataInt = null;
  }
}

function resetRecordingState() {
  safeClearRequestData();
  stopTimer();
  recordBusy = false;
}

async function startRecording() {
  if (recordBusy) return;
  recordBusy = true;

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Aufnahme wird in diesem Browser nicht unterstützt. Bitte iOS-Sprachnotiz (.m4a) hochladen.');
      recordBusy = false;
      return;
    }

    // If we still have an old stream, stop tracks first (prevents "already in use" on iOS)
    if (stream) {
      try { stream.getTracks().forEach(t => t.stop()); } catch {}
      stream = null;
    }

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioChunks = [];
    const options = {};
    const preferTypes = [
      'audio/mp4',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/webm;codecs=opus',
      'audio/webm'
    ];
    for (const t of preferTypes) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
        options.mimeType = t;
        break;
      }
    }

    mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) audioChunks.push(ev.data);
    };

    mediaRecorder.onerror = (ev) => {
      console.error('MediaRecorder error', ev);
    };

    mediaRecorder.onstop = () => {
      try { stream?.getTracks().forEach(t => t.stop()); } catch {}
      stream = null;

      safeClearRequestData();
      stopTimer();

      const blob = getRecordedBlob();
      if (!blob || blob.size === 0) {
        lastRecordedBlob = null;
        setRecordingUI(false);
        recordBusy = false;
        alert('Hinweis: iOS hat kein Audio geliefert. Bitte erneut aufnehmen.');
        return;
      }

      lastRecordedBlob = blob;
      setPlayerBlob(blob);
      setAudioPresent(true);
      setRecordingUI(false);
      recordBusy = false;
    };

    // Start with a timeslice so iOS reliably emits data chunks
    mediaRecorder.start(1000);

    // Additionally ask for data regularly (some iOS versions need this)
    requestDataInt = setInterval(() => {
      try {
        if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.requestData();
      } catch {}
    }, 1200);

    setRecordingUI(true);
    startTimer();

    // short debounce (prevents double tap causing stop->start)
    setTimeout(() => { recordBusy = false; }, 350);
  } catch (err) {
    console.error(err);
    try { stream?.getTracks().forEach(t => t.stop()); } catch {}
    stream = null;
    setRecordingUI(false);
    recordBusy = false;
    alert('Mikrofon-Zugriff nicht möglich. Bitte iOS-Sprachnotiz (.m4a) hochladen.');
  }
}

async function stopRecording() {
  if (recordBusy) return;
  recordBusy = true;

  try {
    if (!mediaRecorder) {
      recordBusy = false;
      return;
    }
    if (mediaRecorder.state === 'inactive') {
      recordBusy = false;
      return;
    }

    // Ask for final chunk before stopping (iOS quirk)
    try { mediaRecorder.requestData(); } catch {}

    mediaRecorder.stop();

    // onstop will release recordBusy; keep a failsafe
    setTimeout(() => { if (recordBusy) recordBusy = false; }, 800);
  } catch (err) {
    console.error(err);
    setRecordingUI(false);
    resetRecordingState();
  }
}

// Bind recording controls
if (el.btnRecord) {
  el.btnRecord.addEventListener('click', async () => {
    try {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        await stopRecording();
      } else {
        await startRecording();
      }
    } catch (e) {
      console.error(e);
      setRecordingUI(false);
      resetRecordingState();
    }
  });
}

if (el.btnStop) {
  el.btnStop.addEventListener('click', async () => {
    try { await stopRecording(); } catch {}
  });
}

if (el.btnClearAudio) {
  el.btnClearAudio.addEventListener('click', () => clearAudio());
}

if (el.fileInput) {
  el.fileInput.addEventListener('change', () => onFileSelected());
}

function onFileSelected() {

  // Preview im Player + Buttons aktivieren
  const fi = getFileInput();
  if (!fi || !fi.files || fi.files.length === 0) {
    setRecordingUI(false);
    return;
  }
  const f = fi.files[0];

  // Optional: Player preview
  try {
    if (el.player) {
      el.player.src = URL.createObjectURL(f);
      el.player.load();
    }
  } catch (_) {}

  // Es ist jetzt "Audio vorhanden" -> Transkribieren erlauben
  const tBtn = getTranscribeButton();
  if (tBtn) tBtn.disabled = false;
  if (el.btnClearAudio) el.btnClearAudio.disabled = false;

  setAudioStatus(`Datei gewählt: ${f.name}`);
}

async function transcribe() {
  try {
    const base = getApiBase();
    if (!base) {
      alert("Bitte unten eine API-URL eintragen und speichern.");
      return;
    }

    const fi = getFileInput();
    const file = (fi && fi.files && fi.files[0]) ? fi.files[0] : null;

    if (!file && !audioBlob) {
      alert("Kein Audio vorhanden.");
      return;
    }

    setBusy(true, "Transkribiere Audio ...");
    setAudioStatus("Transkription läuft ...");

    const fd = new FormData();
    if (file) {
      fd.append("audio", file, file.name);
    } else {
      // recorded blob
      const ext = (audioBlob.type.includes("mp4") ? "m4a" : audioBlob.type.includes("wav") ? "wav" : "webm");
      fd.append("audio", audioBlob, `recording.${ext}`);
    }

    const resp = await fetch(apiUrl("/api/transcribe"), { method: "POST", body: fd });
    const data = await safeJson(resp);

    if (!resp.ok) {
      // Serverfehler sauber anzeigen
      const msg = (data && (data.error || data.message)) ? (data.error || data.message) : "Serverfehler";
      throw new Error(msg);
    }

    const transcript = (data.transcript || data.text || "").trim();
    if (!transcript) {
      setAudioStatus("Transkription war leer.");
      alert("Transkription war leer.");
      return;
    }

    if (el.notes) {
      el.notes.value = transcript + "\n\n" + (el.notes.value || "");
    }

    setAudioStatus("Transkription fertig.");
  } catch (e) {
    setAudioStatus("Serverfehler");
    alert(e.message || String(e));
  } finally {
    setBusy(false);
    // Buttons wieder korrekt
    setRecordingUI(!!(mediaRecorder && mediaRecorder.state === "recording"));
    const tBtn = getTranscribeButton();
    if (tBtn) tBtn.disabled = !hasAnyAudioSelected();
  }
}

// -------------------------
// Init
// -------------------------
function init() {
  // API URL reinladen
  const stored = normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
  if (stored && el.apiBase) el.apiBase.value = stored;

  if (el.btnSaveApi) {
    el.btnSaveApi.addEventListener("click", () => {
      const v = el.apiBase?.value || "";
      const norm = normalizeApiBase(v);
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

  // Close (nur in Web-App sinnvoll)
  if (el.btnClose) {
    el.btnClose.addEventListener("click", () => {
      // iOS PWA: window.close klappt meist nicht -> wir versuchen es, ansonsten Hinweis
      try {
        window.close();
      } catch (_) {}
    });
  }

  // Audio wiring (neu)
  if (el.btnRecToggle) el.btnRecToggle.addEventListener("click", toggleRecording);

  // Audio wiring (alt)
  if (el.btnRecord) el.btnRecord.addEventListener("click", startRecording);
  if (el.btnStop) el.btnStop.addEventListener("click", stopRecording);

  if (el.btnClearAudio) el.btnClearAudio.addEventListener("click", clearAudio);

  const fi = getFileInput();
  if (fi) fi.addEventListener("change", onFileSelected);

  const tBtn = getTranscribeButton();
  if (tBtn) tBtn.addEventListener("click", transcribe);

  // Initial UI state
  setRecordingUI(false);
  const t = getTranscribeButton();
  if (t) t.disabled = !hasAnyAudioSelected();
}
document.addEventListener("DOMContentLoaded", init);
