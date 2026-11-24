import { db, requireSession } from "./db.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireSession(req, res)) return;
  try {
    const r = await db.execute("SELECT revision, updated_at FROM system_state WHERE id=1");
    return res.status(200).json({ revision: Number(r.rows[0]?.revision || 0), updatedAt: r.rows[0]?.updated_at || null });
  } catch (e) { console.error(e); return res.status(500).json({ error: "Status unavailable" }); }
}
