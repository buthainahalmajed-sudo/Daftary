// Reads Buthainah's open tasks from Notion (due by tomorrow, Riyadh time) and leaves
// them in the gist that دفتري syncs with, as notion-inbox.json. دفتري shows them as a
// review list on its next sync; nothing is added to her tasks without her approval.
const { NOTION_TOKEN, GIST_TOKEN } = process.env;
let GIST_ID = process.env.GIST_ID || '';
const DB_ID = '4192c1980e0a81879b6fca51092545b6';
const DS_ID = '4192c198-0e0a-81bf-8bd3-000b9ef953e6';
const FILE = 'notion-inbox.json';
if (!NOTION_TOKEN || !GIST_TOKEN) { console.error('NOTION_TOKEN and GIST_TOKEN secrets are required'); process.exit(1); }

const riyadh = new Date(Date.now() + 3 * 3600e3);
const tomorrow = new Date(riyadh.getTime() + 24 * 3600e3).toISOString().slice(0, 10);
const filter = { and: [
  { property: 'الحالة', status: { does_not_equal: 'خلصت' } },
  { property: 'الموعد', date: { on_or_before: tomorrow } },
] };

async function query(url, version) {
  const out = []; let cursor;
  do {
    const res = await fetch(url, { method: 'POST', headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': version, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }) });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const j = await res.json(); out.push(...j.results); cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return out;
}
let pages;
try { pages = await query(`https://api.notion.com/v1/databases/${DB_ID}/query`, '2022-06-28'); }
catch (e) { console.log('database query failed, trying data source:', e.message);
  pages = await query(`https://api.notion.com/v1/data_sources/${DS_ID}/query`, '2025-09-03'); }

const txt = p => (p && (p.title || p.rich_text) || []).map(r => r.plain_text).join('').trim();
const NOT_HERS = ['🤖 على كلوديا', '👤 حمزة'];
const items = pages.map(pg => {
  const P = pg.properties || {};
  const section = P['القسم'] && P['القسم'].select && P['القسم'].select.name;
  if (NOT_HERS.includes(section)) return null;
  const title = txt(P['المهمة']); if (!title) return null;
  const steps = txt(P['الخطوات']), done = txt(P['تخلص لما']);
  const desc = [steps, done ? `تخلص لما: ${done}` : ''].filter(Boolean).join('\n');
  const project = P['المشروع'] && P['المشروع'].select && P['المشروع'].select.name;
  return {
    id: pg.id.replace(/-/g, ''),
    title,
    cat: project === 'شخصي' ? 'شخصية' : 'عمل',
    pri: P['أهم 3'] && P['أهم 3'].checkbox ? 'عالية' : 'متوسطة',
    per: '',
    due: P['الموعد'] && P['الموعد'].date && P['الموعد'].date.start ? P['الموعد'].date.start.slice(0, 10) : '',
    link: (P['الرابط'] && P['الرابط'].url) || '',
    desc,
  };
}).filter(Boolean).sort((a, b) => (a.due || '').localeCompare(b.due || ''));

const gh = (path, init = {}) => fetch('https://api.github.com' + path, { ...init, headers: {
  Authorization: `Bearer ${GIST_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(init.headers || {}) } });
if (!GIST_ID) {
  // find the gist that holds دفتري's data
  for (let page = 1; page <= 5 && !GIST_ID; page++) {
    const r = await gh(`/gists?per_page=100&page=${page}`); if (!r.ok) throw new Error('gist list ' + r.status);
    const list = await r.json(); if (!list.length) break;
    const g = list.find(g => g.files && g.files['daftari-data.json']); if (g) GIST_ID = g.id;
  }
  if (!GIST_ID) throw new Error('could not find the gist with daftari-data.json');
}
const body = JSON.stringify({ files: { [FILE]: { content: JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 1) } } });
const w = await gh(`/gists/${GIST_ID}`, { method: 'PATCH', body });
if (!w.ok) throw new Error('gist write ' + w.status + ' ' + await w.text());
console.log(`wrote ${items.length} task(s) due by ${tomorrow}`);
