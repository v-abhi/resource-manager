import {
  evaluate,
  groupDays,
  localDay,
  toDate,
  round,
} from "./resource-engine.js";
export function reportFor(resource, logs, from, to, now = new Date()) {
  const filtered = logs.filter(
    (x) =>
      x.resourceId === resource.id &&
      localDay(toDate(x.timestamp)) >= from &&
      localDay(toDate(x.timestamp)) <= to,
  );
  const daily = groupDays(filtered);
  // Include days with expiration even when no manual consumption was logged.
  const dayMap = new Map(daily.map((d) => [d.date, { ...d, expired: 0 }]));
  const consumed = round(daily.reduce((s, d) => s + d.consume, 0));
  const added = round(daily.reduce((s, d) => s + d.add, 0));
  const snapshot = evaluate(resource, logs, now);
  // Expiration is dated to the closing boundary of each resource window.
  const expiryPeriods = snapshot.periods.filter(
    (p) =>
      p.closed &&
      localDay(toDate(p.end)) >= from &&
      localDay(toDate(p.end)) <= to,
  );
  for (const p of expiryPeriods) {
    const date = localDay(toDate(p.end));
    const entry = dayMap.get(date) || { date, consume: 0, add: 0, expired: 0 };
    entry.expired = round(entry.expired + p.lost);
    dayMap.set(date, entry);
  }
  const expired = round(expiryPeriods.reduce((s, p) => s + p.lost, 0));
  return {
    daily: [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date)),
    consumed,
    added,
    expired,
    moneyConsumed: round(consumed * (Number(resource.moneyRate) || 0)),
    timeConsumed: round(consumed * (Number(resource.timeRate) || 0)),
    moneyExpired: round(expired * (Number(resource.moneyRate) || 0)),
    timeExpired: round(expired * (Number(resource.timeRate) || 0)),
  };
}
