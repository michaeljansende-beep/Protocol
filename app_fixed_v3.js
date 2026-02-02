// Protokoll Recorder - Frontend (stabil, iOS/Safari)
// - Fokus: Datei-Upload (Sprachmemo aus Kurzbefehlen) + Transkription + Protokoll-Generierung
// - Keine Browser-Audioaufnahme (zu instabil auf iOS/PWA)
// - Worker erwartet Multipart-Feldname: "file" (nicht "audio")

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // --- UI Elements (müssen zu deiner index.html passen) ---
  const el = {
    // API
    apiBase: $("apiBase"),
    btnSaveApi: $("btnSaveApi"),

    // Gesprächsdaten (index.html nutzt datetime-local + Ort + Titel + Teilnehmer)
    dateTime: $("dateTime"),
    location: $("location"),
    title: $("title"),
    participantsCustomer: $("participantsCustomer"),
    participantsInternal: $("participantsInternal"),

    // Audio/Upload
    btnRunShortcut: $("btnRunShortcut"),
    btnPickAudio: $("btnPickAudio"),
    fileAudio: $("fileAudio"),
    btnClearAudio: $("btnClearAudio"),
    player: $("player"),
    btnTranscribe: $("btnTranscribe"),

    // Notizen / Ergebnis
    notes: $("notes"),
    btnGenerate: $("btnGenerate"),
    btnReset: $("btnReset"),
    result: $("result"),
    btnCopy: $("btnCopy"),
    btnPDF: $("btnPDF"),
  };

  // --- Settings ---
  const STORAGE_KEY_API = "protocol_api_base";
  const DEFAULT_SHORTCUT_NAME = "Audio Für Protokoll App";

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
    return normalizeApiBase(localStorage.getItem(STORAGE_KEY_API) || "");
  }

  function setApiBase(v) {
    const base = normalizeApiBase(v);
    if (el.apiBase) el.apiBase.value = base;
    if (base) localStorage.setItem(STORAGE_KEY_API, base);
  }

  function apiUrl(path) {
    const base = getApiBase();
    if (!base) return "";
    if (!path.startsWith("/")) path = "/" + path;
    return base + path;
  }

  // --- Helpers ---
  function setResult(msg) {
    if (el.result) el.result.value = msg || "";
  }

  function setBusy(isBusy, msg) {
    if (el.btnTranscribe) el.btnTranscribe.disabled = isBusy || !hasAudioSelected();
    if (el.btnGenerate) el.btnGenerate.disabled = isBusy;
    if (el.btnReset) el.btnReset.disabled = isBusy;

    if (isBusy && msg) setResult(msg);
  }

  function hasAudioSelected() {
    return !!(el.fileAudio && el.fileAudio.files && el.fileAudio.files.length > 0);
  }

  function getSelectedAudioFile() {
    if (!hasAudioSelected()) return null;
    return el.fileAudio.files[0];
  }

  function normalizeList(text) {
    return (text || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^\-\s*/, "")); // führendes "- " entfernen
  }

  function deLinkify(text) {
    // Bricht automatische Link-Erkennung (Notizen/WhatsApp/Mail/Word),
    // ohne sichtbare Zeichen einzufügen.
    const ZWSP = "\u200B";
    return String(text ?? "")
      .replace(/https?:\/\//gi, (m) => m.replace("://", `:${ZWSP}//`))
      .replace(/\bwww\./gi, `ww${ZWSP}w.`)
      .replace(/@/g, `@${ZWSP}`)
      .replace(/\./g, `.${ZWSP}`);
  }


  function buildMetaText() {
    const dt = (el.dateTime?.value || "").trim();
    const loc = (el.location?.value || "").trim();
    const title = (el.title?.value || "").trim();

    const cust = normalizeList(el.participantsCustomer?.value);
    const intl = normalizeList(el.participantsInternal?.value);

    let out = "";
    if (dt) out += `Datum/Uhrzeit: ${dt}\n`;
    if (loc) out += `Ort: ${loc}\n`;
    if (title) out += `Titel (optional): ${title}\n`;

    if (cust.length) out += `Teilnehmer Kunde:\n- ${cust.join("\n- ")}\n`;
    if (intl.length) out += `Teilnehmer Sika / PCI / SCHÖNOX:\n- ${intl.join("\n- ")}\n`;

    return out.trim();
  }

  async function safeJson(resp) {
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) return await resp.json();
    const t = await resp.text();
    return { error: t || "Unbekannte Antwort (kein JSON)" };
  }

  // --- Actions ---
  async function transcribeSelectedFile() {
    try {
      const base = getApiBase();
      if (!base) {
        alert("Bitte unten die API-URL eintragen und auf „Speichern“ drücken.");
        return;
      }

      const file = getSelectedAudioFile();
      if (!file) {
        alert("Bitte zuerst eine Audiodatei auswählen.");
        return;
      }

      setBusy(true, "Transkribiere Audio ...");

      const fd = new FormData();
      // ⚠️ WICHTIG: Worker erwartet das Feld "file"
      fd.append("file", file, file.name || "audio.m4a");

      // Dein Worker unterstützt /api/transcribe (falls du das Routing so nutzt).
      // Falls du stattdessen direkt die Worker-Root-URL postest, funktioniert das auch nicht.
      // Deshalb: Wir versuchen zuerst /api/transcribe, und falls 404 kommt, posten wir auf die Root.
      let resp = await fetch(apiUrl("/api/transcribe"), { method: "POST", body: fd });
      if (resp.status === 404) {
        resp = await fetch(getApiBase(), { method: "POST", body: fd });
      }

      const data = await safeJson(resp);
      if (!resp.ok) {
        throw new Error(data.error || "Transkription fehlgeschlagen");
      }

      const transcript = (data.transcript || data.text || "").trim();
      if (!transcript) throw new Error("Transkription war leer.");

      el.notes.value = transcript;
      setResult("Transkription abgeschlossen.");
    } catch (e) {
      console.error(e);
      alert(e.message || String(e));
      setResult("");
    } finally {
      setBusy(false);
    }
  }

  async function createProtocol() {
    try {
      const base = getApiBase();
      if (!base) {
        alert("Bitte unten die API-URL eintragen und auf „Speichern“ drücken.");
        return;
      }

      const notes = (el.notes?.value || "").trim();
      if (!notes) {
        alert("Bitte Notizen eintragen (oder zuerst transkribieren).");
        return;
      }

      setBusy(true, "Erstelle Protokoll ...");

      const payload = { notes, meta: buildMetaText() };

      let resp = await fetch(apiUrl("/api/createProtocol"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (resp.status === 404) {
        resp = await fetch(getApiBase(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const data = await safeJson(resp);
      if (!resp.ok) throw new Error(data.error || "Protokoll-Erstellung fehlgeschlagen");

      const text = (data.protocol || data.protocolText || data.text || "").trim();
      if (!text) throw new Error("Antwort war leer.");

      el.result.value = text;
      if (el.btnCopy) el.btnCopy.disabled = !text;
      if (el.btnPDF) el.btnPDF.disabled = !text;
    } catch (e) {
      console.error(e);
      alert(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyResult() {
    const raw = (el.result?.value || "").trim();
    if (!raw) return;

    // Falls versehentlich URL-encodierter Text im Feld steht (z.B. %0A, %20, %C3%A4),
    // dekodieren wir ihn vor dem Kopieren.
    let text = raw;
    try {
      if (/%[0-9A-Fa-f]{2}/.test(raw) && !/\s/.test(raw)) {
        // decodeURIComponent wirft bei ungültigen Sequenzen - daher try/catch
        text = decodeURIComponent(raw);
      }
    } catch (_) {
      text = raw;
    }

    // Link-Erkennung in Notizen/WhatsApp/Mail/Word möglichst verhindern (unsichtbare Trennzeichen)
    text = deLinkify(text);

    // 1) Modern Clipboard API: nur text/plain
    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" })
          })
        ]);
        alert("In Zwischenablage kopiert.");
        return;
      }
    } catch (_) {}

    // 2) Fallback (iOS oft stabiler im Button-Tap)
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.left = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (!ok) throw new Error("copy failed");
      alert("In Zwischenablage kopiert.");
    } catch (e) {
      alert("Kopieren nicht möglich: " + (e.message || String(e)));
    }
  }
  }

  function clearAudio() {
    if (el.fileAudio) el.fileAudio.value = "";
    if (el.player) {
      el.player.removeAttribute("src");
      el.player.load();
    }
    if (el.btnClearAudio) el.btnClearAudio.disabled = true;
    if (el.btnTranscribe) el.btnTranscribe.disabled = true;
  }

  function onFileChosen() {
    const f = getSelectedAudioFile();
    if (!f) {
      clearAudio();
      return;
    }

    if (el.player) {
      const url = URL.createObjectURL(f);
      el.player.src = url;
    }

    if (el.btnClearAudio) el.btnClearAudio.disabled = false;
    if (el.btnTranscribe) el.btnTranscribe.disabled = false;
  }

  function resetFields() {
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

  function runShortcut() {
    window.location.href =
      "shortcuts://run-shortcut?name=" + encodeURIComponent(DEFAULT_SHORTCUT_NAME);
  }

  function init() {
    // API URL laden
    const stored = normalizeApiBase(localStorage.getItem(STORAGE_KEY_API) || "");
    if (stored && el.apiBase) el.apiBase.value = stored;

    el.btnSaveApi?.addEventListener("click", () => {
      const norm = normalizeApiBase(el.apiBase?.value || "");
      if (!norm) {
        alert("Bitte eine gültige API-URL eingeben.");
        return;
      }
      setApiBase(norm);
      alert("API-URL gespeichert.");
    });

    // Audio: Shortcut Button rot (nur UI)
    if (el.btnRunShortcut) {
      el.btnRunShortcut.style.background = "#b91c1c";
      el.btnRunShortcut.style.color = "#fff";
      el.btnRunShortcut.addEventListener("click", runShortcut);
    }

    el.btnPickAudio?.addEventListener("click", () => el.fileAudio?.click());
    el.fileAudio?.addEventListener("change", onFileChosen);
    el.btnClearAudio?.addEventListener("click", clearAudio);
    el.btnTranscribe?.addEventListener("click", transcribeSelectedFile);

    // Protocol
    el.btnGenerate?.addEventListener("click", createProtocol);
    el.btnReset?.addEventListener("click", resetFields);
    el.btnCopy?.addEventListener("click", copyResult);

    // Initial State
    if (el.btnTranscribe) el.btnTranscribe.disabled = !hasAudioSelected();
    if (el.btnClearAudio) el.btnClearAudio.disabled = !hasAudioSelected();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
