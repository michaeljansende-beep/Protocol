// Cloudflare Worker - OpenAI Proxy für Protokoll Recorder
// Endpoints:
//  POST /api/createProtocol   (JSON: {meta, notes})
//  POST /api/transcribe       (multipart/form-data: audio file field "audio")
//
// Secrets:
//  OPENAI_API_KEY

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    if (request.method === "OPTIONS") {
      return new Response("", {
        headers: corsHeaders(request),
      });
    }

    try {
      if (url.pathname === "/api/createProtocol" && request.method === "POST") {
        const body = await request.json();
        const out = await createProtocol(body, env);
        return json(out, 200, request);
      }

      if (url.pathname === "/api/transcribe" && request.method === "POST") {
        const out = await transcribe(request, env);
        return json(out, 200, request);
      }

      return json({ error: "Not found" }, 404, request);
    } catch (e) {
      return json({ error: "Serverfehler", details: String(e) }, 500, request);
    }
  }
};

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(obj, status, request) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
    }
  });
}

function normalizeLines(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(x => String(x || "").trim()).filter(Boolean);
}

async function createProtocol({ meta, notes }, env) {
  const m = meta || {};
  const participantsCustomer = normalizeLines(m.participantsCustomer);
  const participantsInternal = normalizeLines(m.participantsInternal);

  const system = [
    "Du erstellst ein Gesprächsprotokoll auf Deutsch.",
    "Regeln:",
    "- Keine Emojis, keine Sternchen.",
    "- Bulletpoints IM TEXT mit '- ' (kurzer Bindestrich).",
    "- Nichts erfinden oder ergänzen. Nur Inhalte aus Notizen/Transkript verwenden.",
    "- Wenn etwas unklar ist: weglassen oder als 'Unklar' markieren, ohne zu raten.",
    "- Struktur: Titel (1 Satz) in der ersten Zeile. Danach Leerzeile.",
    "- Danach genau diese Teilnehmerblöcke (auch wenn leer):",
    "  Teilnehmer Kunde:",
    "  - ...",
    "  Teilnehmer Sika / PCI / SCHÖNOX:",
    "  - ...",
    "- Danach Abschnitte mit Überschrift (eine Zeile) und darunter Bulletpoints.",
    "- To-Dos als eigener Abschnitt 'To-Do / Aufgaben' mit Bulletpoints.",
    "- Zusätzlich (wenn Aufgaben vorhanden): Abschnitt 'Task-Board' und darunter eine Markdown-Tabelle:",
    "  | Aufgabe | Verantwortlich | Status |",
    "  | --- | --- | --- |",
    "  | ... | ... | ... |",
    "- Keine weiteren Tabellen außer Task-Board.",
  ].join("\n");

  const user = [
    "Metadaten:",
    `Datum: ${m.date || "Unklar"}`,
    `Uhrzeit: ${m.time || "Unklar"}`,
    `Ort: ${m.location || "Unklar"}`,
    `Titel-Vorgabe (optional): ${m.title || ""}`,
    "",
    "Teilnehmer Kunde (Liste):",
    ...(participantsCustomer.length ? participantsCustomer.map(p=>`- ${p}`) : ["- Unklar"]),
    "",
    "Teilnehmer Sika / PCI / SCHÖNOX (Liste):",
    ...(participantsInternal.length ? participantsInternal.map(p=>`- ${p}`) : ["- Unklar"]),
    "",
    "Notizen/Transkript:",
    String(notes || "")
  ].join("\n");

  const payload = {
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.2
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await resp.json();
  if (!resp.ok) {
    return { error: "OpenAI Fehler", details: data };
  }

  // output_text is the easiest aggregation if available
  const protocolText = data.output_text || "";
  return { protocolText };
}

async function transcribe(request, env) {
  const ct = request.headers.get("Content-Type") || "";
  if (!ct.includes("multipart/form-data")) {
    throw new Error("Expected multipart/form-data");
  }

  const form = await request.formData();
  const file = form.get("audio");
  if (!file) throw new Error("Missing 'audio' file field");

  const fd = new FormData();
  fd.append("file", file, "recording.webm");
  fd.append("model", "whisper-1");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
    body: fd
  });

  const data = await resp.json();
  if (!resp.ok) return { error: "Whisper Fehler", details: data };
  return { transcript: data.text || "" };
}
