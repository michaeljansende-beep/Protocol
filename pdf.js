// pdf.js (stub) - keeps compatibility if you already have a working pdf.js.
// If you have your own PDF generator, you can replace this file.
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btnPDF");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    // If a real generator is available (window.generateProtocolPDF), use it.
    if (typeof window.generateProtocolPDF === "function") {
      return window.generateProtocolPDF();
    }
    alert("PDF-Erstellung ist in dieser Version als Stub enthalten. Bitte deine funktionierende pdf.js aus Version 2 hierher kopieren.");
  });
});
