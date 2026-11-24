import { db, requireSession, requireRole, audit } from "./db.js";
export default async function handler(req, res) {
  const session = requireSession(req, res); if (!session) return;
  if (!requireRole(session, ["super_owner", "owner"], res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const muted = req.body?.action === "mute";
  if (!muted && req.body?.action !== "unmute") return res.status(400).json({ error: "Aksi tidak valid." });
  try {
    await db.batch([
      { sql: "UPDATE license_keys SET is_muted=?,muted_by=?,muted_by_role=? WHERE is_lifetime=1 OR julianday(expired_at)>julianday('now')", args: [muted ? 1 : 0, muted ? session.username : null, muted ? session.role : null] },
      { sql: "INSERT INTO activity_logs(staff_id,staff_username,staff_role,action,target,details) VALUES(?,?,?,?,?,?)", args: [session.id, session.username, session.role, muted ? "GLOBAL_MUTE" : "GLOBAL_UNMUTE", "ALL", "Global status update"] },
      { sql: "UPDATE system_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1", args: [] }
    ], "write");
    return res.status(200).json({ success: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: "Global update gagal." }); }
}
