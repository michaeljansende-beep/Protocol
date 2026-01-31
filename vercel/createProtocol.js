export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { meta, notes } = req.body || {};
    if (!notes || !String(notes).trim()) return res.status(400).json({ error: "Keine Notizen vorhanden." });

    const participantsCustomer = Array.isArray(meta?.participantsCustomer) ? meta.participantsCustomer : [];
    const participantsInternal = Array.isArray(meta?.participantsInternal) ? meta.participantsInternal : [];

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
      `Datum: ${meta?.date || "Unklar"}`,
      `Uhrzeit: ${meta?.time || "Unklar"}`,
      `Ort: ${meta?.location || "Unklar"}`,
      `Titel-Vorgabe (optional): ${meta?.title || ""}`,
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

    const rsp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.2
      })
    });

    const json = await rsp.json();
    if (!rsp.ok) return res.status(500).json({ error: "OpenAI Fehler", details: json });

    return res.status(200).json({ protocolText: json.output_text || "" });
  } catch (e) {
    return res.status(500).json({ error: "Serverfehler", details: String(e) });
  }
}
