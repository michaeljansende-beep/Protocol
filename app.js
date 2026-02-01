// app.js - Fix: Aufnahme zuverlässig stoppen (iOS/Safari)
// HINWEIS: Keine Änderungen an Protokoll/PDF/API Logik – nur Recording Stop/Toggle stabilisiert.

let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let audioBlob = null;

let isRecording = false;
let timerHandle = null;
let startMs = 0;

const $ = (id) => document.getElementById(id);

function mmss(sec){
  sec = Math.max(0, Math.floor(sec));
  const m = String(Math.floor(sec/60)).padStart(2,"0");
  const s = String(sec%60).padStart(2,"0");
  return `${m}:${s}`;
}

function startTimer(){
  stopTimer();
  startMs = Date.now();
  const el = $("recTimer");
  if (el) el.textContent = "00:00";
  timerHandle = setInterval(()=>{
    const t = (Date.now()-startMs)/1000;
    if (el) el.textContent = mmss(t);
  }, 250);
}
function stopTimer(){
  if (timerHandle){ clearInterval(timerHandle); timerHandle = null; }
}

function setRecordButtonState(recording){
  const btn = $("btnRecord");
  if (!btn) return;
  // Rot bleiben / anzeigen
  btn.classList.add("rec");
  btn.style.background = recording ? "#b91c1c" : "#b91c1c";
  btn.style.color = "#fff";
  btn.textContent = recording ? "Stop" : "Aufnahme starten";
}

async function startRecording(){
  if (isRecording) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Audio-Aufnahme wird von diesem Browser nicht unterstützt.");
    return;
  }

  audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioChunks = [];
  audioBlob = null;

  try {
    mediaRecorder = new MediaRecorder(audioStream);
  } catch (e) {
    // Einige iOS/Safari-Versionen unterstützen MediaRecorder nicht sauber
    audioStream.getTracks().forEach(t=>t.stop());
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
      const player = $("player");
      if (player) player.src = URL.createObjectURL(audioBlob);
    } catch(_) {}

    // Stream sicher beenden
    try { audioStream?.getTracks().forEach(t=>t.stop()); } catch(_) {}
    audioStream = null;

    // Buttons
    const btnClear = $("btnClearAudio");
    const btnTrans = $("btnTranscribe");
    if (btnClear) btnClear.disabled = false;
    if (btnTrans) btnTrans.disabled = false;

    isRecording = false;
    stopTimer();
    setRecordButtonState(false);
  };

  mediaRecorder.start();
  isRecording = True = true

  isRecording = true;
  setRecordButtonState(true);
  startTimer();

  const btnClear = $("btnClearAudio");
  const btnTrans = $("btnTranscribe");
  if (btnClear) btnClear.disabled = false;
  if (btnTrans) btnTrans.disabled = true; // erst nach stop
}

function forceStopStream(){
  try { audioStream?.getTracks().forEach(t=>t.stop()); } catch(_) {}
  audioStream = null;
}

function stopRecording(){
  if (!isRecording) return;

  // 1) Recorder stoppen
  try {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      // Einige Safari-Versionen brauchen requestData() vor stop()
      try { mediaRecorder.requestData(); } catch(_) {}
      mediaRecorder.stop();
    }
  } catch (e) {
    // Falls stop() scheitert: Stream hart stoppen und UI zurücksetzen
    forceStopStream();
    isRecording = false;
    stopTimer();
    setRecordButtonState(false);
    alert("Stoppen der Aufnahme war nicht möglich. Bitte nochmal versuchen.");
    return;
  }

  // 2) Falls onstop nicht feuert (selten): Fallback nach 1s
  setTimeout(() => {
    if (isRecording) {
      forceStopStream();
      isRecording = false;
      stopTimer();
      setRecordButtonState(false);
    }
  }, 1000);
}

function toggleRecording(){
  if (isRecording) stopRecording();
  else startRecording();
}

function wireAudioButtons(){
  const btn = $("btnRecord");
  if (btn) btn.addEventListener("click", toggleRecording);

  // Wenn es einen separaten Stop-Button gibt, ebenfalls anbinden (kompatibel)
  const btnStop = $("btnStop");
  if (btnStop) btnStop.addEventListener("click", stopRecording);

  // Rot-Style sicherstellen
  setRecordButtonState(false);
}

document.addEventListener("DOMContentLoaded", wireAudioButtons);
