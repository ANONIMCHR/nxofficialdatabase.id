import { CONFIG } from "./config.js";

const $ = (selector) => document.querySelector(selector);
const state = { staff: null, licenses: [], revision: -1, activeView: "overview", syncBusy: false, modalAction: null, extendId: null, globalMuted: false };
const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isAdmin = () => ["super_owner", "owner"].includes(state.staff?.role);
const formatDate = value => value ? new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request gagal (${response.status})`);
  return data;
}
function toast(message, error = false) {
  const node = document.createElement("div"); node.className = `toast${error ? " error" : ""}`; node.textContent = message;
  $("#toastContainer").append(node); setTimeout(() => node.remove(), 3200);
}
function setConnection(online) {
  $("#connectionDot").classList.toggle("online", online); $("#connectionDot").classList.toggle("offline", !online);
  $("#connectionText").textContent = online ? "Database connected" : "Connection lost";
}
function renderStaffIdentity() {
  const name = state.staff?.username || "Staff"; $("#staffName").textContent = name;
  $("#staffRoleLabel").textContent = state.staff?.role?.replace("_", " ").toUpperCase() || "";
  $("#userAvatar").textContent = name.slice(0, 2).toUpperCase();
}
function configureRoleUI() {
  document.querySelectorAll("[data-admin-only], .admin-only").forEach(el => el.classList.toggle("hidden", !isAdmin()));
  const roles = state.staff.role === "super_owner" ? ["owner", "reseller"] : ["reseller"];
  $("#staffRoleSelect").innerHTML = roles.map(r => `<option value="${r}">${r.toUpperCase()}</option>`).join("");
}
function configureLogo(imageId, fallbackId) {
  const image = document.getElementById(imageId);
  const fallback = document.getElementById(fallbackId);
  if (!image || !CONFIG.LOGO_URL) return;
  image.onload = () => {
    image.classList.remove("hidden");
    fallback?.classList.add("hidden");
  };
  image.onerror = () => {
    image.classList.add("hidden");
    fallback?.classList.remove("hidden");
  };
  image.src = CONFIG.LOGO_URL;
}
function initConfig() {
  document.title = CONFIG.SITE_TITLE; $("#loginTitle").textContent = CONFIG.SITE_TITLE; $("#navBrandName").textContent = CONFIG.DASHBOARD_NAME;
  configureLogo("loginLogo", "loginLogoFallback");
  configureLogo("navLogo", "navLogoFallback");
  const products = CONFIG.PANEL_PRODUCTS.map(p => `<option value="${escapeHTML(p)}">${escapeHTML(p)}</option>`).join("");
  $("#newProduct").innerHTML = products; $("#productFilter").insertAdjacentHTML("beforeend", CONFIG.PANEL_PRODUCTS.map(p => `<option>${escapeHTML(p)}</option>`).join(""));
}
function showDashboard(staff) {
  state.staff = staff; $("#loginView").classList.add("hidden"); $("#dashboardView").classList.remove("hidden");
  renderStaffIdentity(); configureRoleUI(); navigate("overview"); syncDashboard(true);
}
function navigate(view) {
  if (["staff", "logs"].includes(view) && !isAdmin()) { toast("Akses ditolak.", true); view = "overview"; }
  state.activeView = view;
  document.querySelectorAll(".page-view").forEach(el => el.classList.add("hidden"));
  $(`#${view}Page`).classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  const labels = { overview: "Overview", licenses: "License manager", staff: "Kelola staff", logs: "Audit logs" };
  $("#pageTitle").textContent = labels[view]; $("#breadcrumb").textContent = labels[view].toUpperCase();
  $("#sidebar").classList.remove("open");
  if (view === "staff") loadStaff(); if (view === "logs") loadLogs(); if (view === "licenses") renderLicenses();
}
function licenseStatus(item) {
  if (item.status === "MUTED") return "MUTED";
  if (!Number(item.is_lifetime) && (!item.expired_at || new Date(item.expired_at).getTime() <= Date.now())) return "EXPIRED";
  return "ACTIVE";
}
function remaining(item) {
  if (Number(item.is_lifetime)) return "∞ LIFETIME";
  const ms = new Date(item.expired_at || 0).getTime() - Date.now(); if (ms <= 0) return "EXPIRED";
  const days = Math.floor(ms / 86400000), hours = Math.floor(ms % 86400000 / 3600000), minutes = Math.floor(ms % 3600000 / 60000);
  return days >= 1 ? `${days} hari ${hours} jam` : `${hours} jam ${minutes} menit`;
}
function filteredLicenses() {
  const q = $("#searchInput")?.value?.toLowerCase() || "", product = $("#productFilter")?.value || "ALL", status = $("#statusFilter")?.value || "ALL";
  return state.licenses.filter(item => (!q || `${item.username} ${item.license_key}`.toLowerCase().includes(q)) && (product === "ALL" || item.product === product) && (status === "ALL" || licenseStatus(item) === status));
}
function statusHTML(status) { return `<span class="status-pill status-${status.toLowerCase()}">${status}</span>`; }
function renderLicenses() {
  const rows = filteredLicenses(); $("#rowCount").textContent = `${rows.length} records`;
  $("#licenseTable").innerHTML = rows.length ? rows.map(item => {
    const status = licenseStatus(item);
    const toggle = status === "MUTED" ? "unmute" : "mute";
    const locked = toggle === "unmute" && item.muted_by && state.staff.role === "reseller";
    return `<tr><td><strong>${escapeHTML(item.username)}</strong></td><td class="key-code">${escapeHTML(item.license_key)} <button class="mini-button" data-copy="${escapeHTML(item.license_key)}" title="Copy">Copy</button></td><td>${escapeHTML(item.product)}</td><td>${statusHTML(status)}</td><td>${escapeHTML(remaining(item))}</td><td>${escapeHTML(formatDate(item.created_at))}</td><td><div class="action-group"><button class="mini-button" data-edit="${item.id}">Edit</button><button class="mini-button" data-toggle="${item.id}" data-action="${toggle}" ${locked ? 'disabled title="Dikunci oleh Owner"' : ""}>${toggle === "mute" ? "Mute" : "Unmute"}</button>${isAdmin() ? `<button class="mini-button" data-extend="${item.id}">+Time</button>` : ""}<button class="mini-button" data-delete="${item.id}">Delete</button></div></td></tr>`;
  }).join("") : `<tr><td colspan="7" class="empty-cell">Tidak ada license yang cocok.</td></tr>`;
}
function renderOverview() {
  const items = state.licenses; const statuses = items.map(licenseStatus);
  $("#statTotal").textContent = items.length; $("#statActive").textContent = statuses.filter(s => s === "ACTIVE").length;
  $("#statMuted").textContent = statuses.filter(s => s === "MUTED").length; $("#statExpired").textContent = statuses.filter(s => s === "EXPIRED").length;
  $("#productBreakdown").innerHTML = CONFIG.PANEL_PRODUCTS.map(product => { const count = items.filter(i => i.product === product).length; const pct = items.length ? count / items.length * 100 : 0; return `<div class="breakdown-item"><div class="breakdown-meta"><span>${escapeHTML(product)}</span><strong>${count}</strong></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div>`; }).join("");
  const latest = [...items].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
  $("#overviewTable").innerHTML = latest.length ? latest.map(i => `<tr><td>${escapeHTML(i.username)}</td><td class="key-code">${escapeHTML(i.license_key)}</td><td>${escapeHTML(i.product)}</td><td>${statusHTML(licenseStatus(i))}</td><td>${escapeHTML(remaining(i))}</td></tr>`).join("") : `<tr><td colspan="5" class="empty-cell">Belum ada license. Gunakan generator untuk membuat license pertama.</td></tr>`;
  $("#globalMuteButton").textContent = state.globalMuted ? "Unmute all" : "Mute all";
}
async function loadLicenseList() { const result = await api("/api/keys"); state.licenses = result.data || []; renderOverview(); renderLicenses(); }
async function syncDashboard(force = false) {
  if (state.syncBusy || document.hidden || !state.staff) return; state.syncBusy = true;
  try {
    const status = await api("/api/status"); setConnection(true);
    if (force || status.revision !== state.revision) { state.revision = status.revision; await loadLicenseList(); if (state.activeView === "staff") await loadStaff(); if (state.activeView === "logs") await loadLogs(); }
  } catch (e) { setConnection(false); if (e.message.includes("login")) { state.staff = null; $("#dashboardView").classList.add("hidden"); $("#loginView").classList.remove("hidden"); } }
  finally { state.syncBusy = false; }
}
async function loadStaff() {
  try { const result = await api("/api/staff"); $("#staffTable").innerHTML = result.data.map(s => `<tr><td>${escapeHTML(s.username)} ${s.role === "super_owner" ? '<span class="role-pill">PROTECTED</span>' : ""}</td><td><span class="role-pill role-${s.role}">${s.role.toUpperCase()}</span></td><td>${escapeHTML(formatDate(s.created_at))}</td><td>${s.role !== "super_owner" && s.id !== state.staff.id ? `<button class="mini-button" data-staff-delete="${s.id}">Delete</button>` : "—"}</td></tr>`).join("") || `<tr><td colspan="4" class="empty-cell">Belum ada staff.</td></tr>`; } catch(e) { toast(e.message, true); }
}
async function loadLogs() {
  try { const result = await api("/api/logs"); $("#logsTable").innerHTML = result.data.map(log => `<tr><td>${escapeHTML(formatDate(log.created_at))}</td><td>${escapeHTML(log.actor_username)}</td><td>${escapeHTML(log.actor_role)}</td><td><span class="role-pill">${escapeHTML(log.action)}</span></td><td colspan="2">${escapeHTML(log.detail || "—")}</td></tr>`).join("") || `<tr><td colspan="6" class="empty-cell">Belum ada aktivitas.</td></tr>`; } catch(e) { toast(e.message, true); }
}
function confirmAction(title, message, action) { $("#modalTitle").textContent = title; $("#modalMessage").textContent = message; state.modalAction = action; $("#confirmModal").classList.remove("hidden"); }
function closeModal() { $("#confirmModal").classList.add("hidden"); state.modalAction = null; }
async function runModalAction() { const action = state.modalAction; closeModal(); if (action) await action(); }

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault(); $("#loginError").textContent = "";
  try { const result = await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "login", username: $("#loginUsername").value, password: $("#loginPassword").value }) }); showDashboard(result.staff); toast("Login berhasil."); }
  catch(e) { $("#loginError").textContent = e.message; }
});
$("#togglePassword").addEventListener("click", () => { const input = $("#loginPassword"); input.type = input.type === "password" ? "text" : "password"; $("#togglePassword").textContent = input.type === "password" ? "SHOW" : "HIDE"; });
$("#logoutButton").addEventListener("click", async () => { try { await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) }); } finally { location.reload(); } });
document.querySelectorAll(".nav-link").forEach(button => button.addEventListener("click", () => navigate(button.dataset.view)));
document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.go)));
$("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#newDuration").addEventListener("change", () => $("#customDaysWrap").classList.toggle("hidden", $("#newDuration").value !== "custom"));
$("#generateForm").addEventListener("submit", async event => {
  event.preventDefault(); const duration = $("#newDuration").value;
  const body = { username: $("#newUsername").value, product: $("#newProduct").value, prefix: $("#newPrefix").value, customKey: $("#customKey").value, duration: duration === "custom" ? "custom" : duration, days: duration === "custom" ? Number($("#customDays").value) : Number(duration) };
  if (duration === "lifetime") body.duration = "lifetime";
  try { const result = await api("/api/keys", { method: "POST", body: JSON.stringify(body) }); await syncDashboard(true); await navigator.clipboard?.writeText(result.key).catch(() => {}); toast(`License dibuat: ${result.key}`); $("#generateForm").reset(); $("#newPrefix").value = CONFIG.DEFAULT_KEY_PREFIX; $("#newDuration").value = "7"; $("#customDaysWrap").classList.add("hidden"); }
  catch(e) { toast(e.message, true); }
});
$("#searchInput").addEventListener("input", renderLicenses); $("#productFilter").addEventListener("change", renderLicenses); $("#statusFilter").addEventListener("change", renderLicenses);
$("#refreshButton").addEventListener("click", () => syncDashboard(true));
$("#globalMuteButton").addEventListener("click", () => { const action = state.globalMuted ? "unmute" : "mute"; confirmAction(action === "mute" ? "Mute semua license?" : "Unmute semua license?", "Status semua license yang belum expired akan diperbarui.", async () => { try { await api("/api/global", { method: "POST", body: JSON.stringify({ action }) }); state.globalMuted = action === "mute"; await syncDashboard(true); toast("Status global diperbarui."); } catch(e) { toast(e.message, true); } }); });
$("#staffForm").addEventListener("submit", async event => { event.preventDefault(); try { await api("/api/staff", { method: "POST", body: JSON.stringify({ username: $("#staffUsername").value, password: $("#staffPassword").value, role: $("#staffRoleSelect").value }) }); $("#staffForm").reset(); await loadStaff(); toast("Staff berhasil ditambahkan."); } catch(e) { toast(e.message, true); } });
$("#modalCancel").addEventListener("click", closeModal); $("#modalConfirm").addEventListener("click", runModalAction);
$("#extendCancel").addEventListener("click", () => { $("#extendModal").classList.add("hidden"); state.extendId = null; });
$("#extendLifetime").addEventListener("change", () => { $("#extendDays").disabled = $("#extendLifetime").checked; });
$("#extendForm").addEventListener("submit", async event => { event.preventDefault(); const id = state.extendId; const lifetime = $("#extendLifetime").checked; const days = Number($("#extendDays").value); $("#extendModal").classList.add("hidden"); state.extendId = null; try { await api("/api/keys", { method: "PATCH", body: JSON.stringify({ id, action: "extend", lifetime, days }) }); await syncDashboard(true); toast("Masa aktif diperbarui."); } catch(e) { toast(e.message, true); } }); $("#confirmModal").addEventListener("click", e => { if (e.target.id === "confirmModal") closeModal(); });

document.addEventListener("click", async event => {
  const copy = event.target.closest("[data-copy]"); if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast("License key disalin."); } catch { toast("Clipboard tidak tersedia.", true); } }
  const toggle = event.target.closest("[data-toggle]"); if (toggle) { try { await api("/api/keys", { method: "PATCH", body: JSON.stringify({ id: Number(toggle.dataset.toggle), action: toggle.dataset.action }) }); await syncDashboard(true); toast("Status license diperbarui."); } catch(e) { toast(e.message, true); } }
  const edit = event.target.closest("[data-edit]"); if (edit) { const item = state.licenses.find(row => Number(row.id) === Number(edit.dataset.edit)); if (!item) return; const username = prompt("Nama user", item.username); if (username === null) return; const product = prompt(`Produk (${CONFIG.PANEL_PRODUCTS.join(", ")})`, item.product); if (product === null) return; try { await api("/api/keys", { method: "PATCH", body: JSON.stringify({ id: item.id, action: "edit", username, product: product.trim().toUpperCase() }) }); await syncDashboard(true); toast("License diperbarui."); } catch(e) { toast(e.message, true); } }
  const del = event.target.closest("[data-delete]"); if (del) confirmAction("Hapus license?", "License ini akan dihapus permanen.", async () => { try { await api(`/api/keys?id=${del.dataset.delete}`, { method: "DELETE" }); await syncDashboard(true); toast("License dihapus."); } catch(e) { toast(e.message, true); } });
  const extend = event.target.closest("[data-extend]"); if (extend) { state.extendId = Number(extend.dataset.extend); $("#extendDays").value = 7; $("#extendDays").disabled = false; $("#extendLifetime").checked = false; $("#extendModal").classList.remove("hidden"); }
  const staffDelete = event.target.closest("[data-staff-delete]"); if (staffDelete) confirmAction("Hapus staff?", "Akun staff ini tidak dapat login lagi.", async () => { try { await api(`/api/staff?id=${staffDelete.dataset.staffDelete}`, { method: "DELETE" }); await loadStaff(); toast("Staff dihapus."); } catch(e) { toast(e.message, true); } });
});

document.addEventListener("visibilitychange", () => { if (!document.hidden) syncDashboard(true); });
initConfig();
try { const auth = await api("/api/auth"); if (auth.authenticated) showDashboard(auth.staff); } catch(e) { console.warn(e); }
setInterval(() => syncDashboard(), CONFIG.POLL_INTERVAL_MS);
