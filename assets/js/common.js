/* ============================================================================
   COMMON.JS — shared "basic page functions" every page (main frame + every
   module page) includes, after config.js. Provides: session/user helpers,
   the universal modal (popup) system, toasts, and audit logging.
   Do NOT put page-specific logic in this file — it must stay generic so
   every page can rely on it staying stable.
   ============================================================================ */

/* ---------------------------------------------------------------------------
   USERNAME <-> EMAIL (Supabase Auth needs an email; users only see username)
--------------------------------------------------------------------------- */
function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

/* ---------------------------------------------------------------------------
   SESSION / CURRENT USER
   Session is stored by supabase-js in localStorage, which is shared across
   the main frame and every iframe page because they are same-origin.
--------------------------------------------------------------------------- */
async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

// Returns the full profile row from public.users for the logged-in user,
// joined with the role name. Returns null if not logged in.
async function getCurrentProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabaseClient
    .from("users")
    .select("user_id, username, mobile_no, status, role_id, roles(role_name)")
    .eq("user_id", session.user.id)
    .single();
  if (error) return null;
  return {
    user_id: data.user_id,
    username: data.username,
    mobile_no: data.mobile_no,
    status: data.status,
    role_id: data.role_id,
    role_name: data.roles ? data.roles.role_name : null
  };
}

// Call at the top of every MODULE PAGE (inside the iframe) to guard it.
// Redirects to a friendly message if not logged in / not active.
async function requireActiveUser() {
  const profile = await getCurrentProfile();
  if (!profile || profile.status !== STATUS.ACTIVE) {
    document.body.innerHTML =
      '<div class="empty-state"><div class="icon">🔒</div>' +
      "<h3>Not signed in</h3><p>Please sign in from the main portal window.</p></div>";
    return null;
  }
  return profile;
}

/* ---------------------------------------------------------------------------
   ACCESS CONTROL
   Every menu item in menu.js declares fullAccess: [...roles] and
   limitedAccess: [...roles]. Full access = can create/edit/delete.
   Limited access = can read + create only, no edit/delete.
--------------------------------------------------------------------------- */
function getMenuItemById(pageId) {
  return (typeof MENU_ITEMS !== "undefined" ? MENU_ITEMS : []).find(m => m.id === pageId);
}

// accessLevel(menuItem, roleName) -> "full" | "limited" | "none"
function accessLevel(menuItem, roleName) {
  if (!menuItem || !roleName) return "none";
  if (menuItem.fullAccess.includes(roleName)) return "full";
  if (menuItem.limitedAccess.includes(roleName)) return "limited";
  return "none";
}

// Convenience for a module page: pass its own pageId (must match menu.js id).
async function getMyAccess(pageId) {
  const profile = await requireActiveUser();
  if (!profile) return { profile: null, level: "none" };
  const item = getMenuItemById(pageId);
  const level = accessLevel(item, profile.role_name);
  return { profile, level };
}

/* ---------------------------------------------------------------------------
   AUDIT LOGGING — call after every insert / update / delete a page performs.
--------------------------------------------------------------------------- */
async function logAudit(tableName, recordId, action, oldData, newData) {
  const session = await getSession();
  if (!session) return;
  const profile = await getCurrentProfile();
  await supabaseClient.from("audit_log").insert({
    table_name: tableName,
    record_id: String(recordId),
    action, // 'insert' | 'update' | 'delete'
    changed_by: session.user.id,
    changed_by_username: profile ? profile.username : null,
    old_data: oldData || null,
    new_data: newData || null
  });
}

// Stamp created_by/updated_by fields consistently before insert/update.
async function withAuditStamp(record, { isNew }) {
  const session = await getSession();
  const uid = session ? session.user.id : null;
  const now = new Date().toISOString();
  if (isNew) {
    record.created_by = uid;
    record.updated_by = uid;
  } else {
    record.updated_by = uid;
    record.updated_at = now;
  }
  return record;
}

/* ---------------------------------------------------------------------------
   MODAL / POPUP SYSTEM — universal, used for every data-entry form and every
   info/detail view on every page. Do not build custom popups; use these.

   HTML required once per page (see PAGE_TEMPLATE.html):
     <div id="modalRoot"></div>
     <div id="toastRoot" class="toast-stack"></div>

   Usage:
     openModal({
       title: "Add notice",
       subtitle: "Visible to the whole school",
       wide: false,
       bodyHtml: `...form markup using .field/.input classes...`,
       footHtml: `<button class="btn btn-ghost" data-close>Cancel</button>
                  <button class="btn btn-primary" id="saveBtn">Save</button>`,
       onOpen: (box) => { document.getElementById('saveBtn').onclick = async () => {...}; }
     });
--------------------------------------------------------------------------- */
function openModal({ title, subtitle = "", bodyHtml = "", footHtml = "", wide = false, onOpen }) {
  closeModal(); // only one modal at a time
  const root = document.getElementById("modalRoot");
  if (!root) { console.error("Missing <div id='modalRoot'></div> on this page."); return; }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "activeModalOverlay";
  overlay.innerHTML = `
    <div class="modal-box ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-head">
        <div>
          <h3 id="modalTitle">${title}</h3>
          ${subtitle ? `<div class="modal-sub">${subtitle}</div>` : ""}
        </div>
        <button class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ""}
    </div>`;
  root.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", escCloseOnce);

  requestAnimationFrame(() => overlay.classList.add("open"));
  if (onOpen) onOpen(overlay.querySelector(".modal-box"));
}

function escCloseOnce(e) {
  if (e.key === "Escape") closeModal();
}

function closeModal() {
  const overlay = document.getElementById("activeModalOverlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  document.removeEventListener("keydown", escCloseOnce);
  setTimeout(() => overlay.remove(), 220);
}

/* ---------------------------------------------------------------------------
   TOASTS
--------------------------------------------------------------------------- */
function showToast(message, type = "default") {
  const root = document.getElementById("toastRoot");
  if (!root) { console.log("[toast]", message); return; }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .25s ease";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

/* ---------------------------------------------------------------------------
   SMALL SHARED UTILITIES
--------------------------------------------------------------------------- */
function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));
}

function statusBadge(status) {
  const map = {
    active: '<span class="badge badge-success">Active</span>',
    pending: '<span class="badge badge-warning">Pending</span>',
    deactivated: '<span class="badge badge-danger">Deactivated</span>'
  };
  return map[status] || `<span class="badge badge-neutral">${escapeHtml(status)}</span>`;
}
