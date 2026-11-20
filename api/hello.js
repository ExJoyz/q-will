// Minimal probe: proves whether Vercel deploys functions from api/ at all.
// Delete after the probe if /api/hello answers.
export default function handler(req, res) {
  res.status(200).json({ ok: true });
}
