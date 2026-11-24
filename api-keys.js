import { db, requireSession, requireRole } from "./db.js";
import crypto from "node:crypto";

const PRODUCTS = ["PANEL V1", "PANEL V2", "PANEL V3", "PANEL V4"];
const makeKey = prefix => `${prefix}-${Array.from(crypto.randomBytes(12), b => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("").match(/.{1,4}/g).join("-")}`;
const log = (session, action, detail) => ({ sql: "INSERT INTO activity_logs(staff_id,staff_username,staff_role,action,details) VALUES(?,?,?,?,?)", args: [session.id, session.username, session.role, action, detail] });
const revision = { sql: "UPDATE system_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1", args: [] };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = requireSession(req, res); if (!session) return;
  try {
    if (req.method === "GET") {
      const r = await db.execute("SELECT *,key_code AS license_key,user_name AS username,CASE WHEN is_muted=1 THEN 'MUTED' WHEN is_lifetime=0 AND (expired_at IS NULL OR julianday(expired_at)<=julianday('now')) THEN 'EXPIRED' ELSE 'ACTIVE' END AS status FROM license_keys ORDER BY id DESC");
      return res.status(200).json({ data: r.rows });
    }
    const body = req.body || {};
    if (req.method === "POST") {
      if (!requireRole(session, ["super_owner", "owner", "reseller"], res)) return;
      const username = String(body.username || "").trim().slice(0, 80), product = String(body.product || "");
      const prefix = String(body.prefix || "NX").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "NX";
      const lifetime = body.duration === "lifetime", days = Number(body.days || body.duration);
      if (!username || !PRODUCTS.includes(product) || (!lifetime && (!Number.isInteger(days) || days < 1 || days > 3650))) return res.status(400).json({ error: "Periksa nama user, produk, dan durasi." });
      const key = body.customKey ? String(body.customKey).trim().toUpperCase() : makeKey(prefix);
      if (!/^[A-Z0-9]{2,8}(?:-[A-Z0-9]{4}){3}$/.test(key)) return res.status(400).json({ error: "Format custom key harus PREFIX-XXXX-XXXX-XXXX." });
      const expiry = lifetime ? null : new Date(Date.now() + days * 86400000).toISOString();
      await db.batch([
        { sql: "INSERT INTO license_keys(key_code,user_name,product,expired_at,is_lifetime,is_muted,created_by) VALUES(?,?,?,?,?,0,?)", args: [key, username, product, expiry, lifetime ? 1 : 0, session.username] },
        log(session, "CREATE_KEY", `${key} · ${product} · ${username}`), revision
      ], "write");
      return res.status(201).json({ success: true, key });
    }
    if (req.method === "PATCH") {
      const id = Number(body.id); if (!Number.isInteger(id)) return res.status(400).json({ error: "ID tidak valid." });
      const found = await db.execute({ sql: "SELECT * FROM license_keys WHERE id=?", args: [id] });
      const item = found.rows[0]; if (!item) return res.status(404).json({ error: "License tidak ditemukan." });
      if (body.action === "mute" || body.action === "unmute") {
        if (body.action === "unmute" && item.muted_by_role && item.muted_by_role !== "reseller" && session.role === "reseller") return res.status(403).json({ error: "Dikunci oleh Owner." });
        const mute = body.action === "mute";
        await db.batch([
          { sql: "UPDATE license_keys SET is_muted=?,muted_by=?,muted_by_role=? WHERE id=?", args: [mute ? 1 : 0, mute ? session.username : null, mute ? session.role : null, id] },
          log(session, mute ? "MUTE_KEY" : "UNMUTE_KEY", item.key_code), revision
        ], "write");
        return res.status(200).json({ success: true });
      }
      if (body.action === "extend") {
        if (!requireRole(session, ["super_owner", "owner"], res)) return;
        const lifetime = body.lifetime === true, days = Number(body.days);
        if (!lifetime && (!Number.isInteger(days) || days < 1 || days > 3650)) return res.status(400).json({ error: "Durasi tidak valid." });
        const base = item.expired_at && new Date(item.expired_at).getTime() > Date.now() ? new Date(item.expired_at).getTime() : Date.now();
        const expiry = lifetime ? null : new Date(base + days * 86400000).toISOString();
        await db.batch([
          { sql: "UPDATE license_keys SET is_lifetime=?,expired_at=?,is_muted=0,muted_by=NULL,muted_by_role=NULL WHERE id=?", args: [lifetime ? 1 : 0, expiry, id] },
          log(session, "EXTEND_TIME", `${item.key_code} · ${lifetime ? "LIFETIME" : `+${days} hari`}`), revision
        ], "write");
        return res.status(200).json({ success: true });
      }
      if (body.action === "edit") {
        const username = String(body.username || "").trim().slice(0, 80), product = String(body.product || "");
        if (!username || !PRODUCTS.includes(product)) return res.status(400).json({ error: "Nama user dan produk wajib valid." });
        await db.batch([
          { sql: "UPDATE license_keys SET user_name=?,product=? WHERE id=?", args: [username, product, id] },
          log(session, "EDIT_KEY", `${item.key_code} · ${username} · ${product}`), revision
        ], "write");
        return res.status(200).json({ success: true });
      }
      return res.status(400).json({ error: "Aksi tidak dikenal." });
    }
    if (req.method === "DELETE") {
      const id = Number(req.query?.id || body.id); if (!Number.isInteger(id)) return res.status(400).json({ error: "ID tidak valid." });
      const r = await db.execute({ sql: "SELECT key_code FROM license_keys WHERE id=?", args: [id] });
      if (!r.rows[0]) return res.status(404).json({ error: "License tidak ditemukan." });
      await db.batch([{ sql: "DELETE FROM license_keys WHERE id=?", args: [id] }, log(session, "DELETE_KEY", r.rows[0].key_code), revision], "write");
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) { console.error(e); return res.status(500).json({ error: "Operasi license gagal. Periksa struktur tabel Turso dan nilai unik key." }); }
}
