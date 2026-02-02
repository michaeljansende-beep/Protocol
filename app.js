// ===============================
// Protokoll Recorder – app.js
// ===============================

const API_URL_INPUT = document.getElementById("apiUrl");
const SAVE_API_BTN = document.getElementById("saveApiUrl");

const FILE_INPUT = document.getElementById("audioFile");
const TRANSCRIBE_BTN = document.getElementById("transcribeBtn");

const NOTES_FIELD = document.getElementById("notes");
const RESULT_FIELD = document.getElementById("result");

let API_URL = localStorage.getItem("api_url") || "";

// -------------------------------
// Init
// -------------------------------
if (API_URL_INPUT) {
  API_URL_INPUT.value = API_URL;
}

if (SAVE_API_BTN) {
  SAVE_API_BTN.addEventListener("click", () => {
    API_URL = API_URL_INPUT.value.trim();
    localStorage.setItem("api_url", API_URL);
    alert("API-URL gespeichert");
  });
}

// -------------------------------
// Transkribieren (Datei / Kurz­befehl)
// -------------------------------
if (TRANSCRIBE_BTN) {
  TRANSCRIBE_BTN.addEventListener("click", async () => {
    if (!API_URL) {
      alert("API-URL fehlt");
      return;
    }

    if (!FILE_INPUT || FILE_INPUT.files.length === 0) {
      alert("Keine Audiodatei ausgewählt");
      return;
    }

    const file = FILE_INPUT.files[0];

    RESULT_FIELD.value = "Transkribiere Audio …";

    try {
      const fd = new FormData();

      // ⚠️ WICHTIG:
      // Worker erwartet explizit "file"
      fd.append("file", file, file.name);

      const res = await fetch(API_URL, {
        method: "POST",
        body: fd
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Serverfehler");
      }

      const data = await res.json();

      if (!data.text || !data.text.trim()) {
        throw new Error("Transkription war leer");
      }

      NOTES_FIELD.value = data.text;
      RESULT_FIELD.value = "Transkription abgeschlossen";

    } catch (err) {
      console.error(err);
      alert(err.message || "Fehler bei der Transkription");
      RESULT_FIELD.value = "";
    }
  });
}

// -------------------------------
// Audio löschen
// -------------------------------
const DELETE_BTN = document.getElementById("deleteAudio");
if (DELETE_BTN) {
  DELETE_BTN.addEventListener("click", () => {
    FILE_INPUT.value = "";
    RESULT_FIELD.value = "";
  });
}
