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

function setRecordingUI(isRecording) {
  const btn = getRecordButton();
  const stopBtn = getStopButton();

  // Single toggle button (neue UI)
  if (btn && btn === el.btnRecToggle) {
    if (el.recLabel) el.recLabel.textContent = isRecording ? "Aufnahme läuft" : "Aufnahme starten";
    btn.classList.toggle("recording", isRecording);

    // Fallback inline style, falls CSS mal nicht greift:
    if (isRecording) {
      btn.dataset._bg = btn.style.backgroundColor || "";
      btn.dataset._color = btn.style.color || "";
      btn.style.backgroundColor = "#b10f0f";
      btn.style.color = "#fff";
    } else {
      btn.style.backgroundColor = btn.dataset._bg || "";
      btn.style.color = btn.dataset._color || "";
    }
  }

  // Alte UI: Start/Stop getrennt
  if (btn && btn === el.btnRecord) {
    // Rot-Anzeige über Klasse + inline, damit es sichtbar ist
    btn.classList.toggle("recording", isRecording);
    btn.classList.toggle("rec", true);
    btn.style.backgroundColor = isRecording ? "#b10f0f" : "";
    btn.style.color = isRecording ? "#fff" : "";
    btn.disabled = isRecording;
    if (stopBtn) stopBtn.disabled = !isRecording;
  }

  if (el.btnClearAudio) el.btnClearAudio.disabled = isRecording || (!audioBlob && !(getFileInput()?.files?.length));

  const tBtn = getTranscribeButton();
  if (tBtn) tBtn.disabled = isRecording || !hasAnyAudioSelected();

  if (el.recTimer) {
    if (!isRecording) el.recTimer.textContent = "00:00";
  }
}

async function startRecording() {
  // iOS/Safari: MediaRecorder ist nicht überall verfügbar. Wenn nicht vorhanden, freundlich melden.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Audio-Aufnahme wird in diesem Browser nicht unterstützt. Bitte iOS-Sprachnotiz hochladen.");
    return;
  }
  if (typeof MediaRecorder === "undefined") {
    alert("Audio-Aufnahme (MediaRecorder) wird in diesem Safari nicht unterstützt. Bitte iOS-Sprachnotiz hochladen.");
    return;
  }

  try {
    setAudioStatus("");
    audioChunks = [];
    audioBlob = null;

    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // mimeType: Safari kann z.B. audio/mp4 nicht mit MediaRecorder. Wir lassen den Browser entscheiden.
    mediaRecorder = new MediaRecorder(recStream);

    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) audioChunks.push(ev.data);
    };

    mediaRecorder.onstop = () => {
      try {
        const mime = mediaRecorder.mimeType || "audio/webm";
        audioBlob = new Blob(audioChunks, { type: mime });

        if (el.player) {
          el.player.src = URL.createObjectURL(audioBlob);
          el.player.load();
        }
      } finally {
        // tracks stoppen
        if (recStream) recStream.getTracks().forEach((t) => t.stop());
        recStream = null;
        mediaRecorder = null;

        // timer stoppen
        if (recTimerInterval) clearInterval(recTimerInterval);
        recTimerInterval = null;

        setRecordingUI(false);
        setAudioStatus("Aufnahme bereit.");
      }
    };

    mediaRecorder.start();
    recStartTs = Date.now();
    if (recTimerInterval) clearInterval(recTimerInterval);
    recTimerInterval = setInterval(updateRecTimer, 250);

    setRecordingUI(true);
    setAudioStatus("Aufnahme läuft ...");
  } catch (e) {
    setRecordingUI(false);
    alert("Audio-Aufnahme nicht möglich: " + (e.message || String(e)));
  }
}

function stopRecording() {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    } else {
      // falls alte UI auf Stop klickt ohne Recorder
      setAudioStatus("");
    }
  } catch (e) {
    alert("Stop nicht möglich: " + (e.message || String(e)));
  }
}

function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    stopRecording();
  } else {
    startRecording();
  }
}

function clearAudio() {
  audioChunks = [];
  audioBlob = null;

  const fi = getFileInput();
  if (fi) fi.value = "";

  if (el.player) {
    el.player.removeAttribute("src");
    el.player.load();
  }

  setAudioStatus("");
  setRecordingUI(false);
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
