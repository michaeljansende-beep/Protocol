// Protokoll Recorder – app.js (Safari-freundlich)
// - Protokoll via Worker: POST /api/createProtocol
// - Transkription optional via Worker: POST /api/transcribe (FormData: "audio")
// Hinweis iOS/Safari: MediaRecorder ist oft NICHT verfügbar. Dann zeigen wir eine klare Meldung.

let mediaRecorder = null;
let audioChunks = [];
let audioBlob = null;

const $ = (id) => document.getElementById(id);

const el = {
  apiBase: $("apiBase"),
  btnSaveApi: $("btnSaveApi"),

  date: $("date"),
  time: $("time"),
  location: $("location"),
  title: $("title"),
  participantsCustomer: $("participantsCustomer"),
  participantsInternal: $("participantsInternal"),

  btnRecord: $("btnRecord"),
  btnStop: $("btnStop"),
  btnClearAudio: $("btnClearAudio"),
  player: $("player"),
  btnTranscribe: $("btnTranscribe"),

  notes: $("notes"),
  btnGenerate: $("btnGenerate"),
  btnReset: $("btnReset"),

  result: $("result"),
  btnCopy: $("btnCopy"),
  btnPDF: $("btnPDF"),
};

// ---------- Helpers ----------
function normalizeApiBase(v) {
  v = (v || "").trim();
  if (!v) return "";
  return v.replace(/\/+$/, "");
}

function setApiBase(v) {
  const base = normalizeApiBase(v);
  if (el.apiBase) el.apiBase.value = base;
  if (base) localStorage.setItem("protocol_api_base", base);
}

function getApiBase() {
  const fromInput = normalizeApiBase(el.apiBase?.value);
  if (fromInput) return fromInput;

  const fromStore = normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
  return fromStore;
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

function enableResultButtons() {
  const hasText = (el.result.value || "").trim().length > 0;
  el.btnCopy.disabled = !hasText;
  // PDF-Button wird von pdf.js zusätzlich überwacht – wir aktivieren ihn hier trotzdem.
  el.btnPDF.disabled = !hasText;
}

function setBusy(isBusy, msg) {
  el.btnGenerate.disabled = isBusy;
  el.btnReset.disabled = isBusy;

  // Transcribe nur, wenn Audio vorhanden UND nicht busy
  el.btnTranscribe.disabled = isBusy || !audioBlob;

  if (isBusy && el.result) el.result.value = msg || "Bitte warten ...";
}

// Safari / iOS Check
function isIOSSafari() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIOS && isSafari;
}

async function safeJson(resp) {
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await resp.json();
  const t = await resp.text();
  return { error: t || "Unbekannte Antwort (kein JSON)" };
}

// ---------- Protokoll ----------
async function createProtocol() {
  try {
    const base = getApiBase();
    if (!base) {
      alert("Bitte oben eine API-URL eintragen und auf „Speichern“ drücken.");
      return;
    }

    setBusy(true, "Erstelle Protokoll ...");

    const payload = {
      meta: {
        date: el.date.value || "",
        time: el.time.value || "",
        location: (el.location.value || "").trim(),
        title: (el.title.value || "").trim(),
        participantsCustomer: normalizeList(el.participantsCustomer.value),
        participantsInternal: normalizeList(el.participantsInternal.value),
      },
      notes: (el.notes.value || "").trim(),
    };

    const resp = await fetch(apiUrl("/api/createProtocol"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await safeJson(resp);

    if (!resp.ok) {
      throw new Error(data.error || "Erstellung fehlgeschlagen");
    }

    const text = (data.protocolText || data.text || "").toString().trim();
    if (!text) throw new Error("Antwort war leer.");

    el.result.value = text;
    enableResultButtons();
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
  enableResultButtons();
}

// ---------- Copy ----------
async function copyResult() {
  try {
    const t = (el.result.value || "").trim();
    if (!t) return;

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      alert("In Zwischenablage kopiert.");
      return;
    }

    // Fallback
    el.result.focus();
    el.result.select();
    document.execCommand("copy");
    alert("In Zwischenablage kopiert.");
  } catch (e) {
    alert("Kopieren nicht möglich: " + (e.message || String(e)));
  }
}

// ---------- Audio ----------
function audioCapabilityMessage() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Audioaufnahme geht hier nicht: getUserMedia wird nicht unterstützt.";
  }
  if (typeof MediaRecorder === "undefined") {
    // iOS Safari häufig
    if (isIOSSafari()) {
      return (
        "Safari auf iPhone/iPad unterstützt die Audioaufnahme per Web-App oft nicht (MediaRecorder fehlt).\n\n" +
        "Workaround:\n" +
        "- iOS Diktierfunktion in Notizen nutzen und Text hier einfügen\n" +
        "- oder Sprachmemo aufnehmen und als Datei später transkribieren"
      );
    }
    return "Audioaufnahme geht hier nicht: MediaRecorder wird nicht unterstützt.";
  }
  return "";
}

async function startRecording() {
  const msg = audioCapabilityMessage();
  if (msg) {
    alert(msg);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioChunks = [];
    audioBlob = null;

    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) audioChunks.push(ev.data);
    };

    mediaRecorder.onstop = () => {
      try {
        audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        el.player.src = URL.createObjectURL(audioBlob);

        el.btnTranscribe.disabled = false;
        el.btnClearAudio.disabled = false;
      } finally {
        el.btnStop.disabled = true;
        el.btnRecord.disabled = false;

        // Tracks stoppen
        stream.getTracks().forEach((t) => t.stop());
      }
    };

    mediaRecorder.start();

    el.btnRecord.disabled = true;
    el.btnStop.disabled = false;
    el.btnClearAudio.disabled = true;
    el.btnTranscribe.disabled = true;
  } catch (e) {
    alert("Audio-Aufnahme nicht möglich: " + (e.message || String(e)));
  }
}

function stopRecording() {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  } catch (e) {
    alert("Stop nicht möglich: " + (e.message || String(e)));
  }
}

function clearAudio() {
  audioChunks = [];
  audioBlob = null;
  el.player.removeAttribute("src");
  el.player.load();

  el.btnTranscribe.disabled = true;
  el.btnClearAudio.disabled = true;
}

// ---------- Transcribe ----------
async function transcribe() {
  try {
    const base = getApiBase();
    if (!base) {
      alert("Bitte oben eine API-URL eintragen und speichern.");
      return;
    }
    if (!audioBlob) {
      alert("Kein Audio vorhanden.");
      return;
    }

    setBusy(true, "Transkribiere Audio ...");

    const fd = new FormData();
    fd.append("audio", audioBlob, "recording.webm");

    const resp = await fetch(apiUrl("/api/transcribe"), { method: "POST", body: fd });
    const data = await safeJson(resp);

    if (!resp.ok) throw new Error(data.error || "Transkription fehlgeschlagen");

    const transcript = (data.transcript || data.text || "").toString().trim();
    if (!transcript) {
      alert("Transkription war leer.");
      return;
    }

    el.notes.value = transcript + "\n\n" + (el.notes.value || "");
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    setBusy(false);
  }
}

// ---------- Init ----------
function init() {
  // gespeicherte API URL laden
  const stored = normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
  if (stored) el.apiBase.value = stored;

  enableResultButtons();

  el.btnSaveApi.addEventListener("click", () => {
    const norm = normalizeApiBase(el.apiBase.value);
    if (!norm) {
      alert("Bitte eine gültige API-URL eingeben.");
      return;
    }
    setApiBase(norm);
    alert("API-URL gespeichert.");
  });

  el.btnGenerate.addEventListener("click", createProtocol);
  el.btnReset.addEventListener("click", resetFields);
  el.btnCopy.addEventListener("click", copyResult);

  // Audio Buttons
  el.btnRecord.addEventListener("click", startRecording);
  el.btnStop.addEventListener("click", stopRecording);
  el.btnClearAudio.addEventListener("click", clearAudio);
  el.btnTranscribe.addEventListener("click", transcribe);

  // Hinweis für Safari/iOS sofort sichtbar machen, wenn Audio nicht geht
  const msg = audioCapabilityMessage();
  if (msg) {
    // Nicht dauernd nerven – nur einmal beim Start
    console.log(msg);
  }
}

document.addEventListener("DOMContentLoaded", init);
