import { db, requireSession, requireRole, audit, bcrypt } from "./db.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = requireSession(req, res); if (!session) return;
  if (!requireRole(session, ["super_owner", "owner"], res)) return;
  try {
    if (req.method === "GET") {
      const r = await db.execute("SELECT id,username,role FROM staff ORDER BY id DESC");
      return res.status(200).json({ data: r.rows });
    }
    if (req.method === "POST") {
      const { username, password, role } = req.body || {};
      const name = String(username || "").trim();
      if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(name) || typeof password !== "string" || password.length < 12) return res.status(400).json({ error: "Username 3–32 karakter; password minimal 12 karakter." });
      const allowed = session.role === "super_owner" ? ["owner", "reseller"] : ["reseller"];
      if (!allowed.includes(role)) return res.status(403).json({ error: "Role tersebut tidak boleh dibuat." });
      const hash = await bcrypt.hash(password, 12);
      await db.execute({ sql: "INSERT INTO staff(username,password,role) VALUES(?,?,?)", args: [name, hash, role] });
      await audit(session, "ADD_STAFF", name, role);
      return res.status(201).json({ success: true });
    }
    if (req.method === "DELETE") {
      const id = Number(req.query?.id); if (!Number.isInteger(id)) return res.status(400).json({ error: "ID tidak valid." });
      const r = await db.execute({ sql: "SELECT id,username,role FROM staff WHERE id=?", args: [id] });
      const target = r.rows[0]; if (!target) return res.status(404).json({ error: "Staff tidak ditemukan." });
      if (target.role === "super_owner" || target.id === session.id) return res.status(403).json({ error: "Akun ini dilindungi." });
      if (session.role === "owner" && target.role !== "reseller") return res.status(403).json({ error: "Owner hanya dapat menghapus reseller." });
      await db.execute({ sql: "DELETE FROM staff WHERE id=?", args: [id] });
      await audit(session, "DELETE_STAFF", target.username, target.role);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) { console.error(e); return res.status(500).json({ error: "Operasi staff gagal. Username mungkin sudah digunakan." }); }
}
