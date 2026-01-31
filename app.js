// ===============================
// Protokoll Recorder – app.js
// ===============================

// >>> HIER MUSS DEINE WORKER-URL STEHEN (OHNE /api)
// korrekt:
// https://muddy-resonance-b322.michael-jansen-de.workers.dev
//
const API_BASE = "https://muddy-resonance-b322.michael-jansen-de.workers.dev";

// -------------------------------
// Helfer
// -------------------------------
const $ = (id) => document.getElementById(id);

function normalizeList(text) {
  if (!text) return [];
  return text
    .split("\n")
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

function apiUrl(path) {
  return API_BASE.replace(/\/$/, "") + path;
}

// -------------------------------
// Elemente
// -------------------------------
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
};

// -------------------------------
// API-URL speichern / laden
// -------------------------------
function loadApiBase() {
  const saved = localStorage.getItem("apiBase");
  if (saved) {
    el.apiBase.value = saved;
  } else {
    el.apiBase.value = API_BASE;
  }
}

function saveApiBase() {
  const val = el.apiBase.value.trim();
  if (!val.startsWith("http")) {
    alert("Bitte eine gültige URL eingeben");
    return;
  }
  localStorage.setItem("apiBase", val);
  alert("API-URL gespeichert");
}

// -------------------------------
// Protokoll erzeugen
// -------------------------------
async function createProtocol() {
  el.result.value = "";

  const meta = {
    date: el.date.value || "",
    time: el.time.value || "",
    location: (el.location.value || "").trim(),
    title: (el.title.value || "").trim(),
    participantsCustomer: normalizeList(el.participantsCustomer.value),
    participantsInternal: normalizeList(el.participantsInternal.value),
  };

  const payload = {
    meta,
    notes: (el.notes.value || "").trim(),
  };

  try {
    const resp = await fetch(
      apiUrl("/api/createProtocol"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(t || resp.statusText);
    }

    const data = await resp.json();
    el.result.value = data.text || "";
  } catch (e) {
    alert("Load failed:\n" + e.message);
  }
}

// -------------------------------
// Zurücksetzen
// -------------------------------
function resetForm() {
  el.date.value = "";
  el.time.value = "";
  el.location.value = "";
  el.title.value = "";
  el.participantsCustomer.value = "";
  el.participantsInternal.value = "";
  el.notes.value = "";
  el.result.value = "";
}

// -------------------------------
// Events
// -------------------------------
document.addEventListener("DOMContentLoaded", () => {
  loadApiBase();

  el.btnSaveApi?.addEventListener("click", saveApiBase);
  el.btnGenerate?.addEventListener("click", createProtocol);
  el.btnReset?.addEventListener("click", resetForm);

  el.btnCopy?.addEventListener("click", () => {
    if (!el.result.value) return;
    el.result.select();
    document.execCommand("copy");
  });
});
