// Pure route decision, shared by the Android native back event and Capacitor fallback.
export function backTarget(page, sheetOpen = false) {
  if (sheetOpen) return "dismiss-sheet";
  if (page === "edit") return "all";
  if (page === "home") return "exit";
  return "home";
}
