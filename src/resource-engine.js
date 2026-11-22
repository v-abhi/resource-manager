// All quantities are stored in the resource's own unit. Money/time are optional per-unit valuations.
export function localStamp(date) {
  const pad = n => String(n).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function localDay(date) { return localStamp(date).slice(0,10); }
export const toDate = value => new Date(value);
export function isActive(r, now = new Date()) { return +now >= +toDate(r.start) && +now <= +toDate(r.end); }
export function status(r, now=new Date()) { return +now < +toDate(r.start) ? 'Scheduled' : +now > +toDate(r.end) ? 'Ended' : 'Active'; }
export function nextBoundary(date, frequency) {
  const d = new Date(date);
  if(frequency === 'hourly') { d.setMinutes(0,0,0); d.setHours(d.getHours()+1); }
  else if(frequency === 'weekly') { d.setHours(0,0,0); d.setDate(d.getDate() + ((8-d.getDay()) % 7 || 7)); }
  else if(frequency === 'monthly') { d.setHours(0,0,0); d.setDate(1); d.setMonth(d.getMonth()+1); }
  else { d.setHours(0,0,0,0); d.setDate(d.getDate()+1); }
  return d;
}
export function round(n) { return Math.round((n + Number.EPSILON)*1e6)/1e6; }
// Replay the resource's logs; no overnight background service is required.
export function evaluate(r, logs=[], until=new Date()) {
  const start=toDate(r.start), end=toDate(r.end), cutoff=new Date(Math.min(+until,+end));
  if(+cutoff < +start) return { available:0, consumed:0, added:0, expired:0, periods:[], todayUsed:0 };
  const sorted=logs.filter(x=>x.resourceId===r.id && +toDate(x.timestamp)>=+start && +toDate(x.timestamp)<=+cutoff).sort((a,b)=>+toDate(a.timestamp)-+toDate(b.timestamp));
  let balance=Number(r.initial)||0, consumed=0, added=0, expired=0, index=0;
  let cursor=new Date(start), periods=[];
  const carry=(Number(r.carry)||0)/100, refill=Number(r.refill)||0;
  let guard=0;
  while(+cursor <= +cutoff && guard++ < 200000) {
    const boundary=nextBoundary(cursor,r.frequency);
    const periodEnd=new Date(Math.min(+boundary,+cutoff,+end));
    const ended=+periodEnd>=+end, rolled=+periodEnd>=+boundary;
    const opening=round(balance); let used=0, gained=0;
    while(index<sorted.length && +toDate(sorted[index].timestamp)<+periodEnd + (+periodEnd===+cutoff ? 1:0)) {
      const item=sorted[index++];
      if(item.kind==='add') { balance+=Number(item.amount); gained+=Number(item.amount); added+=Number(item.amount); }
      else { balance-=Number(item.amount); used+=Number(item.amount); consumed+=Number(item.amount); }
    }
    balance=round(balance);
    let lost=0, carried=balance;
    if(rolled || ended) {
      carried=ended ? 0 : round(balance*carry);
      lost=round(balance-carried);
      expired=round(expired+lost);
      balance=carried;
    }
    periods.push({start:localStamp(cursor),end:localStamp(periodEnd),opening,used:round(used),added:round(gained),lost,carried:round(carried),closed:rolled||ended});
    if(ended || +periodEnd===+cutoff) break;
    if(rolled) { balance=round(balance+refill); cursor=new Date(boundary); }
    else break;
  }
  const today=localDay(until);
  const todayUsed=sorted.filter(x=>x.kind==='consume' && localDay(toDate(x.timestamp))===today).reduce((s,x)=>s+Number(x.amount),0);
  return { available:round(balance), consumed:round(consumed), added:round(added), expired, periods, todayUsed:round(todayUsed) };
}
export function groupDays(logs) {
  const days=new Map();
  for(const x of logs) {
    const day=localDay(toDate(x.timestamp));
    if(!days.has(day)) days.set(day,{date:day,consume:0,add:0});
    days.get(day)[x.kind==='add'?'add':'consume']+=Number(x.amount);
  }
  return [...days.values()].map(x=>({...x,consume:round(x.consume),add:round(x.add)})).sort((a,b)=>b.date.localeCompare(a.date));
}
