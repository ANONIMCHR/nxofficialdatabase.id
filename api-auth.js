import { db, bcrypt, setSession, clearSession, getSession, bootstrapOwner } from "./db.js";
import crypto from "node:crypto";
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const session = getSession(req);
      return res.status(200).json({ authenticated: !!session, staff: session ? { id: session.id, username: session.username, role: session.role } : null });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const { action, username, password } = req.body || {};
    if (action === "logout") { clearSession(res); return res.status(200).json({ success: true }); }
    if (action !== "login" || typeof username !== "string" || !username.trim() || typeof password !== "string" || !password) return res.status(400).json({ error: "Data login tidak valid." });
    await bootstrapOwner();
    const result = await db.execute({ sql: "SELECT id, username, password, role FROM staff WHERE username = ? COLLATE NOCASE", args: [username.trim()] });
    const staff = result.rows[0];
    if (!staff) return res.status(401).json({ error: "Username atau password salah." });
    const storedPassword = String(staff.password ?? "");
    const isBcryptHash = BCRYPT_HASH.test(storedPassword);
    const passwordMatches = isBcryptHash
      ? await bcrypt.compare(password, storedPassword)
      : (() => {
          const supplied = Buffer.from(password);
          const stored = Buffer.from(storedPassword);
          return supplied.length === stored.length && crypto.timingSafeEqual(supplied, stored);
        })();
    if (!passwordMatches) return res.status(401).json({ error: "Username atau password salah." });
    if (!isBcryptHash) {
      const hash = await bcrypt.hash(password, 12);
      await db.execute({
        sql: "UPDATE staff SET password=? WHERE id=? AND password=?",
        args: [hash, staff.id, storedPassword]
      });
    }
    setSession(res, staff);
    return res.status(200).json({ success: true, staff: { id: staff.id, username: staff.username, role: staff.role } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Autentikasi gagal. Periksa konfigurasi database dan SESSION_SECRET." });
  }
}
