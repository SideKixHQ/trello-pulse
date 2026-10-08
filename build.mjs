// Pulls each Trello board, builds the dashboard snapshot, and writes data.json.
// Runs in GitHub Actions with TRELLO_KEY and TRELLO_TOKEN repository secrets (read-only use).
import { readFile, writeFile } from 'node:fs/promises';

const BOARDS = ['Hy8CQTMv', 'ovWIWKPk', '4ueUhE1W'];
const KEY = process.env.TRELLO_KEY, TOKEN = process.env.TRELLO_TOKEN;
if (!KEY || !TOKEN) { console.warn('TRELLO_KEY / TRELLO_TOKEN not set yet: publishing the existing data.json unchanged.'); process.exit(0); }

async function g(path) {
  const url = 'https://api.trello.com' + path + (path.includes('?') ? '&' : '?') + `key=${KEY}&token=${TOKEN}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    if (r.status === 429) { await new Promise(res => setTimeout(res, 5000)); continue; }
    throw new Error(`Trello ${r.status} for ${path.split('?')[0]}`);
  }
  throw new Error('Trello rate limit');
}

async function agg(BOARD) {

const b = await g(`/1/boards/${BOARD}?lists=open&cards=open&card_fields=name,idList,idLabels,idMembers,due,dueComplete,dateLastActivity,idShort,shortLink&card_customFieldItems=true&customFields=true&labels=all&members=all&fields=name`);
let acts = [], before = null;
for (let i = 0; i < 10; i++) {
  const a = await g(`/1/boards/${BOARD}/actions?filter=updateCard:idList,createCard,moveCardToBoard,copyCard&limit=1000&fields=type,date,data` + (before ? '&before=' + before : ''));
  acts = acts.concat(a); if (a.length < 1000) break; before = a[a.length-1].id;
}
const now = Date.now(), DAY = 864e5;
const lists = b.lists, lname = Object.fromEntries(lists.map(l => [l.id, l.name]));
const doneL = lists.find(l => /done|complete/i.test(l.name))?.id;
const parkL = new Set(lists.filter(l => /phase 2|ideas/i.test(l.name)).map(l => l.id));
const failL = lists.find(l => /fail/i.test(l.name))?.id;
const lab = Object.fromEntries(b.labels.map(l => [l.id, l]));
const bugId = b.labels.find(l => /^bug$/i.test(l.name))?.id;
const dupId = b.labels.find(l => /duplicate/i.test(l.name))?.id;
const mem = Object.fromEntries(b.members.map(m => [m.id, m.fullName]));
const opt = {}; b.customFields.forEach(f => (f.options||[]).forEach(o => opt[o.id] = o.value.text));
const fid = n => (b.customFields.find(f => f.name === n) || {}).id;
const pf = fid('Priority'), sf = fid('Status');
const moves = acts.filter(a => a.data.card).map(a => ({c:a.data.card.id, to:a.data.listAfter?.id || a.data.list?.id, from:a.data.listBefore?.id, t:Date.parse(a.date), type:a.type}));
const createdT = id => parseInt(id.slice(0,8),16)*1000;
const cards = b.cards.map(c => {
  const entered = moves.filter(m => m.c === c.id && m.to === c.idList).map(m => m.t);
  const pi = c.customFieldItems.find(x => x.idCustomField === pf), si = c.customFieldItems.find(x => x.idCustomField === sf);
  return {id:c.idShort, k:c.shortLink, n:c.name, l:c.idList, lb:c.idLabels, m:c.idMembers.filter(x => mem[x]), cr:createdT(c.id),
    due:c.due ? Date.parse(c.due) : null, dc:!!c.dueComplete,
    age:Math.floor((now - (entered.length ? Math.max(...entered) : createdT(c.id))) / DAY),
    p:pi ? opt[pi.idValue] : null, s:si ? opt[si.idValue] : null};
});
const done = c => c.l === doneL, active = c => !done(c) && !parkL.has(c.l);
const overdue = c => active(c) && c.due && !c.dc && c.due < now;
const isBug = c => c.lb.includes(bugId);
const blocked = c => /block/i.test(c.s||'') || c.lb.some(x => /^block/i.test(lab[x]?.name||''));
const brief = c => ({id:c.id, k:c.k, n:c.n.slice(0,90), l:lname[c.l], who:c.m.map(x => mem[x]), p:c.p, s:c.s, age:c.age, due:c.due ? new Date(c.due).toISOString().slice(0,10) : null});
const med = a => { if (!a.length) return 0; const s = [...a].sort((x,y) => x-y); return s[Math.floor(s.length/2)]; };
const act = cards.filter(active);
const listStats = lists.map(l => { const cs = cards.filter(c => c.l === l.id); const ages = cs.map(c => c.age);
  return {n:l.name, total:cs.length, bugs:cs.filter(isBug).length, overdue:cs.filter(overdue).length, medAge:med(ages), maxAge:ages.length ? Math.max(...ages) : 0, stale14:cs.filter(c => c.age >= 14).length, done:l.id === doneL, park:parkL.has(l.id)}; });
const count = (arr, f) => { const o = {}; arr.forEach(c => { const k = f(c) || 'Not set'; o[k] = (o[k]||0) + 1; }); return o; };
const labels = b.labels.map(l => { const cs = cards.filter(c => c.lb.includes(l.id));
  return {n:l.name || (l.color ? l.color[0].toUpperCase() + l.color.slice(1) + ' label' : 'Unnamed label'), c:l.color, total:cs.length, done:cs.filter(done).length, active:cs.filter(active).length, overdue:cs.filter(overdue).length}; }).filter(x => x.total);
const inProg = lists.filter(l => /in dev|review|pr\)|build|test|verif/i.test(l.name)).map(l => l.id);
const people = b.members.map(m => { const cs = cards.filter(c => c.m.includes(m.id));
  return {n:m.fullName, active:cs.filter(active).length, inFlight:cs.filter(c => inProg.includes(c.l)).length, overdue:cs.filter(overdue).length, high:cs.filter(c => active(c) && /high/i.test(c.p||'')).length, bugs:cs.filter(c => active(c) && isBug(c)).length, done:cs.filter(done).length}; });
const wkStart = t => { const d = new Date(t); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay()+6)%7)); return d.getTime(); };
const w0 = wkStart(now) - 11*7*DAY, weeks = [];
for (let i = 0; i < 12; i++) weeks.push({wk:new Date(w0 + i*7*DAY).toISOString().slice(0,10), created:0, done:0, failed:0});
const wi = t => Math.floor((wkStart(t) - w0) / (7*DAY));
cards.forEach(c => { const i = wi(c.cr); if (i >= 0 && i < 12) weeks[i].created++; });
const seenDone = new Set();
moves.filter(m => m.to === doneL && m.from).sort((a,b) => b.t - a.t).forEach(m => { if (seenDone.has(m.c)) return; seenDone.add(m.c); const i = wi(m.t); if (i >= 0 && i < 12) weeks[i].done++; });
moves.filter(m => m.to === failL && m.from).forEach(m => { const i = wi(m.t); if (i >= 0 && i < 12) weeks[i].failed++; });
const due7 = act.filter(c => c.due && !c.dc && c.due >= now && c.due < now + 7*DAY);
const out = {v:1, id:BOARD, board:b.name, boardUrl:`https://trello.com/b/${BOARD}`, pulledAt:new Date(now).toISOString(),
  kpi:{total:cards.length, active:act.length, done:cards.filter(done).length, bugs:act.filter(isBug).length, overdue:act.filter(overdue).length,
    blocked:act.filter(blocked).length, failed:cards.filter(c => c.l === failL).length, dueSoon:due7.length, unassigned:act.filter(c => !c.m.length).length,
    dupes:act.filter(c => c.lb.includes(dupId)).length, doneWeek:weeks[11].done, createdWeek:weeks[11].created},
  lists:listStats, priority:count(act, c => c.p), status:count(act, c => c.s), labels, people, weeks,
  attention:{
    overdue:act.filter(overdue).sort((a,b) => a.due - b.due).slice(0,15).map(brief),
    blocked:act.filter(blocked).slice(0,15).map(brief),
    failed:cards.filter(c => c.l === failL).slice(0,15).map(brief),
    stuck:cards.filter(c => inProg.includes(c.l) && c.age >= 7).sort((a,b) => b.age - a.age).slice(0,12).map(brief),
    dueSoon:due7.sort((a,b) => a.due - b.due).slice(0,12).map(brief)}};
return out;
}

const boards = [];
for (const id of BOARDS) boards.push(await agg(id));

let prev = { history: [] };
try { prev = JSON.parse(await readFile('data.json', 'utf8')); } catch {}
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const history = (prev.history || []).filter(h => h.day !== day);
boards.forEach(b => history.push({ board: b.id, day, kpi: b.kpi }));
history.sort((a, b) => a.day < b.day ? -1 : 1);

await writeFile('data.json', JSON.stringify({ updatedAt: new Date().toISOString(), boards, history: history.slice(-1500) }));
console.log(boards.map(b => `${b.board}: ${b.kpi.active} active, ${b.kpi.overdue} overdue`).join('\n'));
