/* ============================================================================
   MENU.JS — the single source of truth for the hamburger menu.
   Add a new object here for every new page. The main frame reads this file
   to build the menu AND to enforce which roles may open which page.
   See HOW_TO_ADD_PAGE.md for the full explanation of every field.
   ============================================================================ */

const MENU_ITEMS = [
  {
    id: "dashboard",                 // unique, matches the page's own pageId
    label: "Dashboard",
    icon: "🏠",
    file: "pages/dashboard.html",    // path loaded into the iframe
    group: "General",                // used to group items in the menu
    fullAccess: ["admin", "editor", "viewer"],   // can edit/delete
    limitedAccess: [],                            // can read/enter only
    order: 1
  },
  {
    id: "manage-users",
    label: "Approve Users",
    icon: "✅",
    file: "pages/manage-users.html",
    group: "Administration",
    fullAccess: ["admin"],
    limitedAccess: [],
    order: 10
  },
  {
    id: "manage-roles",
    label: "Manage Roles",
    icon: "🏷️",
    file: "pages/manage-roles.html",
    group: "Administration",
    fullAccess: ["admin"],
    limitedAccess: [],
    order: 11
  },
  {
    id: "audit-log",
    label: "Audit Log",
    icon: "🕒",
    file: "pages/audit-log.html",
    group: "Administration",
    fullAccess: ["admin"],
    limitedAccess: [],
    order: 12
  }
];

// Returns only the items a given role name is allowed to see at all
// (full or limited access), sorted for display, grouped by `group`.
function visibleMenuItemsForRole(roleName) {
  return MENU_ITEMS
    .filter(m => m.fullAccess.includes(roleName) || m.limitedAccess.includes(roleName))
    .sort((a, b) => a.order - b.order);
}
