// Protokoll Recorder - Frontend
// Läuft auf GitHub Pages (nur statische Dateien). Die API muss separat deployed werden (Cloudflare Worker/Vercel).
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

function normalizeList(text) {
  // Accepts lines with/without "-" and returns clean "- Name" lines.
  const lines = (text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines.map(l => l.replace(/^[-•\u2022]\s*/, "").trim()).filter(Boolean);
}

function getApiBase() {
  const v = (localStorage.getItem("apiBase") || "").trim();
  return v.replace(/\/$/, "");
}

function setApiBase(v) {
  localStorage.setItem("apiBase", (v || "").trim().replace(/\/$/, ""));
}

function apiUrl(path) {
  const base = getApiBase();
  if (!base) throw new Error("Bitte API-URL oben eintragen und speichern.");
  return base + path;
}

async function safeJson(resp) {
  const txt = await resp.text();
  try { return JSON.parse(txt); } catch { return { error: txt || "Unbekannter Fehler" }; }
}

function setBusy(on, msg) {
  if (on) {
    el.result.value = msg || "Bitte warten ...";
  }
  el.btnGenerate.disabled = on;
  el.btnTranscribe.disabled = on || !audioBlob;
}

function initDefaults() {
  // Pre-fill date/time with local values
  const now = new Date();
  el.date.value = now.toISOString().slice(0,10);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  el.time.value = `${hh}:${mm}`;

  // API base from storage
  const stored = getApiBase();
  if (stored) el.apiBase.value = stored;
}

el.btnSaveApi.addEventListener("click", () => {
  setApiBase(el.apiBase.value);
  alert("API-URL gespeichert.");
});

el.btnReset.addEventListener("click", () => {
  el.location.value = "";
  el.title.value = "";
  el.participantsCustomer.value = "";
  el.participantsInternal.value = "";
  el.notes.value = "";
  el.result.value = "";
  el.btnCopy.disabled = true;
  el.btnPDF.disabled = true;
});

el.btnRecord.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    audioBlob = null;

    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      el.player.src = URL.createObjectURL(audioBlob);
      el.btnTranscribe.disabled = false;
      el.btnClearAudio.disabled = false;
    };

    mediaRecorder.start();
    el.btnRecord.disabled = true;
    el.btnStop.disabled = false;
  } catch (e) {
    alert("Aufnahme nicht möglich: " + e.message);
  }
});

el.btnStop.addEventListener("click", () => {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  el.btnRecord.disabled = false;
  el.btnStop.disabled = true;
});

el.btnClearAudio.addEventListener("click", () => {
  audioBlob = null;
  el.player.removeAttribute("src");
  el.player.load();
  el.btnTranscribe.disabled = true;
  el.btnClearAudio.disabled = true;
});

el.btnTranscribe.addEventListener("click", async () => {
  if (!audioBlob) return;
  try {
    setBusy(true, "Transkribiere Audio ...");

    const fd = new FormData();
    fd.append("audio", audioBlob, "recording.webm");

    const resp = await fetch(apiUrl("/api/transcribe"), { method: "POST", body: fd });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || "Transkription fehlgeschlagen");

    const transcript = (data.transcript || "").trim();
    if (transcript) {
      el.notes.value = transcript + "\n\n" + (el.notes.value || "");
    } else {
      alert("Transkription war leer.");
    }
  } catch (e) {
    alert(e.message);
  } finally {
    setBusy(false);
  }
});

el.btnGenerate.addEventListener("click", async () => {
  try {
    const notes = (el.notes.value || "").trim();
    if (!notes) {
      alert("Bitte Notizen eingeben (oder transkribieren).");
      return;
    }

    const payload = {
      meta: {
        date: el.date.value || "",
        time: el.time.value || "",
        location: (el.location.value || "").trim(),
        title: (el.title.value || "").trim(),
        participantsCustomer: normalizeList(el.participantsCustomer.value),
        participantsInternal: normalizeList(el.participantsInternal.value),
      },
      notes,
    };

    setBusy(true, "Erstelle Protokoll ...");

    const resp = await fetch(apiUrl("/api/createProtocol"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || "Erstellung fehlgeschlagen");

    el.result.value = (data.protocolText || "").trim();
    el.btnCopy.disabled = !el.result.value;
    el.btnPDF.disabled = !el.result.value;
  } catch (e) {
    alert(e.message);
  } finally {
    setBusy(false);
  }
});

el.btnCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(el.result.value || "");
    alert("In Zwischenablage kopiert.");
  } catch (e) {
    alert("Kopieren nicht möglich: " + e.message);
  }
});

el.btnPDF.addEventListener("click", async () => {
  try {
    const meta = {
      date: el.date.value || "",
      time: el.time.value || "",
      location: (el.location.value || "").trim(),
      title: (el.title.value || "").trim(),
      participantsCustomer: normalizeList(el.participantsCustomer.value),
      participantsInternal: normalizeList(el.participantsInternal.value),
    };
    await window.makeProtocolPDF({ meta, protocolText: el.result.value || "" });
  } catch (e) {
    alert("PDF Fehler: " + e.message);
  }
});

initDefaults();
