import "./style.css";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { backTarget } from "./navigation-logic.js";
import { StatusBar } from "@capacitor/status-bar";
import { syncReminders, reminderSupported, showTestReminder } from "./reminders.js";
import {
  resources,
  logsFor,
  allLogs,
  saveResource,
  saveLog,
  removeResource,
  getSetting,
  setSetting,
} from "./db.js";
import {
  evaluate,
  localStamp,
  localDay,
  status,
  round,
  allowsDebt,
  canConsumeResource,
} from "./resource-engine.js";
import { reportFor } from "./reports.js";
import { exportBackup, restoreBackup, exportCSV } from "./backup.js";

const $ = (s) => document.querySelector(s);
const app = $("#app");
const state = {
  page: "home",
  id: null,
  resources: [],
  logs: [],
  theme: "system",
  reminders: { morning: false, morningTime: "06:00", evening: false, eveningTime: "18:00" },
  from: "",
  to: "",
  showHidden: false,
  analyticsDays: 7,
  analyticsMode: "7D",
  customFrom: "",
  customTo: "",
  expanded: null,
  listPrefs: { home: { sort: "manual", frequency: "all" }, analytics: { sort: "manual", frequency: "all" }, all: { sort: "az" } },
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n, d = 2) =>
  Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: d });
const money = (n) => "₹" + fmt(n);
const unit = (n, r) => {
  const numeric = Number(n) || 0;
  const negative = numeric < 0 ? "−" : "";
  if (["₹", "INR", "Rs", "Rs."].includes(String(r.unit).trim())) return `${negative}₹${fmt(Math.abs(numeric))}`;
  return `${negative}${fmt(Math.abs(numeric))} ${esc(r.unit)}`;
};
const unique = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const dateLabel = (x) =>
  new Date(x).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const today = () => localDay(new Date());
const notify = (message, error = false) => {
  const e = $("#toast");
  if (!e) return;
  e.textContent = message;
  e.classList.toggle("error", error);
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 3500);
};
const getR = (id) => state.resources.find((r) => r.id === id);
const isFlexible = allowsDebt;
const canConsume = canConsumeResource;
let lastBackAt = 0;
const logOf = (id) => state.logs.filter((x) => x.resourceId === id);
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  updateStatusBar().catch(console.warn);
}
async function updateStatusBar() {
  if (!Capacitor.isNativePlatform()) return;
  await StatusBar.show();
  // On Android 15+ our native container receives WindowInsets. The top
  // system-bar strip is light in both themes so Android icons must be dark.
  // setOverlaysWebView(false) alone does not fix Android 15+ edge-to-edge.
  await StatusBar.setOverlaysWebView({ overlay: false });
  await StatusBar.setBackgroundColor({ color: "#f6f8fc" });
  // Native MainActivity controls the icon foreground; avoid plugin races.
}
function closeSheetImmediately() {
  const sheet = document.querySelector("#sheet-root");
  if (!sheet?.querySelector(".action-sheet")) return false;
  sheet.replaceChildren();
  return true;
}
function navigateBack() {
  // Filter duplicate Android back events within one gesture.
  const now = Date.now();
  if (now - lastBackAt < 220) return;
  lastBackAt = now;
  const action = backTarget(state.page, !!document.querySelector("#sheet-root .action-sheet"));
  if (action === "dismiss-sheet") { closeSheetImmediately(); return; }
  if (action === "all" || action === "home") { go(action); return; }
  if (action === "exit" && Capacitor.isNativePlatform()) App.exitApp().catch(console.warn);
}
function setupAndroidBack() {
  if (!Capacitor.isNativePlatform()) return;
  // This is invoked directly by MainActivity for modern Android back gestures.
  // Register before awaiting database initialization to avoid any dead period.
  window.__resourceManagerBack = navigateBack;
  window.addEventListener("resource-manager:native-back", navigateBack);
  // Capacitor's own listener covers devices where native gesture dispatch
  // enters the plugin rather than our MainActivity callback.
  App.addListener("backButton", navigateBack).catch(console.warn);
}
async function refresh() {
  state.resources = (await resources()).map(r => ({...r, allowNegative: isFlexible(r)}));
  state.logs = await allLogs();
  render();
  syncReminders(state.reminders, state.resources, state.logs).catch(console.warn);
}
function shell(content) {
  const labels = { home: "My Resources", analytics: "Analytics", all: "Resources", edit: "Resource setup", settings: "Settings" };
  const tab = state.page === "edit" ? "all" : state.page;
  app.innerHTML = `<div class="app-shell"><header class="topbar compact-top"><div><h1>${labels[state.page] || "Resource Manager"}</h1>${state.page === "home" ? `<div class="muted small">${state.resources.filter(r=>!r.archived && status(r)==="Active").length} active · Today</div>` : ""}</div>${["home","all"].includes(state.page) ? '<button class="mini-btn" id="top-new">＋ New</button>' : '<span class="top-logo">◈</span>'}</header><main class="content compact-content">${content}</main><nav class="nav">${[["home","⌂","Home"],["analytics","▥","Analytics"],["all","▦","Resources"],["settings","⚙","Settings"]].map(([key,icon,label])=>`<button data-nav="${key}" class="${tab===key?"active":""}"><span>${icon}</span>${label}</button>`).join("")}</nav></div><div id="sheet-root"></div><div id="toast" role="status"></div>`;
  document.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>go(b.dataset.nav));
  $("#top-new")?.addEventListener("click",()=>go("edit"));
}
function go(page,id=null) {
  state.page=page;
  state.id=id;
  render();
  window.scrollTo({top:0,behavior:"instant"});
}
const frequencyOptions = ["all", "hourly", "daily", "weekly", "monthly", "yearly"];
const sortOptions = [
  ["manual", "My order"], ["az", "Name A–Z"], ["za", "Name Z–A"],
  ["low", "Lowest remaining %"], ["high", "Highest remaining %"],
  ["used", "Highest consumed %"], ["expired", "Highest expired %"],
];
function listControls(page) {
  const prefs = state.listPrefs[page];
  const options = page === "all" ? [["az", "Name A–Z"], ["za", "Name Z–A"]] : page === "home" ? sortOptions.filter(([value]) => value !== "expired") : sortOptions;
  return `<div class="list-controls"><label class="list-control"><span>Sort</span><select data-list-sort="${page}" aria-label="Sort resources">${options.map(([value,label]) => `<option value="${value}" ${prefs.sort===value?"selected":""}>${label}</option>`).join("")}</select></label>${page === "all" ? "" : `<label class="list-control"><span>Show</span><select data-list-frequency="${page}" aria-label="Filter by replenishment period">${frequencyOptions.map(value => `<option value="${value}" ${prefs.frequency===value?"selected":""}>${value === "all" ? "All periods" : value.charAt(0).toUpperCase()+value.slice(1)}</option>`).join("")}</select></label>`}</div>`;
}
function wireListControls() {
  document.querySelectorAll("[data-list-sort]").forEach(select => select.onchange = () => {
    state.listPrefs[select.dataset.listSort].sort = select.value;
    render();
  });
  document.querySelectorAll("[data-list-frequency]").forEach(select => select.onchange = () => {
    state.listPrefs[select.dataset.listFrequency].frequency = select.value;
    render();
  });
}
function orderedResources(list, page, statsFor = null) {
  const prefs = state.listPrefs[page];
  const filtered = list.filter(r => !prefs.frequency || prefs.frequency === "all" || r.frequency === prefs.frequency);
  if (prefs.sort === "manual") return filtered;
  const getStats = r => {
    if (statsFor) {
      const stats = statsFor(r);
      return { remaining: Math.max(0, 100 - stats.consumedPct - stats.expiredPct), used: stats.consumedPct, expired: stats.expiredPct };
    }
    const e = evaluate(r, logOf(r.id));
    const p = e.periods.at(-1);
    const base = Math.max(0, (p?.opening ?? Number(r.initial)) + (p?.added ?? 0));
    const remaining = base > 0 ? Math.max(0, Math.min(100, 100 * e.available / base)) : 0;
    return { remaining, used: base > 0 ? 100 * (p?.used ?? 0) / base : 0, expired: base > 0 ? 100 * (p?.lost ?? 0) / base : 0 };
  };
  return [...filtered].sort((a,b) => {
    if (prefs.sort === "az") return a.name.localeCompare(b.name);
    if (prefs.sort === "za") return b.name.localeCompare(a.name);
    const av = getStats(a), bv = getStats(b);
    const key = prefs.sort === "low" || prefs.sort === "high" ? "remaining" : prefs.sort === "expired" ? "expired" : "used";
    const difference = (prefs.sort === "low" ? av[key] - bv[key] : bv[key] - av[key]);
    return difference || a.name.localeCompare(b.name);
  });
}
function card(r,now=new Date()) {
  const s=evaluate(r,logOf(r.id),now), p=s.periods.at(-1), st=status(r,now);
  const available=st==="Scheduled"?Number(r.initial):s.available;
  // Opening allocation plus manual additions during this window.
  const allocation=Math.max(0,(p?.opening??Number(r.initial))+(p?.added??0));
  const pct=allocation>0?Math.max(0,Math.min(100,Math.round(available/allocation*100))):0;
  const frequencyLabel = ({ hourly: "Hourly", daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" })[r.frequency] || r.frequency || "—";
  return `<button class="resource-card compact-card" data-open="${esc(r.id)}" ${st!=="Active"?"disabled":""}><div class="compact-card-row"><span class="emoji compact-emoji">${esc(r.emoji||"◈")}</span><span class="compact-resource-info"><strong class="compact-name">${esc(r.name)}</strong><small class="compact-frequency">${esc(frequencyLabel)}</small></span><span class="compact-metric used-metric"><small class="compact-metric-label">Today</small><span class="used-now">↗ ${unit(s.todayUsed,r)}</span></span><span class="compact-metric remaining-metric"><small class="compact-metric-label">${available < 0 ? "Debt" : "Available"}</small><span class="remaining-now ${available<0?"negative-balance":""}">${unit(available,r)}${available < 0 ? "" : ` <small>(${pct}%)</small>`}</span></span></div><div class="split-bar"><span class="bar-used" style="width:${100-pct}%"></span><span class="bar-left" style="width:${pct}%"></span></div></button>`;
}
function home() {
  const now=new Date(),active=orderedResources(state.resources.filter(r=>!r.archived && status(r,now)==="Active"), "home");
  shell(`${listControls("home")}${active.length?`<div class="compact-stack">${active.map(r=>card(r,now)).join("")}</div>`:`<div class="empty"><h3>No active resources</h3><p>Create a resource to start tracking.</p><button class="primary" id="create-first">Create resource</button></div>`}<div class="legend"><span><i class="dot yellow"></i>Consumed</span><span><i class="dot green"></i>Remaining</span></div>`);
  wireListControls();
  $("#create-first")?.addEventListener("click",()=>go("edit"));
  document.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openSheet(b.dataset.open));
}
function openSheet(id) {
  const r = getR(id);
  if (!r || status(r) !== "Active") return;
  const root = $("#sheet-root");
  const s = evaluate(r, logOf(id));
  const flexible = isFlexible(r);
  root.innerHTML = `<div class="sheet-backdrop" id="sheet-backdrop"></div><section class="action-sheet" role="dialog" aria-modal="true" aria-label="Update ${esc(r.name)}"><div class="sheet-handle"></div><div class="sheet-head"><strong>${esc(r.emoji||"◈")} ${esc(r.name)}</strong><button class="icon-button" id="close-sheet" aria-label="Close">✕</button></div><div class="sheet-tabs"><button class="selected" data-kind="consume">− Consume</button><button data-kind="add">＋ Add</button></div><form id="quick-log"><p class="limit-note ${flexible ? "limit-flexible" : "limit-strict"}">${flexible ? "Flexible · Spending beyond the balance is allowed. Debt carries forward." : "Strict · Consumption cannot exceed the available balance."}</p><label class="field">Quantity (${esc(r.unit)})<input id="quick-amount" type="number" min="0.000001" step="any" inputmode="decimal" required placeholder="Enter amount"/></label><div class="sheet-preview"><span>Available now</span><strong class="${s.available < 0 ? "negative-balance" : ""}">${unit(s.available,r)}</strong></div><div class="sheet-preview"><span>After update</span><strong id="preview-value">—</strong></div><p id="limit-feedback" class="limit-feedback" role="status"></p><button class="primary wide" type="submit" id="confirm-log">Confirm consumption</button></form></section>`;
  let kind = "consume";
  const close = () => { root.replaceChildren(); };
  $("#sheet-backdrop").onclick = close;
  $("#close-sheet").onclick = close;
  const update = () => {
    const raw = $("#quick-amount").value;
    const amount = Number(raw);
    const valid = raw !== "" && Number.isFinite(amount) && amount > 0;
    const balanceAfter = s.available + (kind === "add" ? amount : -amount);
    const preview = $("#preview-value");
    preview.textContent = valid ? unit(balanceAfter,r) + (balanceAfter < 0 ? " · Debt" : "") : "—";
    preview.classList.toggle("negative-balance", valid && balanceAfter < 0);
    const blocked = valid && kind === "consume" && !canConsume(r, amount, s.available);
    $("#limit-feedback").textContent = blocked ? `Exceeds strict limit by ${unit(amount-Math.max(0,s.available),r)}. Change resource to Flexible to allow it.` : "";
    $("#confirm-log").disabled = blocked;
  };
  $("#quick-amount").oninput = update;
  root.querySelectorAll("[data-kind]").forEach(b => b.onclick = () => {
    kind = b.dataset.kind;
    root.querySelectorAll("[data-kind]").forEach(x => x.classList.toggle("selected", x === b));
    $("#confirm-log").textContent = kind === "consume" ? "Confirm consumption" : "Confirm addition";
    update();
  });
  $("#quick-log").onsubmit = async e => {
    e.preventDefault();
    const amount = Number($("#quick-amount").value);
    if (!Number.isFinite(amount) || amount <= 0) return notify("Enter a positive quantity.",true);
    const current = evaluate(r, logOf(id)).available;
    if (kind === "consume" && !canConsume(r,amount,current)) {
      update();
      return notify("Strict limit is enabled. Edit this resource and choose Flexible to allow debt.",true);
    }
    try {
      await saveLog({ id:unique(), resourceId:id, kind, amount:round(amount), timestamp:new Date().toISOString() });
      root.replaceChildren();
      await refresh();
      const after = evaluate(r,logOf(id)).available;
      notify(after < 0 ? `Saved · Debt: ${unit(Math.abs(after),r)}` : `Saved · Available: ${unit(after,r)}`);
    } catch (error) { notify("Could not save transaction: " + error.message,true); }
  };
  $("#quick-amount").focus();
}
function all() {
  const list=orderedResources(state.resources.filter(r=>state.showHidden||!r.archived), "all");
  shell(`${listControls("all")}<label class="inline-check compact-check"><input type="checkbox" id="show-all" ${state.showHidden?"checked":""}/> Show archived resources</label><div class="compact-stack">${list.map(r=>`<div class="manage-row"><span class="emoji compact-emoji">${esc(r.emoji||"◈")}</span><div class="manage-info"><strong>${esc(r.name)}${r.archived?' <small class="muted">(Archived)</small>':''}</strong><span class="muted small">${unit(r.refill,r)}/${esc(r.frequency)} · ↪ ${fmt(r.carry)}% · ${isFlexible(r)?"Flexible":"Strict"} · ${status(r)}</span></div><button class="icon-button" data-edit="${esc(r.id)}" aria-label="Edit ${esc(r.name)}">✎</button><button class="icon-button" data-menu="${esc(r.id)}" aria-label="More options for ${esc(r.name)}">⋮</button></div>`).join("")||'<div class="empty">No resources to show.</div>'}</div>`);
  wireListControls();
  $("#show-all").onchange=e=>{state.showHidden=e.target.checked;render()};
  document.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>go("edit",b.dataset.edit));
  document.querySelectorAll("[data-menu]").forEach(b=>b.onclick=async()=>{const r=getR(b.dataset.menu);if(!r)return;const choice=prompt(`${r.name}\nType ${r.archived?'RESTORE':'ARCHIVE'} to ${r.archived?'restore':'archive'} or DELETE to permanently remove:`);if(!choice)return;const action=choice.trim().toUpperCase();if(action===(r.archived?"RESTORE":"ARCHIVE")){await saveResource({...r,archived:!r.archived});await refresh();notify(r.archived?"Resource restored.":"Resource archived.")}else if(action==="DELETE"&&confirm(`Permanently delete ${r.name} and all its logs?`)){await removeResource(r.id);await refresh();notify("Resource deleted.")}});
}
function analyticsRange() {
  const now = new Date();
  const todayKey = localDay(now);
  let fromKey, toKey = todayKey;
  if (state.analyticsMode === "Custom") {
    fromKey = state.customFrom;
    toKey = state.customTo;
    if (!fromKey || !toKey || fromKey > toKey || toKey > todayKey) return null;
  } else {
    const days = Number.parseInt(state.analyticsMode, 10) || 7;
    const first = new Date(now);
    first.setHours(0, 0, 0, 0);
    first.setDate(first.getDate() - days + 1);
    fromKey = localDay(first);
  }
  const start = new Date(`${fromKey}T00:00:00`);
  const requestedEnd = new Date(`${toKey}T23:59:59.999`);
  const end = new Date(Math.min(+requestedEnd, +now));
  const keys = [];
  for (const day = new Date(start); +day <= +end; day.setDate(day.getDate() + 1)) {
    keys.push(localDay(day));
    if (keys.length > 3660) return null;
  }
  return { start, end, keys, fromKey, toKey };
}
function analyticsStats(r, range) {
  const logs = logOf(r.id);
  const result = evaluate(r, logs, range.end);
  const dayUsed = new Map(range.keys.map(k => [k, 0]));
  for (const l of logs) {
    if (l.kind !== "consume") continue;
    const key = localDay(new Date(l.timestamp));
    if (dayUsed.has(key) && +new Date(l.timestamp) <= +range.end) {
      dayUsed.set(key, dayUsed.get(key) + Number(l.amount));
    }
  }
  const consumed = round([...dayUsed.values()].reduce((a, b) => a + b, 0));
  // Closed periods are counted by their actual ending date, not by the current balance.
  const expired = Math.max(0, round(result.periods.filter(p => p.closed &&
    localDay(new Date(p.end)) >= range.fromKey &&
    localDay(new Date(p.end)) <= range.toKey).reduce((sum, p) => sum + p.lost, 0)));
  // Available balance is unresolved only if this reporting window reaches the present.
  const unresolved = range.toKey === localDay(new Date()) ? Math.max(0, result.available) : 0;
  const total = round(consumed + expired + unresolved);
  const windowAllocation = Math.max(0, result.periods.filter(p => localDay(new Date(p.end)) >= range.fromKey && localDay(new Date(p.start)) <= range.toKey).reduce((sum,p) => sum + Math.max(0,p.opening+p.added),0));
  const consumedPct = windowAllocation > 0 ? 100 * consumed / windowAllocation : (total > 0 ? 100 * consumed / total : 0);
  const expiredPct = windowAllocation > 0 ? 100 * expired / windowAllocation : 0;
  const trend = range.keys.map(key => {
    const used = dayUsed.get(key) || 0;
    const periods = result.periods.filter(p => localDay(new Date(p.start)) <= key && localDay(new Date(p.end)) >= key);
    const base = periods.reduce((sum, p) => sum + Math.max(0, p.opening + p.added), 0);
    return { date: key, used, pct: base > 0 ? 100 * used / base : 0 };
  });
  return { consumed, expired, unresolved, total, consumedPct, expiredPct, trend, debt: range.toKey === localDay(new Date()) ? Math.max(0, -result.available) : 0 };
}
function analytics() {
  const range = analyticsRange();
  const mode = state.analyticsMode;
  const resourcesList = orderedResources(state.resources.filter(r => !r.archived), "analytics", range ? r => analyticsStats(r, range) : null);
  const selector = `<div class="period-tabs analytics-tabs">${["7D","30D","90D","Custom"].map(n => `<button data-period="${n}" class="${mode === n ? 'selected' : ''}">${n}</button>`).join('')}</div>`;
  const custom = mode === "Custom" ? `<form id="analytics-custom" class="analytics-custom"><label>From<input id="analytics-from" type="date" max="${today()}" value="${esc(state.customFrom)}" required></label><label>To<input id="analytics-to" type="date" max="${today()}" value="${esc(state.customTo)}" required></label><button type="submit" class="primary">Apply</button></form>` : '';
  const list = range ? resourcesList.map(r => {
    const stats = analyticsStats(r, range);
    const open = state.expanded === r.id;
    const barBase = Math.max(100, stats.consumedPct + stats.expiredPct);
    const consumptionWidth = 100 * stats.consumedPct / barBase;
    const expiryWidth = 100 * stats.expiredPct / barBase;
    return `<section class="analytics-item"><div class="analytics-summary"><div class="analytics-summary-top"><span class="analytics-resource-name">${esc(r.emoji || '◈')} &nbsp;${esc(r.name)}</span><span class="analytics-percent analytics-consumed">${fmt(stats.consumedPct, 1)}%</span><span class="analytics-percent analytics-expired">${fmt(stats.expiredPct, 1)}%</span><button type="button" class="analytics-expand" data-expand="${esc(r.id)}" aria-label="${open ? 'Hide' : 'Show'} details for ${esc(r.name)}" aria-expanded="${open}"><svg class="analytics-chart-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/></svg></button></div>${stats.debt > 0 ? `<div class="analytics-debt">Debt: ${unit(stats.debt,r)}</div>` : ""}<div class="analytics-bar"><span class="analytics-bar-consumed" style="width:${consumptionWidth}%"></span><span class="analytics-bar-expired" style="width:${expiryWidth}%"></span><span class="analytics-bar-rest" style="width:${Math.max(0,100-consumptionWidth-expiryWidth)}%"></span></div></div>${open ? analyticsDetail(r, stats, range) : ''}</section>`;
  }).join('') : '<div class="empty">Choose a valid date range and tap Apply.</div>';
  shell(`${selector}${custom}${listControls("analytics")}<div class="analytics-legend"><span><i class="dot yellow"></i>Consumed</span><span><i class="dot red"></i>Expired</span></div><div class="compact-stack">${list || '<div class="empty">No resources yet.</div>'}</div>`);
  wireListControls();
  document.querySelectorAll('[data-period]').forEach(b => b.onclick = () => {
    state.analyticsMode = b.dataset.period;
    if (state.analyticsMode === 'Custom' && !state.customFrom) {
      state.customFrom = today(); state.customTo = today();
    }
    render();
  });
  $('#analytics-custom')?.addEventListener('submit', e => {
    e.preventDefault();
    const from = $('#analytics-from').value, to = $('#analytics-to').value;
    if (!from || !to || from > to || to > today()) return notify('Choose a valid date range.', true);
    state.customFrom = from; state.customTo = to; render();
  });
  document.querySelectorAll('[data-expand]').forEach(b => b.onclick = () => {
    state.expanded = state.expanded === b.dataset.expand ? null : b.dataset.expand;
    render();
  });
  document.querySelectorAll('[data-chart-point]').forEach(b => b.onclick = () => {
    const p = JSON.parse(decodeURIComponent(b.dataset.chartPoint));
    notify(`${p.date}: ${fmt(p.pct, 1)}% consumed · ${fmt(p.used)} used`);
  });
}
function analyticsDetail(r, stats, range) {
  const { total, consumed, expired, unresolved, trend, debt } = stats;
  const days = trend.length;
  const W = 340, left = 38, right = 330, top = 12, bottom = 130;
  const maxY = Math.max(100, Math.ceil(Math.max(...trend.map(d => d.pct), 100) / 25) * 25);
  const points = trend.map((d, i) => ({ x: left + i * (right - left) / Math.max(1, days - 1), y: bottom - d.pct * (bottom - top) / maxY, ...d }));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const sundays = points.filter(p => new Date(`${p.date}T12:00:00`).getDay() === 0);
  const step = days <= 7 ? 1 : days <= 45 ? 1 : Math.max(2, Math.ceil(sundays.length / 7));
  const ticks = days <= 7 ? points : sundays.filter((p, i) => i % step === 0);
  const labels = ticks.map(p => {
    const d = new Date(`${p.date}T12:00:00`);
    return `<text x="${p.x}" y="151" text-anchor="middle" font-size="${days <= 7 ? 9 : 10}" fill="currentColor" opacity=".65">${days <= 7 ? d.getDate() : `${d.getDate()} ${d.toLocaleString('en-GB', {month:'short'})}`}</text>`;
  }).join('');
  const grid = [0, .25, .5, .75, 1].map(f => {
    const v = Math.round(f * maxY);
    const y = bottom - f * (bottom - top);
    return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="currentColor" stroke-opacity=".12" stroke-dasharray="3 4"/><text x="30" y="${y + 3}" text-anchor="end" font-size="10" fill="currentColor" opacity=".55">${v}%</text>`;
  }).join('');
  const dots = days <= 7 ? points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#E9B949"/>`).join('') : '';
  return `<div class="analytics-detail"><div class="kpi-row"><div><small>Total</small><strong>${unit(total,r)}</strong></div><div><small>Consumed</small><strong class="yellow-text">${unit(consumed,r)}</strong></div><div><small>Expired</small><strong class="red-text">${unit(expired,r)}</strong></div></div>${unresolved > 0 ? `<p class="muted small unresolved-note">${unit(unresolved,r)} currently available (not expired)</p>` : ''}${debt > 0 ? `<p class="negative-balance small unresolved-note">Debt carried by this resource: ${unit(debt,r)}</p>` : ''}<div class="chart-heading">Daily consumption trend</div><div class="chart-scroll"><svg class="trend-chart" viewBox="0 0 ${W} 165" role="img" aria-label="Daily consumption percentages over selected date range">${grid}<path d="${path}" stroke="#E9B949" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" fill="none"/>${dots}${labels}</svg></div><p class="muted small">Daily percentages use each day's resource-window allocation.</p></div>`;
}
function edit() {
  const existing = state.id ? getR(state.id) : null;
  const now = new Date(),
    end = new Date(now);
  end.setDate(end.getDate() + 30);
  end.setMinutes(end.getMinutes() - 1);
  const r = existing || {
    name: "",
    emoji: "◈",
    unit: "GB",
    initial: 2,
    frequency: "daily",
    refill: 2,
    carry: 0,
    allowNegative: false,
    start: localStamp(now),
    end: localStamp(end),
    moneyRate: 0,
    timeRate: 0,
  };
  shell(
    `<div class="section-head"><button class="text-btn" id="back">← Back</button></div><div class="panel"><h2>${existing ? "Edit resource" : "Create resource"}</h2><p class="muted small">One resource = one independently configured balance.</p><form id="resource-form"><label class="field">Resource name<input name="name" required maxlength="65" value="${esc(r.name)}" placeholder="e.g. Airtel Data"/></label><div class="fields-2"><label class="field">Symbol / Emoji<input name="emoji" maxlength="6" value="${esc(r.emoji)}" placeholder="📶"/></label><label class="field">Unit<input name="unit" required maxlength="18" value="${esc(r.unit)}" placeholder="GB, ₹, min"/></label></div><label class="field">Starting quantity<input name="initial" type="number" min="0" step="any" required value="${esc(r.initial)}"/></label><label class="field">Resource window<select name="frequency">${["hourly", "daily", "weekly", "monthly"].map((f) => `<option value="${f}" ${r.frequency === f ? "selected" : ""}>${f.charAt(0).toUpperCase() + f.slice(1)}</option>`).join("")}</select></label><div class="fields-2"><label class="field">Replenish each window<input name="refill" type="number" min="0" step="any" required value="${esc(r.refill)}"/></label><label class="field">Carry forward (%)<input name="carry" type="number" min="0" max="100" step="any" required value="${esc(r.carry)}"/></label></div><label class="field"><span>Consumption limit</span><select name="allowNegative"><option value="false" ${!isFlexible(r)?"selected":""}>Strict — prevent negative balance</option><option value="true" ${isFlexible(r)?"selected":""}>Flexible — allow negative balance</option></select></label><p class="muted small">For example, 10,000 minus 12,000 = −2,000. With 100% carry-forward, next +10,000 becomes 8,000.</p><div class="fields-2"><label class="field">Start date & time<input name="start" type="datetime-local" required value="${esc(r.start)}"/></label><label class="field">End date & time<input name="end" type="datetime-local" required value="${esc(r.end)}"/></label></div><div class="divider"></div><h3>Optional equivalents</h3><p class="muted small">Value of ONE unit. Used for reports, not actual cash transactions.</p><div class="fields-2"><label class="field">₹ per unit<input name="moneyRate" type="number" min="0" step="any" value="${esc(r.moneyRate)}"/></label><label class="field">Minutes per unit<input name="timeRate" type="number" min="0" step="any" value="${esc(r.timeRate)}"/></label></div>${existing && logOf(existing.id).length ? '<p class="warning">Changing window rules or starting quantity will recalculate earlier balances. Export a backup first.</p>' : ""}<button type="submit" class="primary wide">${existing ? "Save changes" : "Create resource"}</button></form></div>`,
  );
  $("#back").onclick = () => go("all");
  $("#resource-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const data = Object.fromEntries(f.entries());
    data.allowNegative = data.allowNegative === "true";
    for (const k of ["initial", "refill", "carry", "moneyRate", "timeRate"])
      data[k] = Number(data[k] || 0);
    if (+new Date(data.end) <= +new Date(data.start))
      return notify("End must be after start.", true);
    if (
      ["initial", "refill", "moneyRate", "timeRate"].some(
        (k) => !Number.isFinite(data[k]) || data[k] < 0,
      ) ||
      data.carry < 0 ||
      data.carry > 100
    )
      return notify("Please check the amounts and percentages.", true);
    if (!["hourly", "daily", "weekly", "monthly"].includes(data.frequency))
      return notify("Invalid resource window.", true);
    const item = {
      ...(existing || {}),
      ...data,
      id: existing?.id || unique(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    await saveResource(item);
    await refresh();
    go("all");
    notify("Resource saved.");
  };
}
function settings() {
  shell(
    `<div class="panel"><h2>Appearance</h2><label class="field">Theme<select id="theme"><option value="system">System default</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div><div class="panel"><h2>Daily reminders 🔔</h2><p class="muted small">Two optional local notifications with a snapshot of active resource balances. Times use your phone clock.</p><label class="reminder-row"><span>Morning reminder</span><input type="checkbox" id="morning-on" ${state.reminders.morning?"checked":""}/></label><label class="field">Morning time<input type="time" id="morning-time" value="${esc(state.reminders.morningTime)}"/></label><label class="reminder-row"><span>Evening reminder</span><input type="checkbox" id="evening-on" ${state.reminders.evening?"checked":""}/></label><label class="field">Evening time<input type="time" id="evening-time" value="${esc(state.reminders.eveningTime)}"/></label><button class="secondary wide" id="save-reminders">Save reminder settings</button><button class="secondary wide" id="test-reminder">Send test notification</button><p class="muted small">${reminderSupported()?"Android local notifications available. Allow notifications when prompted.":"Reminder times can be saved here; scheduled notifications require the Android APK."} Notifications show the latest snapshot saved when the app was last opened or updated.</p></div><div class="panel"><h2>Backup & restore</h2><p class="muted small">Your data stays on this device until you choose to export it. Save backup JSON in Downloads or Drive using your phone's available save/share options.</p><button id="backup" class="secondary wide">↓ Backup JSON file</button><button id="restore" class="secondary wide">↑ Restore JSON file</button><input id="restore-file" type="file" accept="application/json,.json" hidden/><button id="csv" class="secondary wide">↓ Export transactions CSV</button></div><div class="panel"><h2>About</h2><p class="muted">Resource Manager v1.2 · Android Safe Bar + Back Fix · Offline-first.</p><p class="muted small">Back up before clearing browser data or moving from PWA to APK. Their storage is separate.</p></div>`,
  );
  $("#save-reminders").onclick = async () => {
    state.reminders = { morning: $("#morning-on").checked, morningTime: $("#morning-time").value, evening: $("#evening-on").checked, eveningTime: $("#evening-time").value };
    await setSetting("reminders", state.reminders);
    try { await syncReminders(state.reminders, state.resources, state.logs, true); notify("Reminder settings saved."); }
    catch(e) { notify("Settings saved, but notifications could not be scheduled: " + e.message, true); }
  };
  $("#test-reminder").onclick = async () => {
    try { await showTestReminder(state.resources, state.logs); notify("Test notification requested."); }
    catch(e) { notify(e.message, true); }
  };
  $("#theme").value = state.theme;
  $("#theme").onchange = async (e) => {
    state.theme = e.target.value;
    await setSetting("theme", state.theme);
    applyTheme();
  };
  $("#backup").onclick = async () => {
    try {
      await exportBackup();
      notify("Backup file ready.");
    } catch (e) {
      notify(e.message, true);
    }
  };
  $("#restore").onclick = () => $("#restore-file").click();
  $("#restore-file").onchange = async (e) => {
    try {
      const restored = await restoreBackup(e.target.files[0]);
      if (restored) {
        state.reminders = await getSetting("reminders", state.reminders);
        await refresh();
        notify("Backup restored.");
      }
    } catch (err) {
      notify(err.message, true);
    }
    e.target.value = "";
  };
  $("#csv").onclick = async () => {
    try {
      await exportCSV(
        state.logs,
        new Map(state.resources.map((r) => [r.id, r])),
      );
      notify("CSV exported.");
    } catch (e) {
      notify(e.message, true);
    }
  };
}
function render() {
  switch (state.page) {
    case "home":
      home();
      break;
    case "all":
      all();
      break;

    case "edit":
      edit();
      break;
    case "analytics":
      analytics();
      break;
    case "settings":
      settings();
      break;
    default:
      home();
  }
}
async function init() {
  state.theme = await getSetting("theme", "system");
  state.reminders = await getSetting("reminders", state.reminders);
  applyTheme();
  setupAndroidBack();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => updateStatusBar().catch(console.warn));
  await refresh();
  state.expanded=state.resources.find(r=>!r.archived)?.id||null;
  render();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !["edit"].includes(state.page)) refresh();
  });
}
init().catch((e) => {
  console.error(e);
  app.innerHTML =
    '<div class="fatal">Could not open local database. Please reload the app.</div>';
});
