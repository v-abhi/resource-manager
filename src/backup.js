import { db } from "./db.js";
const VERSION = 1;
export async function exportBackup() {
  const data = {
    app: "resource-manager",
    version: VERSION,
    exportedAt: new Date().toISOString(),
    resources: await db.resources.toArray(),
    logs: await db.logs.toArray(),
    settings: await db.settings.toArray(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `resource-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function restoreBackup(file) {
  if (!file) return false;
  const data = JSON.parse(await file.text());
  if (
    data?.app !== "resource-manager" ||
    data?.version !== VERSION ||
    !Array.isArray(data.resources) ||
    !Array.isArray(data.logs) ||
    !Array.isArray(data.settings)
  )
    throw new Error("This is not a valid Resource Manager backup.");
  if (
    !data.resources.every(
      (x) => typeof x.id === "string" && typeof x.name === "string",
    ) ||
    !data.logs.every(
      (x) => typeof x.id === "string" && typeof x.resourceId === "string",
    )
  )
    throw new Error("Backup has invalid records.");
  if (
    !confirm(
      `Restore ${data.resources.length} resources and ${data.logs.length} logs? This REPLACES all existing app data.`,
    )
  )
    return false;
  await db.transaction("rw", db.resources, db.logs, db.settings, async () => {
    await Promise.all([
      db.resources.clear(),
      db.logs.clear(),
      db.settings.clear(),
    ]);
    await db.resources.bulkPut(data.resources);
    await db.logs.bulkPut(data.logs);
    await db.settings.bulkPut(data.settings);
  });
  return true;
}
export async function exportCSV(logs, resourceById) {
  const cell = (x) => '"' + String(x ?? "").replaceAll('"', '""') + '"';
  const lines = [
    ["Date & time", "Resource", "Action", "Quantity", "Unit"]
      .map(cell)
      .join(","),
  ];
  for (const l of logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const r = resourceById.get(l.resourceId);
    lines.push(
      [l.timestamp, r?.name || "Deleted", l.kind, l.amount, r?.unit || ""]
        .map(cell)
        .join(","),
    );
  }
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "resource-manager-logs.csv";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
