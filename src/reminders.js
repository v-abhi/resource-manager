import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { evaluate, status } from "./resource-engine.js";

const IDS = [81001, 81002];
export const reminderSupported = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
const amount = n => Number(n).toLocaleString("en-IN", {maximumFractionDigits: 2});
function summary(resources, logs) {
  const now = new Date();
  const active = resources.filter(r => !r.archived && status(r, now) === "Active");
  if (!active.length) return "No active resources yet.";
  const lines = active.slice(0, 5).map(r => {
    const balance = evaluate(r, logs.filter(l => l.resourceId === r.id), now).available;
    return `${r.name}: ${amount(balance)} ${r.unit}${balance < 0 ? " (debt)" : " left"}`;
  });
  if (active.length > 5) lines.push(`+${active.length - 5} more — open app`);
  return lines.join(" · ");
}
async function permission() {
  let p = await LocalNotifications.checkPermissions();
  if (p.display !== "granted") p = await LocalNotifications.requestPermissions();
  if (p.display !== "granted") throw new Error("Notification permission denied in Android settings.");
}
let lastFingerprint = "";
export async function syncReminders(settings, resources, logs, requestPermission = false) {
  if (!reminderSupported()) return;
  const enabled = settings.morning || settings.evening;
  if (requestPermission && enabled) await permission();
  const current = await LocalNotifications.checkPermissions();
  if (enabled && current.display !== "granted") return;
  const fingerprint = JSON.stringify({settings, resources, logs});
  if (!requestPermission && fingerprint === lastFingerprint) return;
  const pending = await LocalNotifications.getPending();
  const ours = pending.notifications.filter(n => IDS.includes(n.id)).map(n => ({id:n.id}));
  if (ours.length) await LocalNotifications.cancel({notifications:ours});
  const notifications = [];
  for (const [enabledFlag, time, id, label] of [[settings.morning, settings.morningTime, IDS[0], "Morning"], [settings.evening, settings.eveningTime, IDS[1], "Evening"]]) {
    if (!enabledFlag || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || "")) continue;
    const [h,m] = time.split(":").map(Number);
    const next = new Date(); next.setHours(h,m,0,0);
    if (next <= new Date()) next.setDate(next.getDate()+1);
    notifications.push({id, title:`${label} resource summary`, body:summary(resources, logs), schedule:{at:next, repeats:true}});
  }
  if (notifications.length) await LocalNotifications.schedule({notifications});
  lastFingerprint = fingerprint;
}
export async function showTestReminder(resources, logs) {
  if (!reminderSupported()) throw new Error("Test notifications require the Android APK.");
  await permission();
  await LocalNotifications.schedule({notifications:[{id:81003,title:"Resource Manager · Test",body:summary(resources,logs),schedule:{at:new Date(Date.now()+5000)}}]});
}
