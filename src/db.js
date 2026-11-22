import Dexie from "dexie";
export const db = new Dexie("resourceManagerV1");
db.version(1).stores({
  resources: "id, name, start, end, createdAt",
  logs: "id, resourceId, timestamp, [resourceId+timestamp]",
  settings: "key",
});
export async function resources() {
  return db.resources.toArray();
}
export async function logsFor(id) {
  return db.logs.where("resourceId").equals(id).sortBy("timestamp");
}
export async function allLogs() {
  return db.logs.toArray();
}
export async function saveResource(resource) {
  await db.resources.put(resource);
}
export async function saveLog(log) {
  await db.logs.add(log);
}
export async function removeResource(id) {
  await db.transaction("rw", db.resources, db.logs, async () => {
    await db.logs.where("resourceId").equals(id).delete();
    await db.resources.delete(id);
  });
}
export async function getSetting(key, fallback) {
  return (await db.settings.get(key))?.value ?? fallback;
}
export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}
