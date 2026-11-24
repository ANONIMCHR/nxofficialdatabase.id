import { db, requireSession, requireRole } from "./db.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = requireSession(req, res); if (!session) return;
  if (!requireRole(session, ["super_owner", "owner"], res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const r = await db.execute(`SELECT id,action,staff_username AS actor_username,staff_role AS actor_role,
      CASE
        WHEN COALESCE(target,'')='' THEN COALESCE(details,'')
        WHEN COALESCE(details,'')='' THEN target
        ELSE target || ' · ' || details
      END AS detail,created_at
      FROM activity_logs ORDER BY id DESC LIMIT 300`);
    return res.status(200).json({ data: r.rows });
  } catch (e) { console.error(e); return res.status(500).json({ error: "Gagal membaca audit log." }); }
}
