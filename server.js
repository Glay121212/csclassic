// 1.6 Pug Finder server: static page + WebSocket matchmaking.
// The server owns the queue, matches, results and ratings. Clients cannot set their own rating.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const REGIONS = ['eu', 'am', 'as'], MAPS = ['de_inferno', 'de_dust2', 'de_mirage'];
const K = 24, NEED = 10, QUORUM = 6;

fs.mkdirSync(DATA, { recursive: true });
const DB = path.join(DATA, 'players.json');
let players = {}; // id -> {id,name,elo,w,l,hist,hash}
try { players = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch {}
const byHash = {}; Object.values(players).forEach(p => byHash[p.hash] = p.id);
let dirty = false;
setInterval(() => { if (!dirty) return; dirty = false; fs.writeFile(DB + '.tmp', JSON.stringify(players), () => fs.rename(DB + '.tmp', DB, () => {})); }, 5000);

const rid = n => crypto.randomBytes(n).toString('hex');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const cleanName = s => (String(s || '').replace(/[^\w .\-]/g, '').trim().slice(0, 16)) || 'Player' + (100 + Math.floor(Math.random() * 900));
const pub = p => ({ id: p.id, name: p.name, elo: p.elo, w: p.w, l: p.l, hist: p.hist.slice(0, 8) });

const queue = { eu: [], am: [], as: [] }; // entries: {id, maps}
const conns = new Map();                  // playerId -> ws
const matches = new Map(), inMatch = new Map(); // matchId -> match, playerId -> matchId

const send = (id, msg) => { const w = conns.get(id); if (w && w.readyState === 1) w.send(JSON.stringify(msg)); };

function pushQueue(region) {
  const list = queue[region].slice(0, NEED).map(e => ({ n: players[e.id].name, e: players[e.id].elo }));
  queue[region].forEach(e => send(e.id, { t: 'queue', region, count: Math.min(queue[region].length, NEED), list }));
}
function leaveQueue(id) {
  for (const r of REGIONS) { const i = queue[r].findIndex(e => e.id === id); if (i >= 0) { queue[r].splice(i, 1); pushQueue(r); } }
}
function tryMatch(region) {
  const q = queue[region];
  if (q.length < NEED) return;
  const group = q.splice(0, NEED);
  const votes = {}; group.forEach(e => e.maps.forEach(m => votes[m] = (votes[m] || 0) + 1));
  const top = Math.max(...Object.values(votes)), cands = Object.keys(votes).filter(m => votes[m] === top);
  const ps = group.map(e => ({ id: e.id, n: players[e.id].name, e: players[e.id].elo })).sort((a, b) => b.e - a.e);
  const A = [], B = [];
  [0, 1, 1, 0, 0, 1, 1, 0, 0, 1].forEach((s, i) => (s ? B : A).push(ps[i].id)); // snake draft for balanced teams
  const m = { id: rid(6), region, map: cands[Math.floor(Math.random() * cands.length)], players: ps, A, B,
    host: ps[Math.floor(Math.random() * 10)].id, pw: rid(3), addr: '', reports: {}, created: Date.now() };
  matches.set(m.id, m);
  ps.forEach(p => { inMatch.set(p.id, m.id); send(p.id, { t: 'match', match: view(m) }); });
  pushQueue(region);
}
const view = m => ({ id: m.id, region: m.region, map: m.map, players: m.players, A: m.A, B: m.B, host: m.host, pw: m.pw, addr: m.addr, reports: Object.keys(m.reports).length });

function finish(m, win) {
  const avg = ids => ids.reduce((s, i) => s + m.players.find(p => p.id === i).e, 0) / ids.length;
  const eA = 1 / (1 + Math.pow(10, (avg(m.B) - avg(m.A)) / 400));
  m.players.forEach(pl => {
    const p = players[pl.id]; let d = 0;
    if (win !== 'X') {
      const mine = m.A.includes(pl.id) ? 'A' : 'B', exp = mine === 'A' ? eA : 1 - eA;
      d = Math.round(K * ((win === mine ? 1 : 0) - exp));
      win === mine ? p.w++ : p.l++; p.elo = Math.max(100, p.elo + d);
    }
    p.hist.unshift({ map: m.map, d }); p.hist = p.hist.slice(0, 20);
    inMatch.delete(pl.id); send(pl.id, { t: 'result', d, void: win === 'X', me: pub(p) });
  });
  matches.delete(m.id); dirty = true; pushLb();
}
function pushLb() {
  const rows = Object.values(players).filter(p => p.w + p.l > 0).sort((a, b) => b.elo - a.elo).slice(0, 20).map(p => ({ id: p.id, name: p.name, elo: p.elo }));
  const msg = JSON.stringify({ t: 'lb', rows, online: conns.size, q: { eu: queue.eu.length, am: queue.am.length, as: queue.as.length } });
  conns.forEach(w => w.readyState === 1 && w.send(msg));
}
setInterval(pushLb, 10000);
setInterval(() => { const now = Date.now(); matches.forEach(m => { if (now - m.created > 4 * 3600e3) { m.players.forEach(p => inMatch.delete(p.id)); matches.delete(m.id); } }); }, 600000);

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'public', 'index.html')).pipe(res);
  }
  if (req.url === '/health') return res.end('ok');
  res.writeHead(404).end('not found');
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', ws => {
  let id = null, count = 0;
  const rl = setInterval(() => count = 0, 10000);
  ws.on('message', raw => {
    if (++count > 40) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'hello') {
      let token = typeof m.token === 'string' && m.token.length === 32 ? m.token : null, p = token && players[byHash[sha(token)]];
      if (!p) {
        token = rid(16); const pid = rid(5);
        p = players[pid] = { id: pid, name: cleanName(), elo: 1000, w: 0, l: 0, hist: [], hash: sha(token) };
        byHash[p.hash] = pid; dirty = true;
      }
      id = p.id; const old = conns.get(id); if (old && old !== ws) old.close(); conns.set(id, ws);
      ws.send(JSON.stringify({ t: 'me', token, me: pub(p) }));
      const mid = inMatch.get(id); if (mid) ws.send(JSON.stringify({ t: 'match', match: view(matches.get(mid)) }));
      pushLb(); return;
    }
    if (!id) return;
    const p = players[id];
    if (m.t === 'queue') {
      if (inMatch.has(id) || !REGIONS.includes(m.region)) return;
      const maps = (Array.isArray(m.maps) ? m.maps : []).filter(x => MAPS.includes(x)); if (!maps.length) return;
      leaveQueue(id); p.name = cleanName(m.name); dirty = true;
      queue[m.region].push({ id, maps }); pushQueue(m.region); tryMatch(m.region); pushLb();
    } else if (m.t === 'leave') { leaveQueue(id); pushLb(); }
    else if (m.t === 'addr') {
      const mt = matches.get(inMatch.get(id)); const a = String(m.addr || '').trim();
      if (!mt || mt.host !== id || !/^[\w.\-]{1,100}:\d{2,5}$/.test(a)) return;
      mt.addr = a; mt.players.forEach(x => send(x.id, { t: 'addr', addr: a }));
    } else if (m.t === 'report') {
      const mt = matches.get(inMatch.get(id)); if (!mt || !['A', 'B', 'X'].includes(m.w)) return;
      mt.reports[id] = m.w;
      const c = { A: 0, B: 0, X: 0 }; Object.values(mt.reports).forEach(w => c[w]++);
      const win = ['A', 'B', 'X'].find(k => c[k] >= QUORUM);
      if (win) finish(mt, win); else mt.players.forEach(x => send(x.id, { t: 'progress', n: Object.keys(mt.reports).length }));
    }
  });
  ws.on('close', () => { clearInterval(rl); if (id && conns.get(id) === ws) { conns.delete(id); leaveQueue(id); pushLb(); } });
});
server.listen(PORT, () => console.log('1.6 Pug Finder on :' + PORT));
