// PDF-Erzeugung mit pdf-lib
// Stil orientiert sich am Referenz-PDF: Datum oben, Titel, Teilnehmer-Blöcke, Abschnitte, Task-Board Tabelle.

(function(){
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib || {};
  if (!PDFDocument) {
    console.warn("pdf-lib not loaded yet.");
  }

  const COLORS = {
    black: rgb(0,0,0),
    greyText: rgb(0.25,0.28,0.32),
    lightGrey: rgb(0.93,0.94,0.95),
    line: rgb(0.82,0.84,0.86),
  };

  function wrapText(text, font, size, maxWidth) {
    const words = (text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? (line + " " + w) : w;
      const width = font.widthOfTextAtSize(test, size);
      if (width <= maxWidth) {
        line = test;
      } else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function parseProtocol(protocolText){
    // Expected format from backend:
    // Title
    //
    // Teilnehmer Kunde:
    // - ...
    // Teilnehmer Sika / PCI / SCHÖNOX:
    // - ...
    //
    // Abschnitt
    // - bullet
    //
    // Task-Board
    // | Aufgabe | Verantwortlich | Status |
    // | --- | --- | --- |
    // | ... | ... | ... |
    const lines = (protocolText || "").split(/\r?\n/);
    const blocks = [];
    let i = 0;

    // Title = first non-empty line
    while (i < lines.length && !lines[i].trim()) i++;
    const title = (i < lines.length) ? lines[i].trim() : "";
    i++;

    // Collect remaining into sections by headings and special taskboard
    let current = null;

    function pushCurrent(){
      if (current) blocks.push(current);
      current = null;
    }

    for (; i < lines.length; i++) {
      const raw = lines[i];
      const t = raw.trim();
      if (!t) continue;

      if (/^Task-Board\b/i.test(t)) {
        pushCurrent();
        // parse markdown table starting next lines
        const tableLines = [];
        for (let j = i+1; j < lines.length; j++) {
          const tt = lines[j].trim();
          if (!tt) continue;
          if (!tt.startsWith("|")) break;
          tableLines.push(tt);
          i = j;
        }
        const rows = [];
        if (tableLines.length >= 2) {
          // header = tableLines[0], sep = tableLines[1]
          for (let k = 2; k < tableLines.length; k++) {
            const cols = tableLines[k].split("|").map(x=>x.trim()).filter(Boolean);
            if (cols.length >= 3) rows.push(cols.slice(0,3));
          }
        }
        blocks.push({ type:"taskboard", rows });
        continue;
      }

      // headings: end with ":" OR no bullet prefix and short-ish
      const isHeading = (!t.startsWith("-") && !t.startsWith("•") && !t.startsWith("|"));
      if (isHeading) {
        pushCurrent();
        current = { type:"section", heading: t, bullets: [] };
        continue;
      }

      // bullets
      const bullet = t.replace(/^[-•\u2022]\s*/, "- ");
      if (!current) current = { type:"section", heading:"", bullets: [] };
      current.bullets.push(bullet);
    }
    pushCurrent();
    return { title, blocks };
  }

  async function makePDF({ meta, protocolText }) {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageSize = { width: 595.28, height: 841.89 }; // A4 portrait in points
    let page = pdfDoc.addPage([pageSize.width, pageSize.height]);

    const margin = 48;
    const contentWidth = pageSize.width - margin*2;

    let y = pageSize.height - margin;

    function ensureSpace(needed){
      if (y - needed < margin) {
        page = pdfDoc.addPage([pageSize.width, pageSize.height]);
        y = pageSize.height - margin;
      }
    }

    function drawLine(){
      page.drawLine({
        start: { x: margin, y: y },
        end: { x: margin + contentWidth, y: y },
        thickness: 1,
        color: COLORS.line
      });
    }

    function drawText(text, size=11, bold=false, color=COLORS.black, x=margin){
      const f = bold ? fontBold : font;
      page.drawText(text, { x, y, size, font: f, color });
      y -= (size + 6);
    }

    function drawWrapped(text, size=11, bold=false, indent=0){
      const f = bold ? fontBold : font;
      const maxW = contentWidth - indent;
      const lines = wrapText(text, f, size, maxW);
      for (const ln of lines) {
        ensureSpace(size + 10);
        page.drawText(ln, { x: margin + indent, y, size, font: f, color: COLORS.black });
        y -= (size + 5);
      }
    }

    function drawSectionHeading(text){
      ensureSpace(26);
      page.drawText(text, { x: margin, y, size: 12, font: fontBold, color: COLORS.black });
      y -= 18;
    }

    function drawBullets(bullets){
      for (const b of bullets) {
        // "- " already; indent after dash
        drawWrapped(b, 11, false, 0);
      }
      y -= 4;
    }

    function drawParticipants(label, people){
      ensureSpace(18);
      drawText(label, 11, true, COLORS.black);
      if (!people || !people.length) {
        drawText("- Unklar", 11, false, COLORS.black);
        return;
      }
      for (const p of people) {
        drawText("- " + p, 11, false, COLORS.black);
      }
    }

    // Header: Date line
    const dateLine = (meta?.date || "").trim();
    if (dateLine) {
      drawText(dateLine, 11, false, COLORS.black);
      y -= 4;
      drawLine();
      y -= 14;
    }

    // Title: either meta.title or parsed title
    const parsed = parseProtocol(protocolText);
    const title = (meta?.title || "").trim() || parsed.title || "Gesprächsprotokoll";
    drawText(title, 14, true, COLORS.black);
    y -= 6;

    // Location/time (small line)
    const pieces = [];
    if ((meta?.location || "").trim()) pieces.push(meta.location.trim());
    if ((meta?.time || "").trim()) pieces.push(meta.time.trim());
    if (pieces.length) {
      drawText(pieces.join(" - "), 10, false, COLORS.greyText);
      y -= 6;
    }

    // Participants
    drawParticipants("Teilnehmer Kunde:", meta?.participantsCustomer || []);
    y -= 4;
    drawParticipants("Teilnehmer Sika / PCI / SCHÖNOX:", meta?.participantsInternal || []);
    y -= 10;

    // Content blocks
    for (const b of parsed.blocks) {
      if (b.type === "taskboard") {
        // Task-Board table
        drawSectionHeading("Task-Board");
        ensureSpace(140);

        const col1 = contentWidth * 0.60;
        const col2 = contentWidth * 0.25;
        const col3 = contentWidth * 0.15;
        const rowHMin = 18;

        const headers = ["Aufgabe", "Verantwortlich", "Status"];
        const x1 = margin, x2 = margin + col1, x3 = margin + col1 + col2;

        // header background
        const headerYTop = y + 6;
        page.drawRectangle({ x: margin, y: headerYTop - 16, width: contentWidth, height: 18, color: COLORS.lightGrey, borderColor: COLORS.line, borderWidth: 1 });
        page.drawText(headers[0], { x: x1 + 4, y: headerYTop - 13, size: 10, font: fontBold, color: COLORS.black });
        page.drawText(headers[1], { x: x2 + 4, y: headerYTop - 13, size: 10, font: fontBold, color: COLORS.black });
        page.drawText(headers[2], { x: x3 + 4, y: headerYTop - 13, size: 10, font: fontBold, color: COLORS.black });
        y -= 22;

        const rows = (b.rows || []);
        if (!rows.length) {
          drawText("- Keine Aufgaben erfasst", 11, false, COLORS.black);
          y -= 6;
        } else {
          for (const r of rows) {
            const c1 = r[0] || "";
            const c2 = r[1] || "";
            const c3 = r[2] || "";

            const w1 = wrapText(c1, font, 10, col1 - 10);
            const w2 = wrapText(c2, font, 10, col2 - 10);
            const w3 = wrapText(c3, font, 10, col3 - 10);
            const maxLines = Math.max(w1.length, w2.length, w3.length, 1);
            const rowH = Math.max(rowHMin, 12 + maxLines * 12);

            ensureSpace(rowH + 10);

            // row rect + vertical separators
            page.drawRectangle({ x: margin, y: y - rowH + 6, width: contentWidth, height: rowH, borderColor: COLORS.line, borderWidth: 1, color: rgb(1,1,1) });
            page.drawLine({ start: {x:x2, y:y - rowH + 6}, end:{x:x2, y:y + 6}, thickness:1, color:COLORS.line });
            page.drawLine({ start: {x:x3, y:y - rowH + 6}, end:{x:x3, y:y + 6}, thickness:1, color:COLORS.line });

            // draw cell text
            for (let li=0; li<maxLines; li++){
              const yy = y - 10 - li*12;
              if (w1[li]) page.drawText(w1[li], { x: x1 + 4, y: yy, size: 10, font, color: COLORS.black });
              if (w2[li]) page.drawText(w2[li], { x: x2 + 4, y: yy, size: 10, font, color: COLORS.black });
              if (w3[li]) page.drawText(w3[li], { x: x3 + 4, y: yy, size: 10, font, color: COLORS.black });
            }

            y -= (rowH + 4);
          }
        }
        y -= 6;
        continue;
      }

      // normal section
      if (b.heading) drawSectionHeading(b.heading);
      if (b.bullets && b.bullets.length) drawBullets(b.bullets);
    }

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    const safeTitle = (title || "Protokoll").replace(/[^a-z0-9\-_ ]/gi, "").trim().replace(/\s+/g, "_");
    a.href = url;
    a.download = `${safeTitle}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
  }

  window.makeProtocolPDF = makePDF;
})();
