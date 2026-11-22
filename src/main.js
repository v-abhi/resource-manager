import "./style.css";
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
  from: "",
  to: "",
  showHidden: false,
  analyticsDays: 7,
  analyticsMode: "7D",
  customFrom: "",
  customTo: "",
  expanded: null,
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
const unit = (n, r) => `${fmt(n)} ${esc(r.unit)}`;
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
const logOf = (id) => state.logs.filter((x) => x.resourceId === id);
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}
async function refresh() {
  state.resources = await resources();
  state.logs = await allLogs();
  render();
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
function card(r,now=new Date()) {
  const s=evaluate(r,logOf(r.id),now), p=s.periods.at(-1), st=status(r,now);
  const available=Math.max(0,st==="Scheduled"?Number(r.initial):s.available);
  // Opening allocation plus manual additions during this window.
  const allocation=Math.max(0,(p?.opening??Number(r.initial))+(p?.added??0));
  const pct=allocation>0?Math.max(0,Math.min(100,Math.round(available/allocation*100))):0;
  return `<button class="resource-card compact-card" data-open="${esc(r.id)}" ${st!=="Active"?"disabled":""}><div class="compact-card-row"><span class="emoji compact-emoji">${esc(r.emoji||"◈")}</span><strong class="compact-name">${esc(r.name)}</strong><span class="used-now">↗ ${unit(s.todayUsed,r)}</span><span class="remaining-now">${unit(available,r)} <small>(${pct}%)</small></span></div><div class="split-bar"><span class="bar-used" style="width:${100-pct}%"></span><span class="bar-left" style="width:${pct}%"></span></div></button>`;
}
function home() {
  const now=new Date(),active=state.resources.filter(r=>!r.archived && status(r,now)==="Active");
  shell(`${active.length?`<div class="compact-stack">${active.map(r=>card(r,now)).join("")}</div>`:`<div class="empty"><h3>No active resources</h3><p>Create a resource to start tracking.</p><button class="primary" id="create-first">Create resource</button></div>`}<div class="legend"><span><i class="dot yellow"></i>Consumed</span><span><i class="dot green"></i>Remaining</span></div>`);
  $("#create-first")?.addEventListener("click",()=>go("edit"));
  document.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openSheet(b.dataset.open));
}
function openSheet(id) {
  const r=getR(id);if(!r||status(r)!=="Active")return;
  const s=evaluate(r,logOf(id));
  const root=$("#sheet-root");
  root.innerHTML=`<div class="sheet-backdrop" id="sheet-backdrop"></div><section class="action-sheet" role="dialog" aria-modal="true" aria-label="Update ${esc(r.name)}"><div class="sheet-handle"></div><div class="sheet-head"><strong>${esc(r.emoji||"◈")} ${esc(r.name)}</strong><button class="icon-button" id="close-sheet" aria-label="Close">✕</button></div><div class="sheet-tabs"><button class="selected" data-kind="consume">− Consume</button><button data-kind="add">＋ Add</button></div><form id="quick-log"><label class="field">Quantity (${esc(r.unit)})<input id="quick-amount" type="number" min="0.000001" step="any" inputmode="decimal" required placeholder="Enter amount"/></label><div class="sheet-preview"><span>Available now</span><strong>${unit(s.available,r)}</strong></div><div class="sheet-preview"><span>After update</span><strong id="preview-value">—</strong></div><button class="primary wide" type="submit">Confirm consumption</button></form></section>`;
  let kind="consume";
  const close=()=>{root.querySelector(".action-sheet")?.classList.add("closing");root.querySelector(".sheet-backdrop")?.classList.add("closing");setTimeout(()=>root.replaceChildren(),230)};
  $("#sheet-backdrop").onclick=close;$("#close-sheet").onclick=close;
  const update=()=>{const amount=Number($("#quick-amount").value);$("#preview-value").textContent=$("#quick-amount").value&&amount>0?unit(Math.max(0,s.available+(kind==="add"?amount:-amount)),r):"—";};
  $("#quick-amount").oninput=update;
  root.querySelectorAll("[data-kind]").forEach(b=>b.onclick=()=>{kind=b.dataset.kind;root.querySelectorAll("[data-kind]").forEach(x=>x.classList.toggle("selected",x===b));root.querySelector("button[type=submit]").textContent=kind==="consume"?"Confirm consumption":"Confirm addition";update()});
  $("#quick-log").onsubmit=async e=>{e.preventDefault();const amount=Number($("#quick-amount").value);if(!Number.isFinite(amount)||amount<=0)return notify("Enter a positive quantity.",true);const current=evaluate(r,logOf(id)).available;if(kind==="consume"&&amount>current+1e-6)return notify("Quantity exceeds available balance.",true);await saveLog({id:unique(),resourceId:id,kind,amount:round(amount),timestamp:new Date().toISOString()});root.replaceChildren();await refresh();notify("Resource updated.")};
  $("#quick-amount").focus();
}
function all() {
  const list=state.resources.filter(r=>state.showHidden||!r.archived);
  shell(`<label class="inline-check compact-check"><input type="checkbox" id="show-all" ${state.showHidden?"checked":""}/> Show archived resources</label><div class="compact-stack">${list.map(r=>`<div class="manage-row"><span class="emoji compact-emoji">${esc(r.emoji||"◈")}</span><div class="manage-info"><strong>${esc(r.name)}${r.archived?' <small class="muted">(Archived)</small>':''}</strong><span class="muted small">${unit(r.refill,r)}/${esc(r.frequency)} · ↪ ${fmt(r.carry)}% · ${status(r)}</span></div><button class="icon-button" data-edit="${esc(r.id)}" aria-label="Edit ${esc(r.name)}">✎</button><button class="icon-button" data-menu="${esc(r.id)}" aria-label="More options for ${esc(r.name)}">⋮</button></div>`).join("")||'<div class="empty">No resources to show.</div>'}</div>`);
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
  const expired = round(result.periods.filter(p => p.closed &&
    localDay(new Date(p.end)) >= range.fromKey &&
    localDay(new Date(p.end)) <= range.toKey).reduce((sum, p) => sum + p.lost, 0));
  // Available balance is unresolved only if this reporting window reaches the present.
  const unresolved = range.toKey === localDay(new Date()) ? Math.max(0, result.available) : 0;
  const total = round(consumed + expired + unresolved);
  const consumedPct = total > 0 ? 100 * consumed / total : 0;
  const expiredPct = total > 0 ? 100 * expired / total : 0;
  const trend = range.keys.map(key => {
    const used = dayUsed.get(key) || 0;
    const periods = result.periods.filter(p => localDay(new Date(p.start)) <= key && localDay(new Date(p.end)) >= key);
    const base = periods.reduce((sum, p) => sum + Math.max(0, p.opening + p.added), 0);
    return { date: key, used, pct: base > 0 ? Math.min(100, 100 * used / base) : 0 };
  });
  return { consumed, expired, unresolved, total, consumedPct, expiredPct, trend };
}
function analytics() {
  const range = analyticsRange();
  const mode = state.analyticsMode;
  const resourcesList = state.resources.filter(r => !r.archived);
  const selector = `<div class="period-tabs analytics-tabs">${["7D","30D","90D","Custom"].map(n => `<button data-period="${n}" class="${mode === n ? 'selected' : ''}">${n}</button>`).join('')}</div>`;
  const custom = mode === "Custom" ? `<form id="analytics-custom" class="analytics-custom"><label>From<input id="analytics-from" type="date" max="${today()}" value="${esc(state.customFrom)}" required></label><label>To<input id="analytics-to" type="date" max="${today()}" value="${esc(state.customTo)}" required></label><button type="submit" class="primary">Apply</button></form>` : '';
  const list = range ? resourcesList.map(r => {
    const stats = analyticsStats(r, range);
    const open = state.expanded === r.id;
    return `<section class="analytics-item"><div class="analytics-summary"><div class="analytics-summary-top"><span class="analytics-resource-name">${esc(r.emoji || '◈')} &nbsp;${esc(r.name)}</span><span class="analytics-percent analytics-consumed">${fmt(stats.consumedPct, 1)}%</span><span class="analytics-percent analytics-expired">${fmt(stats.expiredPct, 1)}%</span><button type="button" class="analytics-expand" data-expand="${esc(r.id)}" aria-label="${open ? 'Hide' : 'Show'} details for ${esc(r.name)}" aria-expanded="${open}"><svg class="analytics-chart-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/></svg></button></div><div class="analytics-bar"><span class="analytics-bar-consumed" style="width:${stats.consumedPct}%"></span><span class="analytics-bar-expired" style="width:${stats.expiredPct}%"></span><span class="analytics-bar-rest" style="width:${Math.max(0,100-stats.consumedPct-stats.expiredPct)}%"></span></div></div>${open ? analyticsDetail(r, stats, range) : ''}</section>`;
  }).join('') : '<div class="empty">Choose a valid date range and tap Apply.</div>';
  shell(`${selector}${custom}<div class="analytics-legend"><span><i class="dot yellow"></i>Consumed</span><span><i class="dot red"></i>Expired</span></div><div class="compact-stack">${list || '<div class="empty">No resources yet.</div>'}</div>`);
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
  const { total, consumed, expired, unresolved, trend } = stats;
  const days = trend.length;
  const W = 340, left = 38, right = 330, top = 12, bottom = 130;
  const points = trend.map((d, i) => ({ x: left + i * (right - left) / Math.max(1, days - 1), y: bottom - d.pct * (bottom - top) / 100, ...d }));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const sundays = points.filter(p => new Date(`${p.date}T12:00:00`).getDay() === 0);
  const step = days <= 7 ? 1 : days <= 45 ? 1 : Math.max(2, Math.ceil(sundays.length / 7));
  const ticks = days <= 7 ? points : sundays.filter((p, i) => i % step === 0);
  const labels = ticks.map(p => {
    const d = new Date(`${p.date}T12:00:00`);
    return `<text x="${p.x}" y="151" text-anchor="middle" font-size="${days <= 7 ? 9 : 10}" fill="currentColor" opacity=".65">${days <= 7 ? d.getDate() : `${d.getDate()} ${d.toLocaleString('en-GB', {month:'short'})}`}</text>`;
  }).join('');
  const grid = [0,25,50,75,100].map(v => {
    const y = bottom - v * (bottom - top) / 100;
    return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="currentColor" stroke-opacity=".12" stroke-dasharray="3 4"/><text x="30" y="${y + 3}" text-anchor="end" font-size="10" fill="currentColor" opacity=".55">${v}%</text>`;
  }).join('');
  const dots = days <= 7 ? points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#E9B949"/>`).join('') : '';
  return `<div class="analytics-detail"><div class="kpi-row"><div><small>Total</small><strong>${unit(total,r)}</strong></div><div><small>Consumed</small><strong class="yellow-text">${unit(consumed,r)}</strong></div><div><small>Expired</small><strong class="red-text">${unit(expired,r)}</strong></div></div>${unresolved > 0 ? `<p class="muted small unresolved-note">${unit(unresolved,r)} currently available (not expired)</p>` : ''}<div class="chart-heading">Daily consumption trend</div><div class="chart-scroll"><svg class="trend-chart" viewBox="0 0 ${W} 165" role="img" aria-label="Daily consumption percentages over selected date range">${grid}<path d="${path}" stroke="#E9B949" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" fill="none"/>${dots}${labels}</svg></div><p class="muted small">Daily percentages use each day's resource-window allocation.</p></div>`;
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
    start: localStamp(now),
    end: localStamp(end),
    moneyRate: 0,
    timeRate: 0,
  };
  shell(
    `<div class="section-head"><button class="text-btn" id="back">← Back</button></div><div class="panel"><h2>${existing ? "Edit resource" : "Create resource"}</h2><p class="muted small">One resource = one independently configured balance.</p><form id="resource-form"><label class="field">Resource name<input name="name" required maxlength="65" value="${esc(r.name)}" placeholder="e.g. Airtel Data"/></label><div class="fields-2"><label class="field">Symbol / Emoji<input name="emoji" maxlength="6" value="${esc(r.emoji)}" placeholder="📶"/></label><label class="field">Unit<input name="unit" required maxlength="18" value="${esc(r.unit)}" placeholder="GB, ₹, min"/></label></div><label class="field">Starting quantity<input name="initial" type="number" min="0" step="any" required value="${esc(r.initial)}"/></label><label class="field">Resource window<select name="frequency">${["hourly", "daily", "weekly", "monthly"].map((f) => `<option value="${f}" ${r.frequency === f ? "selected" : ""}>${f.charAt(0).toUpperCase() + f.slice(1)}</option>`).join("")}</select></label><div class="fields-2"><label class="field">Replenish each window<input name="refill" type="number" min="0" step="any" required value="${esc(r.refill)}"/></label><label class="field">Carry forward (%)<input name="carry" type="number" min="0" max="100" step="any" required value="${esc(r.carry)}"/></label></div><div class="fields-2"><label class="field">Start date & time<input name="start" type="datetime-local" required value="${esc(r.start)}"/></label><label class="field">End date & time<input name="end" type="datetime-local" required value="${esc(r.end)}"/></label></div><div class="divider"></div><h3>Optional equivalents</h3><p class="muted small">Value of ONE unit. Used for reports, not actual cash transactions.</p><div class="fields-2"><label class="field">₹ per unit<input name="moneyRate" type="number" min="0" step="any" value="${esc(r.moneyRate)}"/></label><label class="field">Minutes per unit<input name="timeRate" type="number" min="0" step="any" value="${esc(r.timeRate)}"/></label></div>${existing && logOf(existing.id).length ? '<p class="warning">Changing window rules or starting quantity will recalculate earlier balances. Export a backup first.</p>' : ""}<button type="submit" class="primary wide">${existing ? "Save changes" : "Create resource"}</button></form></div>`,
  );
  $("#back").onclick = () => go("all");
  $("#resource-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const data = Object.fromEntries(f.entries());
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
    `<div class="panel"><h2>Appearance</h2><label class="field">Theme<select id="theme"><option value="system">System default</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div><div class="panel"><h2>Backup & restore</h2><p class="muted small">Your data stays on this device until you choose to export it. Save backup JSON in Downloads or Drive using your phone's available save/share options.</p><button id="backup" class="secondary wide">↓ Backup JSON file</button><button id="restore" class="secondary wide">↑ Restore JSON file</button><input id="restore-file" type="file" accept="application/json,.json" hidden/><button id="csv" class="secondary wide">↓ Export transactions CSV</button></div><div class="panel"><h2>About</h2><p class="muted">Resource Manager v1 · Offline-first · No account required.</p><p class="muted small">Back up before clearing browser data or moving from PWA to APK. Their storage is separate.</p></div>`,
  );
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
  applyTheme();
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
