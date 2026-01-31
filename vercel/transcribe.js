// Hinweis: Vercel File Upload Parsing ist je nach Runtime unterschiedlich.
// Empfehlung: für Transkription Cloudflare Worker verwenden (FormData wird direkt unterstützt).
export default function handler(req, res) {
  return res.status(501).json({ error: "Bitte Cloudflare Worker für /api/transcribe nutzen." });
}
