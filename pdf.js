/* pdf.js – Protokoll Recorder
   Voraussetzungen:
   - pdf-lib ist in index.html eingebunden:
     <script defer src="https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>
   - Diese Datei ist danach eingebunden:
     <script defer src="pdf.js"></script>

   Funktion:
   - aktiviert den Button #btnPDF sobald #result Text enthält
   - erzeugt eine einfache, saubere PDF aus meta + resultText
*/

(function () {
  const $ = (id) => document.getElementById(id);

  const el = {
    btnPDF: $("btnPDF"),
    result: $("result"),
    date: $("date"),
    time: $("time"),
    location: $("location"),
    title: $("title"),
    participantsCustomer: $("participantsCustomer"),
    participantsInternal: $("participantsInternal"),
  };

  function normalizeList(text) {
    return (text || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^\-\s*/, ""));
  }

  function safeMeta() {
    return {
      date: el.date?.value || "",
      time: el.time?.value || "",
      location: (el.location?.value || "").trim(),
      title: (el.title?.value || "").trim(),
      participantsCustomer: normalizeList(el.participantsCustomer?.value),
      participantsInternal: normalizeList(el.participantsInternal?.value),
    };
  }

  function enablePdfButtonIfPossible() {
    if (!el.btnPDF || !el.result) return;
    const hasText = (el.result.value || "").trim().length > 0;
    el.btnPDF.disabled = !hasText;
  }

  // Öffnet PDF in neuem Tab (iOS: von dort teilen/speichern)
  function openPdfBlob(blob) {
    const url = URL.createObjectURL(blob);
    // iOS Safari: neuer Tab ist am zuverlässigsten
    window.open(url, "_blank");
    // URL später freigeben
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // Zeilenumbruch-Handling
  function splitLines(text) {
    return (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  }

  async function generatePdf() {
    try {
      if (!el.result) {
        alert("Ergebnisfeld fehlt.");
        return;
      }
      const text = (el.result.value || "").trim();
      if (!text) {
        alert("Kein Ergebnis vorhanden.");
        return;
      }

      if (typeof PDFLib === "undefined" || !PDFLib.PDFDocument) {
        alert("pdf-lib ist nicht geladen. Bitte Seite neu laden.");
        return;
      }

      const meta = safeMeta();

      const { PDFDocument, StandardFonts, rgb } = PDFLib;
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595.28, 841.89]); // A4 in points
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const margin = 40;
      let y = 841.89 - margin;

      function drawText(line, size = 11, bold = false) {
        const f = bold ? fontBold : font;
        page.drawText(line, { x: margin, y, size, font: f, color: rgb(0, 0, 0) });
        y -= size + 4;
      }

      function drawDivider() {
        y -= 6;
        page.drawLine({
          start: { x: margin, y },
          end: { x: 595.28 - margin, y },
          thickness: 1,
          color: rgb(0.8, 0.8, 0.8),
        });
        y -= 10;
      }

      // Kopf
      const headerTitle = meta.title ? meta.title : "Gesprächsprotokoll";
      drawText(headerTitle, 16, true);

      const dt = [meta.date, meta.time].filter(Boolean).join(" ");
      const loc = meta.location ? `Ort: ${meta.location}` : "";
      const line2 = [dt, loc].filter(Boolean).join(" | ");
      if (line2) drawText(line2, 11, false);

      drawDivider();

      // Teilnehmer
      const cust = meta.participantsCustomer?.length
        ? `Teilnehmer Kunde: ${meta.participantsCustomer.join(", ")}`
        : "Teilnehmer Kunde: -";
      const internal = meta.participantsInternal?.length
        ? `Teilnehmer Sika / PCI / SCHÖNOX: ${meta.participantsInternal.join(", ")}`
        : "Teilnehmer Sika / PCI / SCHÖNOX: -";

      drawText(cust, 11, true);
      drawText(internal, 11, true);

      drawDivider();

      // Inhalt (Ergebnis)
      drawText("Zusammenfassung", 13, true);
      y -= 4;

      const lines = splitLines(text);

      // Word-wrap grob (pdf-lib hat kein automatisches wrap)
      const maxWidth = 595.28 - margin * 2;
      const size = 11;

      function wrapLine(line) {
        // sehr einfache Worttrennung nach Leerzeichen
        const words = (line || "").split(" ");
        const out = [];
        let current = "";

        for (const w of words) {
          const test = current ? current + " " + w : w;
          const width = font.widthOfTextAtSize(test, size);
          if (width <= maxWidth) {
            current = test;
          } else {
            if (current) out.push(current);
            current = w;
          }
        }
        if (current) out.push(current);
        if (out.length === 0) out.push("");
        return out;
      }

      for (const line of lines) {
        // Seitenumbruch
        if (y < margin + 60) {
          // neue Seite
          const newPage = pdfDoc.addPage([595.28, 841.89]);
          // neue Seite braucht eigene draw-Funktionen
          // wir “wechseln” simpel: ab hier zeichnen wir auf newPage
          // (kleiner Trick: überschreiben page-Referenz)
          // eslint-disable-next-line no-global-assign
          y = 841.89 - margin;

          // copy refs
          // page variable is const, daher nutzen wir ein kleines Hackchen:
          // Wir zeichnen ab jetzt auf newPage über eine Closure:
          const drawOn = newPage;

          const oldDrawText = drawText;
          drawText = function (l, s = 11, b = false) {
            const f = b ? fontBold : font;
            drawOn.drawText(l, { x: margin, y, size: s, font: f, color: rgb(0, 0, 0) });
            y -= s + 4;
          };
        }

        const wrapped = wrapLine(line);
        for (const wline of wrapped) {
          // Bullet optisch etwas einrücken wenn Zeile mit "-" beginnt
          const isBullet = wline.trim().startsWith("-");
          const x = isBullet ? margin + 10 : margin;
          page.drawText(wline, { x, y, size, font, color: rgb(0, 0, 0) });
          y -= size + 4;
        }
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      openPdfBlob(blob);
    } catch (e) {
      alert("PDF Fehler: " + (e && e.message ? e.message : String(e)));
    }
  }

  function bind() {
    if (!el.btnPDF || !el.result) return;

    // Button aktivieren/deaktivieren je nach Ergebnis
    enablePdfButtonIfPossible();
    el.result.addEventListener("input", enablePdfButtonIfPossible);

    // Klick-Handler
    el.btnPDF.addEventListener("click", generatePdf);
  }

  // warten bis DOM + pdf-lib da sind
  document.addEventListener("DOMContentLoaded", bind);
})();
