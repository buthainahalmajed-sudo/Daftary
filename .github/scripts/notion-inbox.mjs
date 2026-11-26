// Reads Buthainah's open tasks from Notion and leaves the ones due by tomorrow (Riyadh
// time) in the gist that دفتري syncs with, as notion-inbox.json. دفتري shows them as a
// review list on its next sync; nothing is added to her tasks without her approval.
//
// Two rules keep the list clean:
//  1. Done stays done. A task she ticked in دفتري is marked «خلصت» in Notion, so it is
//     never offered again. This covers tasks that came from Notion (id "notion-<page>")
//     and tasks that reached دفتري another way (an import link) when the titles match.
//  2. One task, one entry. Titles are compared by meaning-ish (normalised words), not
//     letter by letter, so a reworded copy of a task she already has, or two copies of
//     the same task in Notion, are not offered twice.
const { NOTION_TOKEN, GIST_TOKEN } = process.env;
let GIST_ID = process.env.GIST_ID || '';
const DB_ID = '4192c1980e0a81879b6fca51092545b6';
const DS_ID = '4192c198-0e0a-81bf-8bd3-000b9ef953e6';
const FILE = 'notion-inbox.json';
const DATA_FILE = 'daftari-data.json';
const SAME = 0.6;   // similar enough to count as a task she already has
const DONE = 0.75;  // similar enough to copy her "done" back to Notion
if (!NOTION_TOKEN || !GIST_TOKEN) { console.error('NOTION_TOKEN and GIST_TOKEN secrets are required'); process.exit(1); }

const riyadh = new Date(Date.now() + 3 * 3600e3);
const tomorrow = new Date(riyadh.getTime() + 24 * 3600e3).toISOString().slice(0, 10);
const openFilter = { property: 'الحالة', status: { does_not_equal: 'خلصت' } };

/* ---------- text comparison ---------- */
const STOP = new Set(['في','من','على','الى','الي','عن','مع','و','او','ثم','حق','لـ','بـ','كل','عشان','قبل','بعد','اللي','هل','ما','لا','يا','انتي','لكلوديا','كلوديا','كلود']);
const norm = s => String(s || '')
  .replace(/[ً-ٰٟـ]/g, '')            // tashkeel, tatweel
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')                      // emoji, punctuation
  .toLowerCase().replace(/\s+/g, ' ').trim();
const stem = w => {
  let x = w;
  if (x.length > 4 && /^(وال|بال|كال|فال|لل)/.test(x)) x = x.slice(3);
  else if (x.length > 3 && x.startsWith('ال')) x = x.slice(2);
  if (x.length > 4 && /(ي|ين|ون|ات|ها|هم|ه)$/.test(x)) x = x.replace(/(ين|ون|ات|ها|هم|ي|ه)$/, '');
  return x;
};
const words = s => new Set(norm(s).split(' ').filter(w => w.length > 1 && !STOP.has(w)).map(stem).filter(w => w.length > 1));
// words that tell two otherwise-alike tasks apart: numbers (ريل ٩ / ريل ١١, ٢٣–٢٥ / ٢٦–٣٠) and ordinals
const ORD = /^(اول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|اخير)/;
const markers = S => [...S].filter(w => /^\d+$/.test(w) || ORD.test(w)).sort().join(',');
function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  if (markers(A) !== markers(B)) return 0;              // different reel, date range or "first/second"
  let common = 0; A.forEach(w => { if (B.has(w)) common++; });
  return common / (A.size + B.size - common);            // Jaccard: shared words over all words
}

/* ---------- Notion ---------- */
const notionHeaders = v => ({ Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': v, 'Content-Type': 'application/json' });
async function query(url, version, filter) {
  const out = []; let cursor;
  do {
    const res = await fetch(url, { method: 'POST', headers: notionHeaders(version),
      body: JSON.stringify({ filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }) });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const j = await res.json(); out.push(...j.results); cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return out;
}
let pages;
try { pages = await query(`https://api.notion.com/v1/databases/${DB_ID}/query`, '2022-06-28', openFilter); }
catch (e) { console.log('database query failed, trying data source:', e.message);
  pages = await query(`https://api.notion.com/v1/data_sources/${DS_ID}/query`, '2025-09-03', openFilter); }

async function markDone(pageId, why) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { method: 'PATCH', headers: notionHeaders('2022-06-28'),
    body: JSON.stringify({ properties: { 'الحالة': { status: { name: 'خلصت' } } } }) });
  console.log(res.ok ? `marked done in Notion: ${why}` : `could not mark done (${res.status}): ${why}`);
  return res.ok;
}

/* ---------- gist ---------- */
const gh = (path, init = {}) => fetch('https://api.github.com' + path, { ...init, headers: {
  Authorization: `Bearer ${GIST_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(init.headers || {}) } });
if (!GIST_ID) {
  for (let page = 1; page <= 5 && !GIST_ID; page++) {
    const r = await gh(`/gists?per_page=100&page=${page}`); if (!r.ok) throw new Error('gist list ' + r.status);
    const list = await r.json(); if (!list.length) break;
    const g = list.find(g => g.files && g.files[DATA_FILE]); if (g) GIST_ID = g.id;
  }
  if (!GIST_ID) throw new Error('could not find the gist with ' + DATA_FILE);
}
const gr = await gh(`/gists/${GIST_ID}`); if (!gr.ok) throw new Error('gist read ' + gr.status);
const gist = await gr.json();
let daftari = { tasks: [], tombstones: {} };
try {
  const f = gist.files && gist.files[DATA_FILE];
  let content = f && f.content;
  if (f && f.truncated && f.raw_url) content = await (await fetch(f.raw_url, { headers: { Authorization: `Bearer ${GIST_TOKEN}` } })).text();
  daftari = Object.assign(daftari, JSON.parse(content || '{}'));
} catch (e) { console.log('could not read daftari data, continuing without it:', e.message); }
const tasks = Array.isArray(daftari.tasks) ? daftari.tasks : [];
const tombs = daftari.tombstones || {};
const titleOf = t => t.title || t.text || '';

/* ---------- 1. done stays done ---------- */
const doneById = new Set(tasks.filter(t => t.done && /^notion-/.test(t.id || '')).map(t => t.id.slice(7)));
const doneTitles = tasks.filter(t => t.done).map(titleOf);
const txt = p => (p && (p.title || p.rich_text) || []).map(r => r.plain_text).join('').trim();
const open = [];
for (const pg of pages) {
  const id = pg.id.replace(/-/g, '');
  const title = txt((pg.properties || {})['المهمة']);
  if (doneById.has(id)) { await markDone(pg.id, title); continue; }
  const twin = doneTitles.find(d => similarity(d, title) >= DONE);
  if (twin) { await markDone(pg.id, `${title}  ≈  ${twin}`); continue; }
  open.push(pg);
}

/* ---------- 2. one task, one entry ---------- */
const NOT_HERS = ['🤖 على كلوديا', '👤 حمزة'];
const haveIds = new Set(tasks.map(t => t.id));
const haveTitles = tasks.map(titleOf);
const offered = [];
const items = [];
open.sort((a, b) => (a.created_time || '').localeCompare(b.created_time || ''));   // the oldest copy wins
for (const pg of open) {
  const P = pg.properties || {};
  const id = pg.id.replace(/-/g, '');
  const title = txt(P['المهمة']); if (!title) continue;
  const section = P['القسم'] && P['القسم'].select && P['القسم'].select.name;
  if (NOT_HERS.includes(section)) continue;
  if (/مكرر/.test(txt(P['المفتاح']))) continue;
  const due = P['الموعد'] && P['الموعد'].date && P['الموعد'].date.start ? P['الموعد'].date.start.slice(0, 10) : '';
  if (!due || due > tomorrow) continue;
  if (haveIds.has('notion-' + id) || tombs['tasks|notion-' + id]) continue;
  if (haveTitles.some(h => similarity(h, title) >= SAME)) { console.log(`skip, already in دفتري: ${title}`); continue; }
  if (offered.some(o => similarity(o, title) >= SAME)) { console.log(`skip, duplicate in Notion: ${title}`); continue; }
  offered.push(title);
  const steps = txt(P['الخطوات']), doneWhen = txt(P['تخلص لما']);
  const project = P['المشروع'] && P['المشروع'].select && P['المشروع'].select.name;
  items.push({
    id, title,
    cat: project === 'شخصي' ? 'شخصية' : 'عمل',
    pri: P['أهم 3'] && P['أهم 3'].checkbox ? 'عالية' : 'متوسطة',
    per: '', due,
    link: (P['الرابط'] && P['الرابط'].url) || '',
    desc: [steps, doneWhen ? `تخلص لما: ${doneWhen}` : ''].filter(Boolean).join('\n'),
  });
}
items.sort((a, b) => (a.due || '').localeCompare(b.due || ''));

const body = JSON.stringify({ files: { [FILE]: { content: JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 1) } } });
const w = await gh(`/gists/${GIST_ID}`, { method: 'PATCH', body });
if (!w.ok) throw new Error('gist write ' + w.status + ' ' + await w.text());
console.log(`wrote ${items.length} task(s) due by ${tomorrow}`);
