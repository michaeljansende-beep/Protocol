// Protokoll Recorder v5
// - 2x2 Layout: Gesprächspartner | Notizen | Audio | Ergebnis
// - Audio: Start/Stop EIN Button + rotes Feedback + Timer
// - Upload: iOS Sprachnotiz (.m4a etc.) möglich
// - Transkription: POST /api/transcribe (FormData: audio)
// - Protokoll: POST /api/createProtocol (JSON: { meta, notes })
// - PDF: client-side via pdf-lib

let mediaRecorder = null;
let recStream = null;
let recTimerInt = null;
let recStartMs = 0;

let currentAudioBlob = null; // recorded or uploaded
let currentAudioFilename = null;

const $ = (id) => document.getElementById(id);

const el = {
  // footer api
  apiBase: $("apiBase"),
  btnSaveApi: $("btnSaveApi"),

  // meta
  date: $("date"),
  time: $("time"),
  location: $("location"),
  title: $("title"),
  participantsCustomer: $("participantsCustomer"),
  participantsInternal: $("participantsInternal"),

  // notes
  notes: $("notes"),
  btnGenerate: $("btnGenerate"),
  btnReset: $("btnReset"),

  // audio
  btnRecordToggle: $("btnRecordToggle"),
  recLabel: $("recLabel"),
  recTimer: $("recTimer"),
  btnClearAudio: $("btnClearAudio"),
  player: $("player"),
  fileAudio: $("fileAudio"),
  btnTranscribe: $("btnTranscribe"),

  // result
  result: $("result"),
  btnCopy: $("btnCopy"),
  btnPDF: $("btnPDF"),

  // close
  btnClose: $("btnClose"),
};

function normalizeApiBase(v){
  v = (v || "").trim();
  if (!v) return "";
  return v.replace(/\/+$/, ""); // trailing slash
}
function setApiBase(v){
  const base = normalizeApiBase(v);
  if (el.apiBase) el.apiBase.value = base;
  if (base) localStorage.setItem("protocol_api_base", base);
}
function getApiBase(){
  const fromInput = normalizeApiBase(el.apiBase?.value);
  if (fromInput) return fromInput;
  return normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
}
function apiUrl(path){
  const base = getApiBase();
  if (!base) return "";
  if (!path.startsWith("/")) path = "/" + path;
  return base + path;
}

function normalizeList(text){
  return (text || "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^\-\s*/, "")); // leading "- "
}

async function safeJson(resp){
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await resp.json();
  const t = await resp.text();
  return { error: t || "Unbekannte Antwort (kein JSON)" };
}

function setBusy(isBusy, msg){
  el.btnGenerate.disabled = isBusy;
  el.btnReset.disabled = isBusy;
  el.btnTranscribe.disabled = isBusy || !currentAudioBlob;
  if (isBusy && msg) {
    el.result.value = msg;
  }
}

function ensureApi(){
  const base = getApiBase();
  if (!base) {
    alert("Bitte unten eine API-URL eintragen und auf 'Speichern' drücken.");
    return false;
  }
  return true;
}

async function createProtocol(){
  try{
    if (!ensureApi()) return;

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
    el.btnCopy.disabled = false;
    el.btnPDF.disabled = false;
  }catch(e){
    alert(e.message || String(e));
  }finally{
    setBusy(false);
  }
}

function resetFields(){
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
}

async function copyResult(){
  try{
    const t = el.result.value || "";
    if (!t) return;
    await navigator.clipboard.writeText(t);
    alert("In Zwischenablage kopiert.");
  }catch(e){
    alert("Kopieren nicht möglich: " + (e.message || String(e)));
  }
}

// ---- PDF (simple) ----
async function createPdf(){
  try{
    const text = (el.result.value || "").trim();
    if (!text) return;

    // pdf-lib is loaded globally as PDFLib
    const { PDFDocument, StandardFonts } = window.PDFLib || {};
    if (!PDFDocument) {
      alert("PDF-Library nicht geladen.");
      return;
    }

    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]); // A4 portrait
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const margin = 48;
    let y = page.getHeight() - margin;

    const title = (el.title.value || "Gesprächsprotokoll").trim() || "Gesprächsprotokoll";
    const date = el.date.value || "";
    const time = el.time.value || "";
    const loc  = (el.location.value || "").trim();

    page.drawText(title, { x: margin, y, size: 18, font: fontBold });
    y -= 26;

    const metaLine = [date, time, loc].filter(Boolean).join("  |  ");
    if (metaLine) {
      page.drawText(metaLine, { x: margin, y, size: 11, font });
      y -= 18;
    }

    y -= 6;

    const wrap = (str, maxChars) => {
      const words = str.split(/\s+/);
      const lines = [];
      let line = "";
      for (const w of words) {
        const t = line ? (line + " " + w) : w;
        if (t.length > maxChars) {
          if (line) lines.push(line);
          line = w;
        } else {
          line = t;
        }
      }
      if (line) lines.push(line);
      return lines;
    };

    const lines = text.split(/\r?\n/);
    const fontSize = 11;
    const lineHeight = 14;

    for (const raw of lines) {
      const s = raw.replace(/\t/g, "    ");
      const parts = wrap(s, 95);
      for (const p of parts) {
        if (y < margin + lineHeight) {
          y = page.getHeight() - margin;
          doc.addPage([595.28, 841.89]);
          // NOTE: for simplicity, we won't re-grab page reference here; keep single-page for now
          // If you want multi-page later, we can enhance.
          break;
        }
        page.drawText(p, { x: margin, y, size: fontSize, font });
        y -= lineHeight;
      }
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    const safeName = title.replace(/[^a-z0-9\-\_\s]/gi, "").trim().replace(/\s+/g, "_");
    a.href = url;
    a.download = (safeName || "protokoll") + ".pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }catch(e){
    alert(e.message || String(e));
  }
}

// ---- Audio ----
function setTimerText(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const mm = String(Math.floor(s/60)).padStart(2,"0");
  const ss = String(s%60).padStart(2,"0");
  el.recTimer.textContent = mm + ":" + ss;
}

function stopTimer(){
  if (recTimerInt) clearInterval(recTimerInt);
  recTimerInt = null;
}

function setAudioFromBlob(blob, filename){
  currentAudioBlob = blob;
  currentAudioFilename = filename || "audio";
  el.player.src = URL.createObjectURL(blob);
  el.btnTranscribe.disabled = !currentAudioBlob;
  el.btnClearAudio.disabled = !currentAudioBlob;
}

function clearAudio(){
  currentAudioBlob = null;
  currentAudioFilename = null;
  el.player.removeAttribute("src");
  el.player.load();
  el.fileAudio.value = "";
  el.btnTranscribe.disabled = true;
  el.btnClearAudio.disabled = true;
}

async function startRecording(){
  // Safari/iOS: MediaRecorder support depends on version.
  recStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // choose best mimeType if available
  let options = {};
  const prefs = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
  ];
  if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
    const chosen = prefs.find(t => MediaRecorder.isTypeSupported(t));
    if (chosen) options.mimeType = chosen;
  }

  mediaRecorder = new MediaRecorder(recStream, options);

  const chunks = [];
  mediaRecorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  mediaRecorder.onstop = () => {
    const mime = mediaRecorder.mimeType || "audio/webm";
    const blob = new Blob(chunks, { type: mime });
    const ext = mime.includes("mp4") ? "m4a" : (mime.includes("webm") ? "webm" : "audio");
    setAudioFromBlob(blob, "recording." + ext);

    // stop tracks
    try { recStream.getTracks().forEach(t => t.stop()); } catch(_){}
    recStream = null;
    mediaRecorder = null;

    stopTimer();
    el.btnRecordToggle.classList.remove("active");
    el.recLabel.textContent = "Aufnahme starten";
  };

  mediaRecorder.start();
  recStartMs = Date.now();
  setTimerText(0);
  stopTimer();
  recTimerInt = setInterval(() => setTimerText(Date.now() - recStartMs), 250);

  el.btnRecordToggle.classList.add("active");
  el.recLabel.textContent = "Aufnahme läuft ... Tippen zum Stop";
}

function stopRecording(){
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

async function toggleRecording(){
  try{
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      alert("Audio-Aufnahme wird in diesem Safari/iOS nicht unterstützt. Bitte eine Sprachnotiz auswählen.");
      return;
    }

    if (!mediaRecorder) {
      await startRecording();
    } else {
      stopRecording();
    }
  }catch(e){
    // cleanup on error
    try { if (recStream) recStream.getTracks().forEach(t => t.stop()); } catch(_){}
    recStream = null;
    mediaRecorder = null;
    stopTimer();
    el.btnRecordToggle.classList.remove("active");
    el.recLabel.textContent = "Aufnahme starten";
    alert("Audio-Aufnahme nicht möglich: " + (e.message || String(e)));
  }
}

function wireFileUpload(){
  el.fileAudio.addEventListener("change", () => {
    const f = el.fileAudio.files && el.fileAudio.files[0];
    if (!f) return;
    // Keep the File as blob
    setAudioFromBlob(f, f.name || "upload.m4a");
  });
}

async function transcribe(){
  try{
    if (!ensureApi()) return;
    if (!currentAudioBlob) return;

    setBusy(true, "Transkribiere Audio ...");

    const fd = new FormData();
    // Worker expects field name "audio"
    fd.append("audio", currentAudioBlob, currentAudioFilename || "audio.m4a");

    const resp = await fetch(apiUrl("/api/transcribe"), { method: "POST", body: fd });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || "Transkription fehlgeschlagen");

    const transcript = (data.transcript || data.text || "").trim();
    if (!transcript) throw new Error("Transkription war leer.");

    // Put transcript at top of notes, user can edit
    const current = el.notes.value || "";
    el.notes.value = transcript + (current ? "\n\n" + current : "");
    alert("Transkript wurde in 'Notizen' eingefügt.");
  }catch(e){
    alert(e.message || String(e));
  }finally{
    setBusy(false);
  }
}

// ---- Close button ----
function closeApp(){
  // Best-effort for iOS standalone: window.close often blocked.
  try{
    window.close();
  }catch(_){}

  // If still open, go back or blank
  setTimeout(() => {
    try{
      if (history.length > 1) history.back();
      else location.href = "about:blank";
    }catch(_){}
  }, 50);
}

// ---- Init ----
function init(){
  // load stored API
  const stored = normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
  if (stored) el.apiBase.value = stored;

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
  el.btnPDF.addEventListener("click", createPdf);

  el.btnRecordToggle.addEventListener("click", toggleRecording);
  el.btnClearAudio.addEventListener("click", clearAudio);
  el.btnTranscribe.addEventListener("click", transcribe);
  wireFileUpload();

  el.btnClose.addEventListener("click", closeApp);

  // Disable close button on desktop if wanted? Keep visible per request.
}

document.addEventListener("DOMContentLoaded", init);
