// Probe: does a nested (non-bracket) function under api/lcd/ deploy?
export default function handler(req, res) {
  res.status(200).json({ ok: true, ping: true });
}
