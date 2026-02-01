// pdf.js - Client-side PDF export (pdf-lib)
// Generates a clean, readable PDF from the text in the Ergebnis field.

(() => {
  if (!window.PDFLib) return;

  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

  const $ = (id) => document.getElementById(id);

  function wrapParagraph(paragraph, maxWidth, font, size) {
    const words = (paragraph || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? current + ' ' + word : word;
      const width = font.widthOfTextAtSize(candidate, size);
      if (width <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        // If a single word is too long, hard-split it
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            const c2 = chunk + ch;
            if (font.widthOfTextAtSize(c2, size) <= maxWidth) {
              chunk = c2;
            } else {
              if (chunk) lines.push(chunk);
              chunk = ch;
            }
          }
          if (chunk) {
            current = chunk;
          } else {
            current = '';
          }
        } else {
          current = word;
        }
      }
    }

    if (current) lines.push(current);
    if (lines.length === 0) lines.push('');
    return lines;
  }

  function wrapText(text, maxWidth, font, size) {
    const rawLines = (text || '').replace(/\r/g, '').split('\n');
    const wrapped = [];

    for (const line of rawLines) {
      // keep empty lines
      if (line.trim() === '') {
        wrapped.push('');
        continue;
      }

      // preserve simple bullet indentation
      const m = line.match(/^\s*(-|•)\s+(.*)$/);
      if (m) {
        const bullet = '- ';
        const content = m[2] || '';
        const bulletWidth = font.widthOfTextAtSize(bullet, size);
        const lines = wrapParagraph(content, maxWidth - bulletWidth, font, size);
        lines.forEach((l, idx) => {
          wrapped.push((idx === 0 ? bullet : '  ') + l);
        });
        continue;
      }

      // headings (Markdown **...**)
      const h = line.match(/^\*\*(.+?)\*\*$/);
      if (h) {
        wrapped.push(h[1].trim());
        continue;
      }

      wrapParagraph(line, maxWidth, font, size).forEach((l) => wrapped.push(l));
    }

    return wrapped;
  }

  function isoDateToGerman(iso) {
    // iso: YYYY-MM-DD
    const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return `${m[3]}.${m[2]}.${m[1]}`;
  }

  async function createPdf() {
    const result = ($('result')?.value || '').trim();
    if (!result) {
      alert('Kein Ergebnis-Text vorhanden.');
      return;
    }

    const dateIso = $('date')?.value || '';
    const time = $('time')?.value || '';
    const location = ($('location')?.value || '').trim();
    const title = ($('title')?.value || '').trim();

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const pageSize = { width: 595.28, height: 841.89 }; // A4
    const margin = 48;
    const lineH = 14;

    let page = doc.addPage([pageSize.width, pageSize.height]);
    let y = pageSize.height - margin;

    // Header bar
    const barH = 42;
    page.drawRectangle({
      x: 0,
      y: pageSize.height - barH,
      width: pageSize.width,
      height: barH,
      color: rgb(0.07, 0.09, 0.12),
    });

    const hdrTitle = 'Gesprächsprotokoll';
    page.drawText(hdrTitle, {
      x: margin,
      y: pageSize.height - 28,
      size: 18,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    const rightText = [
      isoDateToGerman(dateIso) || '',
      time ? `${time} Uhr` : '',
      location || '',
    ].filter(Boolean).join(' | ');

    if (rightText) {
      const w = font.widthOfTextAtSize(rightText, 10);
      page.drawText(rightText, {
        x: Math.max(margin, pageSize.width - margin - w),
        y: pageSize.height - 24,
        size: 10,
        font,
        color: rgb(0.85, 0.85, 0.85),
      });
    }

    y = pageSize.height - barH - 18;

    // Optional custom title
    if (title) {
      page.drawText(title, {
        x: margin,
        y,
        size: 13,
        font: fontBold,
        color: rgb(0.95, 0.78, 0.14),
      });
      y -= 18;
    }

    // Body
    const maxWidth = pageSize.width - margin * 2;
    const lines = wrapText(result, maxWidth, font, 11);

    const addNewPage = () => {
      page = doc.addPage([pageSize.width, pageSize.height]);
      y = pageSize.height - margin;
    };

    for (const line of lines) {
      if (y <= margin + lineH) addNewPage();

      const isHeading = line && line === line.toUpperCase() && line.length <= 40;
      const useBold = isHeading;

      page.drawText(line || ' ', {
        x: margin,
        y,
        size: 11,
        font: useBold ? fontBold : font,
        color: rgb(0.06, 0.06, 0.06),
      });

      y -= lineH;
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    // Download (works on iOS Safari; opens preview)
    const a = document.createElement('a');
    const fname = `Protokoll_${(isoDateToGerman(dateIso) || 'ohne_Datum').replace(/\./g, '-')}.pdf`;
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('btnPDF');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      createPdf().catch((err) => {
        console.error(err);
        alert('PDF konnte nicht erstellt werden.');
      });
    });
  });
})();
