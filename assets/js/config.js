/* ============================================================================
   CONFIG.JS — the ONE shared config file every page (main frame + every
   module page loaded in the iframe) includes. Nothing else in this file
   should become page-specific — keep it limited to connection info and
   app-wide constants.
   ============================================================================ */

// ---- Supabase project connection -------------------------------------------
// Get these from Supabase Dashboard → Project Settings → API.
// The anon/public key is safe to expose in front-end code; Row Level
// Security (see sql/schema.sql) is what actually protects the data.
const SUPABASE_URL = "https://qnzswrntwuocryleohlh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_byGbDf3HN9ocQD9pmnmVnQ_CSH9D5vd";

// ---- Login without email -----------------------------------------------
// Supabase Auth requires an email under the hood. Users only ever see/type
// a username; we silently turn "jdoe" into "jdoe@school.internal".
// Change this to anything — it is never shown to users.
const EMAIL_DOMAIN = "school.internal";

// ---- App-wide constants -----------------------------------------------
const APP_NAME = "Greenfield High — Portal";
const STATUS = { PENDING: "pending", ACTIVE: "active", DEACTIVATED: "deactivated" };
const DEFAULT_ROLES = ["admin", "editor", "viewer"];

// ---- Supabase client (one shared instance per page) ------------------
// Loaded via the Supabase CDN script tag before this file, e.g.:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
//   <script src="../assets/js/config.js"></script>
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "school-app-auth" }
});
