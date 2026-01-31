// API läuft z.B. auf Cloudflare Worker: https://xxx.workers.dev
// Endpoints:
//  - POST /api/createProtocol   (JSON: { meta, notes })
//  - POST /api/transcribe       (multipart/form-data: audio)
//  - GET  /ping                 (optional)

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
  // path muss mit "/" starten
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

  if (isBusy) {
    if (el.result) el.result.value = (msg || "Bitte warten ...");
  }
}

async function safeJson(resp) {
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await resp.json();
  // falls Worker HTML/Text liefert:
  const t = await resp.text();
  return { error: t || "Unbekannte Antwort (kein JSON)" };
}

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

    if (!resp.ok) {
      throw new Error(data.error || "Erstellung fehlgeschlagen");
    }

    // Worker kann z.B. { protocolText: "..." } oder { text: "..." } liefern
    const text = (data.protocolText || data.text || "").trim();
    if (!text) {
      throw new Error("Antwort war leer (kein protocolText/text).");
    }

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

// --- Audio (optional) ---
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    audioBlob = null;

    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) audioChunks.push(ev.data);
    };
    mediaRecorder.onstop = () => {
      audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      el.player.src = URL.createObjectURL(audioBlob);
      el.btnTranscribe.disabled = false;
      el.btnClearAudio.disabled = false;
      el.btnStop.disabled = true;
      el.btnRecord.disabled = false;

      // tracks stoppen
      stream.getTracks().forEach((t) => t.stop());
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
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
}

function clearAudio() {
  audioChunks = [];
  audioBlob = null;
  el.player.removeAttribute("src");
  el.player.load();
  el.btnTranscribe.disabled = true;
  el.btnClearAudio.disabled = true;
}

async function transcribe() {
  try {
    const base = getApiBase();
    if (!base) {
      alert("Bitte oben eine API-URL eintragen und speichern.");
      return;
    }
    if (!audioBlob) return;

    setBusy(true, "Transkribiere Audio ...");

    const fd = new FormData();
    fd.append("audio", audioBlob, "recording.webm");

    const resp = await fetch(apiUrl("/api/transcribe"), { method: "POST", body: fd });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || "Transkription fehlgeschlagen");

    const transcript = (data.transcript || data.text || "").trim();
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

// --- Init ---
function init() {
  // gespeicherte API URL reinladen
  const stored = normalizeApiBase(localStorage.getItem("protocol_api_base") || "");
  if (stored) el.apiBase.value = stored;

  el.btnSaveApi.addEventListener("click", () => {
    const v = el.apiBase.value;
    const norm = normalizeApiBase(v);
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

  el.btnRecord.addEventListener("click", startRecording);
  el.btnStop.addEventListener("click", stopRecording);
  el.btnClearAudio.addEventListener("click", clearAudio);
  el.btnTranscribe.addEventListener("click", transcribe);

  // PDF Button bleibt wie gehabt (pdf.js kümmert sich darum)
  // Wenn pdf.js eine Funktion erwartet, bleibt das kompatibel.
}

document.addEventListener("DOMContentLoaded", init);
