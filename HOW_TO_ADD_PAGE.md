# How to Add a New Page

This document is the single reference for adding a new module page to the
Greenfield High Portal. It is written so that an AI assistant (or a new
developer) can create a complete, correctly-styled, correctly-secured page
without needing to ask questions. Follow every section — nothing here is
optional unless marked "optional".

---

## 1. How the app is put together (read this first)

```
school-app/
  index.html                 ← the ONLY page a browser loads directly.
                                Shows login/registration, then the app shell
                                (hamburger menu + iframe). NEVER edit this
                                file to add a new page — you only touch
                                menu.js and pages/*.html.
  assets/
    css/common.css            ← universal shared style. Every page links it.
    js/config.js               ← Supabase URL/key + app constants. SHARED — never
                                fork or duplicate this file.
    js/common.js                ← shared helper functions (auth, modal, toast,
                                audit log). SHARED — never fork or duplicate.
    js/menu.js                   ← THE FILE YOU EDIT to register a new page.
  pages/
    PAGE_TEMPLATE.html            ← copy this file to start a new page.
    dashboard.html, notice-board.html, manage-users.html,
    manage-roles.html, audit-log.html   ← existing pages, notice-board.html
                                           is the fullest worked example.
  sql/
    schema.sql                     ← core tables (users, roles, audit_log).
    example_module_notice_board.sql ← copy this SQL pattern for a new table.
```

**Every module page loads inside an `<iframe>`** in the main frame
(`index.html`). Because the iframe is same-origin (same GitHub Pages site),
it shares `localStorage`, which is where the Supabase session lives — so a
module page can call `supabaseClient.auth.getSession()` directly and it will
already be logged in. You never need to pass the session in manually.

**Every module page is fully standalone and modular.** Pages do not import
each other and do not share DOM/state directly. The only things pages share
are:
0. The Supabase JS CDN script — `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js`
   — MUST be loaded before `config.js` on every single page. `config.js`
   builds `supabaseClient` from `window.supabase.createClient(...)`, so
   without this tag (or with it in the wrong order), `supabaseClient` is
   never created and every page function that touches the database throws
   immediately. See Step 4, item 3a for the exact required order.
1. `assets/css/common.css` — visual style (colors, buttons, modal, table, form controls)
2. `assets/js/config.js` — Supabase connection + constants
3. `assets/js/menu.js` — the menu/access registry
4. `assets/js/common.js` — helper functions (auth check, modal system, toasts, audit log)

Do not add page-specific CSS/JS into these shared files. Page-specific style
or script belongs inside that page's own `<style>`/`<script>` tags.

---

## 2. Step-by-step: adding a new page

### Step 1 — Decide the basics
Pick, and write down:
- **Page id** — lowercase, hyphenated, unique. e.g. `library-books`
- **Label** — what users see in the menu. e.g. "Library Books"
- **Icon** — one emoji. e.g. 📚
- **Group** — menu section it appears under. e.g. "Academics"
- **Roles with full access** — can create, edit AND delete records
- **Roles with limited access** — can only read existing records AND create
  new ones, but cannot edit or delete anything (including their own entries)
- **Does it need its own database table?** (almost always yes)

### Step 2 — Add the database table (if the page stores data)
Copy `sql/example_module_notice_board.sql` as your starting point and run
the edited version in the Supabase SQL Editor. The pattern to follow:

```sql
create table if not exists public.<your_table> (
  <table>_id   uuid primary key default gen_random_uuid(),
  -- ...your real columns here...
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id)
);

drop trigger if exists trg_<table>_updated_at on public.<your_table>;
create trigger trg_<table>_updated_at
before update on public.<your_table>
for each row execute function public.set_updated_at();

alter table public.<your_table> enable row level security;

-- read: every active user (adjust if the page should be more restricted)
create policy <table>_select on public.<your_table>
  for select using (public.current_role_name() is not null);

-- insert: every role you listed in BOTH fullAccess and limitedAccess
create policy <table>_insert on public.<your_table>
  for insert with check (public.current_role_name() in ('admin','editor','viewer'));

-- update/delete: ONLY the roles you listed in fullAccess
create policy <table>_update on public.<your_table>
  for update using (public.current_role_name() in ('admin','editor'));
create policy <table>_delete on public.<your_table>
  for delete using (public.current_role_name() in ('admin','editor'));
```

Rules for every new table:
- Primary key column is always named `<table_singular>_id`, type `uuid`,
  `default gen_random_uuid()`.
- Always include `created_at`, `updated_at`, `created_by`, `updated_by` —
  this is the audit trail the client requires ("auto track which user did
  it and when"). `created_by`/`updated_by` are `uuid references auth.users(id)`.
- Always enable Row Level Security and add policies — RLS is the *real*
  security boundary. The menu's fullAccess/limitedAccess only controls the
  UI; without matching RLS policies a limited-access user could still call
  the API directly and edit data.
- Table and column names: lowercase, `snake_case`, plural table names.

### Step 3 — Register the page in `assets/js/menu.js`
Add one object to the `MENU_ITEMS` array:

```js
{
  id: "library-books",                 // matches PAGE_ID inside your new page
  label: "Library Books",
  icon: "📚",
  file: "pages/library-books.html",
  group: "Academics",
  fullAccess: ["admin", "editor"],     // can add/edit/delete
  limitedAccess: ["viewer"],           // can add/read only
  order: 5                             // controls menu sort order (lower = higher)
}
```

That's it — the hamburger menu, per-role visibility, and the "Add" button
visibility are now all driven from this one entry. Nothing else needs to be
touched to wire the page into the app shell.

### Step 4 — Create the page file
Copy `pages/PAGE_TEMPLATE.html` to `pages/library-books.html` and:
1. Set `<title>` to `"<Page label> — Greenfield High Portal"`.
2. Set `const PAGE_ID = "library-books";` — **must exactly match** the `id`
   you used in `menu.js`, or access checks will silently fail (treated as
   "not registered" → no access).
3. Keep the three shared `<script src="../assets/js/...">` tags and the
   `<link rel="stylesheet" href="../assets/css/common.css">` tag exactly as
   in the template, with the `../` relative path (pages live one folder
   below the project root).
3a. **The Supabase JS library script tag MUST come before `config.js`, in
   this exact order, every time:**
   ```html
   <link rel="stylesheet" href="../assets/css/common.css" />
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
   <script src="../assets/js/config.js"></script>
   <script src="../assets/js/menu.js"></script>
   <script src="../assets/js/common.js"></script>
   ```
   `config.js` calls `window.supabase.createClient(...)` on load to build
   `supabaseClient`. If the Supabase CDN script is missing or placed after
   `config.js`, `window.supabase` is `undefined` and you get exactly this
   failure, every time:
   ```
   Uncaught TypeError: Cannot read properties of undefined (reading 'createClient')   config.js:30
   Uncaught (in promise) ReferenceError: supabaseClient is not defined          common.js:22
   ```
   Any page-specific `<script>` tags you add (chart libraries, xlsx/SheetJS,
   etc.) must go **after** this block, never before or between these four
   lines.
4. Keep the `<div id="modalRoot"></div>` and `<div id="toastRoot" class="toast-stack"></div>`
   at the end of `<body>` — required for popups and toasts to work.
5. Write your page's own markup inside `.page-wrap` using only the shared
   CSS classes from section 4 below.
6. Write your page's own `<script>` following the pattern in section 5.

### Step 5 — Test as each role
1. Register a throwaway account, approve it, assign the new role(s).
2. Confirm a **full-access** role sees the "Add" button and edit/delete
   controls, and can use them successfully.
3. Confirm a **limited-access** role sees the list and the "Add" button,
   but NOT edit/delete controls.
4. Confirm a role with **no access** does not see the menu item at all, and
   if they load the page's file URL directly, `requireActiveUser()` /
   `getMyAccess()` blocks the page content.
5. Open `pages/audit-log.html` as admin and confirm your inserts / updates /
   deletes show up with the right username and timestamp.

---

## 3. The "full access vs limited access" rule (applies to every page)

This is a hard rule for every module page in the app:

| Capability            | Full access role | Limited access role |
|------------------------|:---:|:---:|
| View records            | ✅ | ✅ |
| Create new records       | ✅ | ✅ |
| Edit any record            | ✅ | ❌ |
| Delete any record            | ✅ | ❌ |

- A role not listed in either `fullAccess` or `limitedAccess` for a page
  cannot see that page in the menu and cannot open it at all.
- This must be enforced **twice**: once in the UI (hide the Edit/Delete
  buttons — see `myAccess.level` in section 5) and once in the database
  (RLS policies — see Step 2). The UI check is for a good experience; the
  RLS check is what actually stops the request. Never rely on the UI check
  alone.

---

## 4. Shared CSS classes you must use (from `common.css`)

Use these exact classes so every page looks identical. Do not invent
one-off button/card/table styles in a page's local `<style>` block.

| Purpose | Markup |
|---|---|
| Page container | `<div class="page-wrap"><div class="page-header">...</div>...</div>` |
| Section label above a title | `<span class="eyebrow">Section</span>` |
| Card / panel | `<div class="card">...</div>` |
| Primary button | `<button class="btn btn-primary">Save</button>` |
| Secondary/cancel button | `<button class="btn btn-ghost">Cancel</button>` |
| Accent button | `<button class="btn btn-accent">Approve</button>` |
| Destructive button | `<button class="btn btn-danger">Delete</button>` |
| Small button | add `btn-sm` alongside a `btn-*` class |
| Form field | `<div class="field"><label>...</label><input class="input"/></div>` |
| Field error text | `<div class="field-error show">Message</div>` |
| Status/role pill | `<span class="badge badge-success">Active</span>` (`badge-success`/`badge-warning`/`badge-danger`/`badge-neutral`) |
| Data table | `<div class="table-wrap"><table class="data">...</table></div>` |
| Empty state | `<div class="empty-state"><div class="icon">📄</div><p>No records.</p></div>` |
| Loading placeholder | `<div class="skeleton" style="height:18px"></div>` |
| Entrance animation | add `enter-up` class to the outer `.page-wrap` |

Colors, fonts, spacing and border-radius are all controlled by CSS
variables in `common.css` (`--ink`, `--brass`, `--paper`, `--radius-md`,
etc.) — never hardcode a hex color or px radius in a page; reference the
variable (e.g. `var(--ink)`) if you truly need a one-off style.

---

## 5. Shared JS functions you must use (from `common.js`)

| Function | What it does |
|---|---|
| `getSession()` | Returns the current Supabase auth session, or `null`. |
| `getCurrentProfile()` | Returns `{ user_id, username, mobile_no, status, role_id, role_name }` for the signed-in user, or `null`. |
| `requireActiveUser()` | Guards a page: renders a "not signed in" message and returns `null` if the user isn't logged in / not `active`; otherwise returns the profile. |
| `getMyAccess(pageId)` | The main entry point for a module page. Returns `{ profile, level }` where `level` is `"full"`, `"limited"`, or `"none"`, based on `menu.js`. Call this once at the top of `init()`. |
| `openModal({ title, subtitle, bodyHtml, footHtml, wide, onOpen })` | Opens the universal popup. This is the ONLY way to show a data-entry form or a detail view. Never build a custom popup. |
| `closeModal()` | Closes the active popup. |
| `showToast(message, type)` | Shows a toast (`type`: `"default"`, `"success"`, `"error"`). Use after every save/delete. |
| `logAudit(tableName, recordId, action, oldData, newData)` | Writes one row to `audit_log`. Call after every insert/update/delete. `action` is `"insert"`, `"update"`, or `"delete"`. |
| `withAuditStamp(record, { isNew })` | Mutates and returns `record`, adding `created_by`/`updated_by` (and `updated_at` on updates) from the current session. Call this right before every insert/update. |
| `formatDateTime(iso)` | Human-friendly date/time formatting for display. |
| `escapeHtml(str)` | Always wrap any user-entered text with this before injecting into `innerHTML`, to avoid breaking layout or XSS. |
| `statusBadge(status)` | Returns ready-made badge HTML for `active`/`pending`/`deactivated`. |

### Standard page skeleton (`<script>` section)

```js
const PAGE_ID = "library-books"; // must match menu.js id
let myAccess = null;

async function init() {
  myAccess = await getMyAccess(PAGE_ID);
  if (!myAccess.profile) return; // requireActiveUser() already showed a message

  if (myAccess.level === "full") {
    document.getElementById("addBtn").style.display = "inline-flex";
    document.getElementById("addBtn").onclick = () => openRecordModal(null);
  }
  await loadList();
}

async function loadList() {
  const { data, error } = await supabaseClient
    .from("library_books")
    .select("*")
    .order("created_at", { ascending: false });
  // render `data` into #listArea, using escapeHtml() on every text field,
  // and only render edit/delete buttons when myAccess.level === "full"
}

init();
```

---

## 6. Worked example — data entry popup + save (copy this pattern exactly)

This is the pattern used in `pages/notice-board.html`. Use it as the
reference implementation for any "add/edit a record" popup.

```js
function openRecordModal(existing) {
  const isEdit = !!existing;
  openModal({
    title: isEdit ? "Edit book" : "Add book",
    subtitle: isEdit ? "Update the details below" : "Add a new library book",
    bodyHtml: `
      <div class="field">
        <label for="bTitle">Title</label>
        <input class="input" id="bTitle" value="${isEdit ? escapeHtml(existing.title) : ""}" />
        <div class="field-error" id="bTitleErr">Title is required.</div>
      </div>
      <div class="field">
        <label for="bAuthor">Author</label>
        <input class="input" id="bAuthor" value="${isEdit ? escapeHtml(existing.author) : ""}" />
      </div>
    `,
    footHtml: `
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="saveBtn">${isEdit ? "Save changes" : "Add book"}</button>
    `,
    onOpen: () => { document.getElementById("saveBtn").onclick = () => saveRecord(existing); }
  });
}

async function saveRecord(existing) {
  const title = document.getElementById("bTitle").value.trim();
  const author = document.getElementById("bAuthor").value.trim();
  const errEl = document.getElementById("bTitleErr");
  if (!title) { errEl.classList.add("show"); return; }
  errEl.classList.remove("show");

  const btn = document.getElementById("saveBtn");
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';

  if (existing) {
    const record = await withAuditStamp({ title, author }, { isNew: false });
    const { error } = await supabaseClient.from("library_books").update(record).eq("book_id", existing.book_id);
    if (error) { showToast("Update failed: " + error.message, "error"); return; }
    await logAudit("library_books", existing.book_id, "update", existing, record);
    showToast("Book updated.", "success");
  } else {
    const record = await withAuditStamp({ title, author }, { isNew: true });
    const { data, error } = await supabaseClient.from("library_books").insert(record).select().single();
    if (error) { showToast("Add failed: " + error.message, "error"); return; }
    await logAudit("library_books", data.book_id, "insert", null, record);
    showToast("Book added.", "success");
  }

  closeModal();
  await loadList();
}
```

**Delete confirmation** always uses a popup too — never a browser
`confirm()`:

```js
function confirmDelete(id, label) {
  openModal({
    title: "Delete book?",
    subtitle: "This cannot be undone.",
    bodyHtml: `<p>Delete "<strong>${escapeHtml(label)}</strong>"?</p>`,
    footHtml: `<button class="btn btn-ghost" data-close>Cancel</button>
               <button class="btn btn-danger" id="confirmDelBtn">Delete</button>`,
    onOpen: () => {
      document.getElementById("confirmDelBtn").onclick = async () => {
        const { error } = await supabaseClient.from("library_books").delete().eq("book_id", id);
        if (error) { showToast("Delete failed: " + error.message, "error"); return; }
        await logAudit("library_books", id, "delete", { title: label }, null);
        closeModal();
        showToast("Book deleted.", "success");
        await loadList();
      };
    }
  });
}
```

---

## 7. Checklist before you consider a page "done"

- [ ] Table created in Supabase with `uuid` primary key, `created_at`,
      `updated_at`, `created_by`, `updated_by`, RLS enabled, and policies
      matching the page's `fullAccess`/`limitedAccess` roles
- [ ] New entry added to `MENU_ITEMS` in `assets/js/menu.js`
- [ ] `PAGE_ID` constant in the page exactly matches the `id` in `menu.js`
- [ ] Page loads the Supabase CDN script, THEN `config.js` → `menu.js` →
      `common.js`, in that exact order (missing/misordered CDN script is the
      #1 cause of `Cannot read properties of undefined (reading 'createClient')`
      and `supabaseClient is not defined` errors — open devtools console and
      confirm zero errors on page load before checking this box)
- [ ] Page links `common.css`
- [ ] Page has `#modalRoot` and `#toastRoot` divs
- [ ] Only shared CSS classes used (section 4) — no one-off colors/styles
- [ ] Add/Edit/Delete only rendered for `myAccess.level === "full"`; Add
      also rendered for `"limited"`
- [ ] Every insert/update/delete calls `withAuditStamp()` before writing
      and `logAudit()` after writing
- [ ] Every popup uses `openModal()`/`closeModal()` — no custom popups, no
      native `alert()`/`confirm()`
- [ ] Tested as a full-access role, a limited-access role, and a role with
      no access at all

---

## 8. Notes for an AI assistant generating a new page

- Never edit `index.html`, `assets/js/config.js`, `assets/js/common.js`, or
  `assets/css/common.css` to build a page-specific feature — these are
  shared infrastructure. If a page truly needs a new shared helper, add it
  to `common.js` as a generic function (not page-specific) and document it
  here.
- Always produce three artifacts together for a new page: (1) the SQL for
  its table, (2) the `menu.js` entry, (3) the `pages/<id>.html` file.
- Default to the exact structure in `pages/notice-board.html` unless the
  user's request needs something genuinely different (e.g. a form with
  file upload, a calendar view, a chart). Even then, keep the shared
  files/CSS classes/modal system identical — only the page's own data
  model and list rendering should change.
- If unsure which roles should have full vs limited access, default to
  `fullAccess: ["admin"]` and `limitedAccess: ["editor", "viewer"]`, and
  say so explicitly, so the user can adjust.
- Every new page's `<head>` MUST include the Supabase CDN script before
  `config.js` (see Step 4, item 3a). This is easy to forget because it's
  not one of the project's own `assets/js/*` files, and forgetting it
  produces a runtime error, not a build error — it will look fine until
  the page loads in a browser. Before handing back any new page, re-read
  its `<head>` and confirm all five lines are present, in order: Supabase
  CDN, `common.css`, `config.js`, `menu.js`, `common.js`.
