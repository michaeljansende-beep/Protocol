// Protokoll Recorder - app.js (Rollback-Stabil)
// Ziel: Buttons reagieren + Audio aufnehmen/stoppen + Upload transkribieren + Protokoll erstellen.
// Keine Layout-/PDF-Änderungen. API läuft serverseitig (Worker).

let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let audioBlob = null;
let isRecording = false;

let timerHandle = null;
let startedAt = 0;

// iOS can fire both touch + click (or a delayed click). Prevent double/ghost triggers.
let recordTapLock = false;
function lockRecordTap(ms = 350) {
  if (recordTapLock) return true;
  recordTapLock = true;
  window.setTimeout(() => {
    recordTapLock = false;
  }, ms);
  return false;
}

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
async function startRecording(el) {
  if (isRecording) return;

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    alert("Audio-Aufnahme wird von diesem Browser nicht unterstützt. Bitte Audio-Datei (z.B. .m4a) hochladen.");
    return;
  }

  // Vorherige Audio-URL sauber freigeben
  if (lastObjectUrl) {
    try { URL.revokeObjectURL(lastObjectUrl); } catch (_) {}
    lastObjectUrl = null;
  }

  // iOS/Safari: ensure audio context is resumed in direct response to user gesture.
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const ctx = new AC();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      // Close if available (not in all WebKit versions)
      if (typeof ctx.close === "function") {
        await ctx.close();
      }
    }
  } catch (_) {
    // ignore
  }

  try {
    const gumPromise = navigator.mediaDevices.getUserMedia({ audio: true });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("gum_timeout")), 8000)
    );
    audioStream = await Promise.race([gumPromise, timeoutPromise]);
  } catch (err) {
    const msg = (err && err.message === "gum_timeout")
      ? "Mikrofon-Start dauert zu lange. Bitte Safari-Mikrofonfreigabe prüfen und Seite neu laden."
      : "Mikrofon-Zugriff nicht möglich. Bitte iOS-Sprachnotiz (.m4a) hochladen.";
    alert(msg);
    console.error(err);
    return;
  }

  audioChunks = [];
  audioBlob = null;

  // iOS/Safari liefert sonst teils leere Blobs - daher: mimeType + timeslice
  const candidates = [
    "audio/mp4",                // Safari (iOS/macOS)
    "audio/webm;codecs=opus",   // Chrome/Edge
    "audio/webm"                // Fallback
  ];
  let mimeType = "";
  for (const c of candidates) {
    try {
      if (window.MediaRecorder?.isTypeSupported && MediaRecorder.isTypeSupported(c)) {
        mimeType = c;
        break;
      }
    } catch (_) {}
  }

  try {
    mediaRecorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
  } catch (e) {
    console.error(e);
    alert("Audio-Aufnahme konnte nicht gestartet werden. Bitte Audio-Datei hochladen.");
    try { audioStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
    audioStream = null;
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e?.data && e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    // Finalen Chunk abwarten (Safari liefert dataavailable manchmal sehr spät)
    setTimeout(() => {
      try {
        const finalType = mimeType || mediaRecorder?.mimeType || "audio/mp4";
        audioBlob = new Blob(audioChunks, { type: finalType });

        if (!audioBlob || audioBlob.size < 1024) {
          audioBlob = null;
          if (el.player) {
            el.player.removeAttribute('src');
            el.player.load();
          }
          alert("Hinweis: iOS hat kein Audio geliefert. Bitte erneut aufnehmen oder eine Sprachnotiz (.m4a) hochladen.");
        } else {
          lastObjectUrl = URL.createObjectURL(audioBlob);
          if (el.player) {
            el.player.src = lastObjectUrl;
          }
        }
      } catch (err) {
        console.error(err);
        audioBlob = null;
        alert("Fehler beim Erstellen der Aufnahme. Bitte erneut aufnehmen.");
      } finally {
        try { audioStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
        audioStream = null;
        isRecording = false;
        stopTimer();
        setRecordBtnUI(el, false);
        updateTranscribeEnabled(el);
      }
    }, 150);
  };

  isRecording = true;
  setRecordBtnUI(el, true);
  startTimer(el);
  updateTranscribeEnabled(el);

  try {
    // Timeslice erzwingt regelmäßige dataavailable-Events -> verhindert leere Blobs auf iOS
    mediaRecorder.start(250);
  } catch (err) {
    console.error(err);
    isRecording = false;
    setRecordBtnUI(el, false);
    stopTimer();
    updateTranscribeEnabled(el);
    try { audioStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
    audioStream = null;
    alert("Audio-Aufnahme konnte nicht gestartet werden. Bitte Audio-Datei hochladen.");
  }
}

function stopRecording(el) {
  // Nicht sofort resetten - nur stoppen; UI wird in onstop final gesetzt
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;

  try {
    // Safari: requestData kann helfen, ist aber optional
    try { mediaRecorder.requestData(); } catch (_) {}
    mediaRecorder.stop();
  } catch (err) {
    console.error(err);
    // Fallback: Stream beenden
    try { audioStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
    audioStream = null;
    isRecording = false;
    stopTimer();
    setRecordBtnUI(el, false);
    updateTranscribeEnabled(el);
  }
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

  if (el.btnRecord) {
    const onRecordPress = (ev) => {
      // Prevent double/ghost taps (touchend + click) on iOS
      if (ev) {
        try { ev.preventDefault(); } catch (_) {}
        try { ev.stopPropagation(); } catch (_) {}
      }
      if (lockRecordTap()) return;
      toggleRecording(el);
    };

    // click for desktop + iPad, touchend helps some iOS/PWA contexts.
    el.btnRecord.addEventListener("click", onRecordPress);
    el.btnRecord.addEventListener("touchend", onRecordPress, { passive: false });
  }
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

// --- iOS Kurzbefehle Integration (optional, stört nichts wenn Elemente fehlen) ---
(function(){
  const KEY = "protocol_shortcut_name";
  const DEFAULT_SHORTCUT_NAME = "Audio F\u00fcr Protokoll App";

  function $(id){ return document.getElementById(id); }

  function loadName(){
    return ((localStorage.getItem(KEY) || DEFAULT_SHORTCUT_NAME || "")).trim();
  }
  function saveName(v){
    v = (v || "").trim();
    localStorage.setItem(KEY, v);
  }

  function wireShortcutUI(){
    const nameInput = $("shortcutName");
    const btnRun = $("btnRunShortcut");
    const btnPick = $("btnPickAudio");
    const file = $("fileAudio");

    if (nameInput){
      const stored = loadName();
      if (stored) nameInput.value = stored;

      nameInput.addEventListener("change", () => saveName(nameInput.value));
      nameInput.addEventListener("blur", () => saveName(nameInput.value));
    }

    if (btnPick && file){
      btnPick.addEventListener("click", () => file.click());
    }

    if (btnRun){
      // Rot sicherstellen (Fallback)
      btnRun.style.background = "#b91c1c";
      btnRun.style.color = "#fff";

      btnRun.addEventListener("click", () => {
        const name = (nameInput?.value || loadName()).trim();
        if (!name){
          alert("Bitte den Kurzbefehl-Namen eintragen (genau wie in iOS Kurzbefehle).");
          return;
        }
        saveName(name);
        window.location.href = "shortcuts://run-shortcut?name=" + encodeURIComponent(name);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", wireShortcutUI, { once: true });
})();
