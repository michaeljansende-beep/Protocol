// Protokoll Recorder - app.js (v6)

let mediaRecorder = null;
let audioChunks = [];
let audioBlob = null;
let audioStream = null;

let isRecording = false;
let recStartMs = 0;
let recTimerHandle = null;

let selectedAudioFile = null;

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

  notes: $("notes"),
  btnGenerate: $("btnGenerate"),
  btnReset: $("btnReset"),

  result: $("result"),
  btnCopy: $("btnCopy"),
  btnPDF: $("btnPDF"),

  btnRecToggle: $("btnRecToggle"),
  recLabel: $("recLabel"),
  recTimer: $("recTimer"),
  btnClearAudio: $("btnClearAudio"),
  player: $("player"),
  audioFile: $("audioFile"),
  btnTranscribe: $("btnTranscribe"),
  audioStatus: $("audioStatus"),

  btnClose: $("btnClose"),
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

function setStatus(msg) {
  if (el.audioStatus) el.audioStatus.textContent = msg || "";
}

function setBusy(isBusy, msg) {
  el.btnGenerate.disabled = isBusy;
  el.btnReset.disabled = isBusy;
  el.btnTranscribe.disabled = isBusy || (!audioBlob && !selectedAudioFile);
  if (isBusy && msg) el.result.value = msg;
}

async function safeJson(resp) {
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await resp.json();
  const t = await resp.text();
  return { error: t || "Unbekannte Antwort (kein JSON)" };
}

function mmss(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
}

function startTimer() {
  stopTimer();
  recStartMs = Date.now();
  el.recTimer.textContent = "00:00";
  recTimerHandle = setInterval(() => {
    el.recTimer.textContent = mmss((Date.now() - recStartMs) / 1000);
  }, 250);
}

function stopTimer() {
  if (recTimerHandle) {
    clearInterval(recTimerHandle);
    recTimerHandle = null;
  }
}

function setRecUi(recording) {
  isRecording = recording;
  if (recording) {
    el.btnRecToggle.classList.add("recording");
    el.recLabel.textContent = "Aufnahme läuft - Stop";
    startTimer();
  } else {
    el.btnRecToggle.classList.remove("recording");
    el.recLabel.textContent = "Aufnahme starten";
    stopTimer();
  }
}

async function createProtocol() {
  try {
    const base = getApiBase();
    if (!base) return alert("Bitte unten (API-URL) eine API-URL eintragen und auf „Speichern“ drücken.");

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
    if (!resp.ok) throw new Error(data.error || "Erstellung fehlgeschlagen");

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
  el.btnCopy.disabled = true;
  el.btnPDF.disabled = true;
  clearAudioAll();
  setStatus("");
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

/* AUDIO */

function clearAudioAll() {
  if (isRecording) stopRecording();
  audioChunks = [];
  audioBlob = null;
  selectedAudioFile = null;
  if (el.audioFile) el.audioFile.value = "";
  el.player.removeAttribute("src");
  el.player.load();
  el.btnTranscribe.disabled = true;
  el.btnClearAudio.disabled = true;
  el.recTimer.textContent = "00:00";
  setRecUi(false);
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioStream = stream;
  audioChunks = [];
  audioBlob = null;
  selectedAudioFile = null;

  let mr;
  try {
    mr = new MediaRecorder(stream);
  } catch (e) {
    throw new Error("Aufnahme wird von diesem Browser nicht unterstützt. Bitte eine iOS-Sprachnotiz auswählen.");
  }

  mediaRecorder = mr;
  mediaRecorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) audioChunks.push(ev.data);
  };
  mediaRecorder.onstop = () => {
    const type = mediaRecorder.mimeType || "audio/webm";
    audioBlob = new Blob(audioChunks, { type });
    el.player.src = URL.createObjectURL(audioBlob);
    el.btnTranscribe.disabled = false;
    el.btnClearAudio.disabled = false;

    if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;

    setStatus("Audioaufnahme bereit.");
  };

  mediaRecorder.start();
  setRecUi(true);
  el.btnClearAudio.disabled = false;
  el.btnTranscribe.disabled = true;
  setStatus("Aufnahme läuft ...");
}

function stopRecording() {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  } catch (_) {}
  setRecUi(false);
  try {
    if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
  } catch (_) {}
  audioStream = null;
}

async function toggleRecording() {
  try {
    if (!isRecording) await startRecording();
    else stopRecording();
  } catch (e) {
    setRecUi(false);
    setStatus("");
    alert("Audio-Aufnahme nicht möglich: " + (e.message || String(e)));
  }
}

function onFilePicked() {
  const f = el.audioFile.files?.[0] || null;
  selectedAudioFile = f;
  audioBlob = null;
  audioChunks = [];
  if (!f) {
    el.btnTranscribe.disabled = true;
    setStatus("");
    return;
  }
  try { el.player.src = URL.createObjectURL(f); } catch (_) {}
  el.btnTranscribe.disabled = false;
  el.btnClearAudio.disabled = false;
  setStatus("Datei gewählt: " + f.name);
}

async function transcribeToNotes() {
  try {
    const base = getApiBase();
    if (!base) return alert("Bitte unten (API-URL) eine API-URL eintragen und speichern.");

    const fileOrBlob = selectedAudioFile || audioBlob;
    if (!fileOrBlob) return;

    setBusy(true, "Transkribiere Audio ...");
    setStatus("Transkription läuft ...");

    const fd = new FormData();
    fd.append("audio", fileOrBlob, selectedAudioFile?.name || "recording.webm");

    const resp = await fetch(apiUrl("/api/transcribe"), { method: "POST", body: fd });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || "Transkription fehlgeschlagen");

    const transcript = (data.transcript || data.text || "").trim();
    if (!transcript) throw new Error("Transkription war leer.");

    const existing = (el.notes.value || "").trim();
    el.notes.value = transcript + (existing ? "\n\n" + existing : "");
    setStatus("Transkription fertig - Text in Notizen eingefügt.");
  } catch (e) {
    setStatus("");
    alert(e.message || String(e));
  } finally {
    setBusy(false);
  }
}

/* INIT */

function init() {
  const stored = normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
  if (stored) el.apiBase.value = stored;

  el.btnSaveApi.addEventListener("click", () => {
    const norm = normalizeApiBase(el.apiBase.value);
    if (!norm) return alert("Bitte eine gültige API-URL eingeben.");
    setApiBase(norm);
    alert("API-URL gespeichert.");
  });

  el.btnGenerate.addEventListener("click", createProtocol);
  el.btnReset.addEventListener("click", resetFields);
  el.btnCopy.addEventListener("click", copyResult);

  el.btnRecToggle.addEventListener("click", toggleRecording);
  el.btnClearAudio.addEventListener("click", clearAudioAll);
  el.audioFile.addEventListener("change", onFilePicked);
  el.btnTranscribe.addEventListener("click", transcribeToNotes);

  el.btnClose.addEventListener("click", () => {
    try {
      window.close();
      setTimeout(() => alert("Wenn das Schließen nicht klappt: In iOS bitte nach oben wischen oder über den App-Switcher schließen."), 200);
    } catch (_) {
      alert("In iOS bitte nach oben wischen oder über den App-Switcher schließen.");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
