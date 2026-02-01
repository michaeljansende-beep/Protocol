// app.js – iOS Safari Recording Fix (stable)
// Fixes empty-audio issue on live recordings while keeping uploads working.
// No layout changes.

let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let audioBlob = null;
let isRecording = false;

let timerHandle = null;
let startedAt = 0;

const $ = (id) => document.getElementById(id);

function mmss(sec){
  sec = Math.max(0, Math.floor(sec));
  const m = String(Math.floor(sec/60)).padStart(2,"0");
  const s = String(sec%60).padStart(2,"0");
  return `${m}:${s}`;
}

function startTimer(){
  stopTimer();
  startedAt = Date.now();
  const t = $("recTimer");
  if (t) t.textContent = "00:00";
  timerHandle = setInterval(()=>{
    const sec = (Date.now()-startedAt)/1000;
    if (t) t.textContent = mmss(sec);
  }, 250);
}

function stopTimer(){
  if (timerHandle){ clearInterval(timerHandle); timerHandle = null; }
}

function setRecordUI(recording){
  const b = $("btnRecord");
  if (!b) return;
  b.style.background = "#b91c1c";
  b.style.color = "#fff";
  b.textContent = recording ? "Stop" : "Aufnahme starten";
}

async function startRecording(){
  if (isRecording) return;

  if (!navigator.mediaDevices?.getUserMedia){
    alert("Audio-Aufnahme wird nicht unterstützt. Bitte Datei hochladen.");
    return;
  }

  audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioChunks = [];
  audioBlob = null;

  try {
    mediaRecorder = new MediaRecorder(audioStream);
  } catch(e){
    audioStream.getTracks().forEach(t=>t.stop());
    audioStream = null;
    alert("Live-Aufnahme in diesem Safari nicht möglich. Bitte Audio-Datei hochladen.");
    return;
  }

  mediaRecorder.ondataavailable = (e)=>{
    if (e.data && e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = ()=>{
    try {
      if (audioChunks.length === 0){
        alert("Hinweis: iOS hat kein Audio geliefert. Bitte erneut aufnehmen.");
      } else {
        audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const p = $("player");
        if (p) p.src = URL.createObjectURL(audioBlob);
      }
    } finally {
      audioStream.getTracks().forEach(t=>t.stop());
      audioStream = null;
      isRecording = false;
      stopTimer();
      setRecordUI(false);
      const tr = $("btnTranscribe");
      if (tr) tr.disabled = !audioBlob;
    }
  };

  mediaRecorder.start();
  isRecording = true;
  setRecordUI(true);
  startTimer();
}

function stopRecording(){
  if (!isRecording) return;
  try {
    mediaRecorder.requestData();
    mediaRecorder.stop();
  } catch(e){
    audioStream?.getTracks().forEach(t=>t.stop());
    audioStream = null;
    isRecording = false;
    stopTimer();
    setRecordUI(false);
  }
}

async function transcribe(){
  const base = localStorage.getItem("protocol_api_base");
  if (!base){
    alert("Bitte API-URL setzen.");
    return;
  }

  const fd = new FormData();
  const fileInput = $("fileAudio");
  if (fileInput && fileInput.files && fileInput.files[0]){
    fd.append("audio", fileInput.files[0], fileInput.files[0].name);
  } else if (audioBlob){
    fd.append("audio", audioBlob, "recording.webm");
  } else {
    alert("Audio ist leer.");
    return;
  }

  const resp = await fetch(base.replace(/\/+$/,"") + "/api/transcribe", { method:"POST", body: fd });
  const data = await resp.json();
  if (!resp.ok){
    alert(data.error || "Transkription fehlgeschlagen");
    return;
  }
  const notes = $("notes");
  if (notes) notes.value = data.transcript || data.text || "";
}

document.addEventListener("DOMContentLoaded", ()=>{
  $("btnRecord")?.addEventListener("click", ()=> isRecording ? stopRecording() : startRecording());
  $("btnTranscribe")?.addEventListener("click", transcribe);
});
