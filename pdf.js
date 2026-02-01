// pdf.js (minimal) - erzeugt eine einfache PDF aus dem Inhalt von #result
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btnPDF");
  const result = document.getElementById("result");
  if (!btn || !result) return;

  btn.addEventListener("click", async () => {
    try {
      const text = (result.value || "").trim();
      if (!text) return alert("Kein Text im Ergebnis.");

      const { PDFDocument, StandardFonts } = window.PDFLib;
      const pdfDoc = await PDFDocument.create();

      const pageSize = [595.28, 841.89]; // A4
      let page = pdfDoc.addPage(pageSize);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const margin = 50;
      const fontSize = 11;
      const lineHeight = 14;
      const maxWidth = page.getWidth() - margin * 2;

      const widthOf = (s) => font.widthOfTextAtSize(s, fontSize);

      const words = text.split(/\s+/);
      let lines = [];
      let line = "";

      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (widthOf(test) <= maxWidth) line = test;
        else { lines.push(line); line = w; }
      }
      if (line) lines.push(line);

      let y = page.getHeight() - margin;

      for (const ln of lines) {
        if (y < margin) {
          page = pdfDoc.addPage(pageSize);
          y = page.getHeight() - margin;
        }
        page.drawText(ln, { x: margin, y, size: fontSize, font });
        y -= lineHeight;
      }

      const bytes = await pdfDoc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "Protokoll.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert("PDF Fehler: " + (e.message || String(e)));
    }
  });
});
