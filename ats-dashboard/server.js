// Fullstock ATS dashboard: jobs, candidates and interview scorecards.
// Same stack as the candidate sign-off board (Express + node:sqlite) so the two
// can be merged into one app later.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'ats.db');
// Two keys, set in Railway's Variables tab and never committed:
//  ATS_ADMIN_KEY  full access (HR)
//  ATS_VIEW_KEY   read-only (CEO / managers, shared as a view link)
// If neither is set the API refuses every request rather than running open.
const ADMIN_KEY = process.env.ATS_ADMIN_KEY || '';
const VIEW_KEY = process.env.ATS_VIEW_KEY || '';

const JOB_STATUSES = ['open', 'on_hold', 'closed'];
const STAGES = ['applied', 'interviewed', 'shortlisted', 'rejected_before', 'rejected_after'];
const SOURCES = ['applied', 'messaged'];
const SHEETS = ['Behavioral', 'Technical', 'Both'];

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    department TEXT,
    location TEXT,
    hiringManager TEXT,
    dateOpened TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    archived INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    jobId TEXT NOT NULL REFERENCES jobs(id),
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    source TEXT NOT NULL DEFAULT 'applied',
    linkedinUrl TEXT,
    notes TEXT,
    stage TEXT NOT NULL DEFAULT 'applied',
    interviewDateTime TEXT,
    decision TEXT,
    primaryInterviewer TEXT NOT NULL DEFAULT 'Hesham',
    cvFileName TEXT,
    cvBase64 TEXT,
    reportFileName TEXT,
    reportBase64 TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS evaluations (
    id TEXT PRIMARY KEY,
    candidateId TEXT NOT NULL REFERENCES candidates(id),
    interviewer TEXT NOT NULL,
    sheet TEXT,
    techScore REAL,
    techMax REAL,
    behScore REAL,
    behMax REAL,
    comment TEXT,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_cand_job ON candidates(jobId);
  CREATE INDEX IF NOT EXISTS idx_eval_cand ON evaluations(candidateId);
`);

// Non-destructive migrations for columns added after launch.
const candCols = db.prepare('PRAGMA table_info(candidates)').all().map((c) => c.name);
if (!candCols.includes('shortlistRank')) db.exec('ALTER TABLE candidates ADD COLUMN shortlistRank INTEGER');

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const str = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const JOB_COLS = 'id, title, department, location, hiringManager, dateOpened, status, archived, createdAt, updatedAt';
const CAND_COLS = `id, jobId, name, phone, email, source, linkedinUrl, notes, stage, interviewDateTime, decision,
  primaryInterviewer, shortlistRank, cvFileName, reportFileName, archived, createdAt, updatedAt,
  (cvBase64 IS NOT NULL) AS hasCv, (reportBase64 IS NOT NULL) AS hasReport`;

function jobOut(r) {
  return r && { ...r, archived: !!r.archived };
}
function candOut(r, evals) {
  return r && { ...r, archived: !!r.archived, hasCv: !!r.hasCv, hasReport: !!r.hasReport, evaluations: evals || [] };
}
function evalsFor(id) {
  return db.prepare('SELECT * FROM evaluations WHERE candidateId = ? ORDER BY position, rowid').all(id);
}
function getCandidate(id) {
  const r = db.prepare(`SELECT ${CAND_COLS} FROM candidates WHERE id = ?`).get(id);
  return r ? candOut(r, evalsFor(id)) : null;
}

// Base64 data URL check for uploaded PDFs/files. Keeps the payload format
// identical to the sign-off board (cvFileName + cvBase64 as a data URL).
function cleanFile(name, dataUrl) {
  if (!dataUrl) return { name: null, data: null };
  const s = String(dataUrl);
  if (!/^data:[\w.+/-]+;base64,/.test(s)) throw new Error('Files must be sent as a base64 data URL.');
  return { name: str(name) || 'file.pdf', data: s };
}

function replaceEvaluations(candidateId, list) {
  db.prepare('DELETE FROM evaluations WHERE candidateId = ?').run(candidateId);
  const ins = db.prepare(`INSERT INTO evaluations (id, candidateId, interviewer, sheet, techScore, techMax, behScore, behMax, comment, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  (Array.isArray(list) ? list : []).forEach((e, i) => {
    const interviewer = str(e && e.interviewer);
    if (!interviewer) return;
    ins.run(newId(), candidateId, interviewer, SHEETS.includes(e.sheet) ? e.sheet : null,
      num(e.techScore), num(e.techMax), num(e.behScore), num(e.behMax), str(e.comment), i);
  });
}

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ ok: true }));

function safeEqual(a, b) {
  const x = Buffer.from(a || '');
  const y = Buffer.from(b || '');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
// Every /api route needs a key; writes need the admin key.
app.use('/api', (req, res, next) => {
  if (!ADMIN_KEY && !VIEW_KEY) return res.status(401).json({ error: 'Server has no access keys configured.' });
  const provided = req.get('x-access-key') || '';
  if (ADMIN_KEY && safeEqual(provided, ADMIN_KEY)) req.role = 'admin';
  else if (VIEW_KEY && safeEqual(provided, VIEW_KEY)) req.role = 'viewer';
  else return res.status(401).json({ error: 'Missing or invalid access key.' });
  if (req.method !== 'GET' && req.role !== 'admin') return res.status(403).json({ error: 'This link is view-only.' });
  next();
});

app.get('/api/me', (req, res) => res.json({ role: req.role }));

// Everything the dashboard needs in one call (files excluded, fetched on demand).
app.get('/api/data', (req, res) => {
  const includeArchived = req.query.archived === '1';
  const where = includeArchived ? '' : 'WHERE archived = 0';
  const jobs = db.prepare(`SELECT ${JOB_COLS} FROM jobs ${where} ORDER BY createdAt`).all().map(jobOut);
  const cands = db.prepare(`SELECT ${CAND_COLS} FROM candidates ${where} ORDER BY createdAt`).all();
  const evals = db.prepare('SELECT * FROM evaluations ORDER BY position, rowid').all();
  const byCand = {};
  evals.forEach((e) => { (byCand[e.candidateId] = byCand[e.candidateId] || []).push(e); });
  res.json({ role: req.role, jobs, candidates: cands.map((c) => candOut(c, byCand[c.id])) });
});

// ---- Jobs ----
app.get('/api/jobs', (req, res) => {
  res.json(db.prepare(`SELECT ${JOB_COLS} FROM jobs ORDER BY createdAt`).all().map(jobOut));
});

app.post('/api/jobs', (req, res) => {
  const b = req.body || {};
  const title = str(b.title);
  if (!title) return res.status(400).json({ error: 'Job title is required.' });
  const t = now();
  const id = newId();
  db.prepare(`INSERT INTO jobs (id, title, department, location, hiringManager, dateOpened, status, archived, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(id, title, str(b.department), str(b.location), str(b.hiringManager),
    str(b.dateOpened) || t.slice(0, 10), JOB_STATUSES.includes(b.status) ? b.status : 'open', t, t);
  res.status(201).json(jobOut(db.prepare(`SELECT ${JOB_COLS} FROM jobs WHERE id = ?`).get(id)));
});

app.patch('/api/jobs/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Job not found.' });
  const b = req.body || {};
  const next = { ...cur };
  ['title', 'department', 'location', 'hiringManager', 'dateOpened'].forEach((k) => { if (k in b) next[k] = str(b[k]); });
  if (!next.title) return res.status(400).json({ error: 'Job title is required.' });
  if ('status' in b) {
    if (!JOB_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Status must be open, on_hold or closed.' });
    next.status = b.status;
  }
  if ('archived' in b) next.archived = b.archived ? 1 : 0;
  db.prepare(`UPDATE jobs SET title=?, department=?, location=?, hiringManager=?, dateOpened=?, status=?, archived=?, updatedAt=? WHERE id=?`)
    .run(next.title, next.department, next.location, next.hiringManager, next.dateOpened, next.status, next.archived, now(), cur.id);
  res.json(jobOut(db.prepare(`SELECT ${JOB_COLS} FROM jobs WHERE id = ?`).get(cur.id)));
});

// ---- Candidates ----
app.get('/api/candidates', (req, res) => {
  const rows = db.prepare(`SELECT ${CAND_COLS} FROM candidates ORDER BY createdAt`).all();
  res.json(rows.map((r) => candOut(r, evalsFor(r.id))));
});
app.get('/api/candidates/:id', (req, res) => {
  const c = getCandidate(req.params.id);
  if (!c) return res.status(404).json({ error: 'Candidate not found.' });
  res.json(c);
});

app.post('/api/candidates', (req, res) => {
  const b = req.body || {};
  const name = str(b.name);
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (!b.jobId || !db.prepare('SELECT id FROM jobs WHERE id = ?').get(b.jobId)) {
    return res.status(400).json({ error: 'A valid jobId is required.' });
  }
  let cv;
  let report;
  try {
    cv = cleanFile(b.cvFileName, b.cvBase64);
    report = cleanFile(b.reportFileName, b.reportBase64);
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const t = now();
  const id = newId();
  db.prepare(`INSERT INTO candidates (id, jobId, name, phone, email, source, linkedinUrl, notes, stage, interviewDateTime, decision,
    primaryInterviewer, cvFileName, cvBase64, reportFileName, reportBase64, archived, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(
    id, b.jobId, name, str(b.phone), str(b.email), SOURCES.includes(b.source) ? b.source : 'applied',
    str(b.linkedinUrl), str(b.notes), STAGES.includes(b.stage) ? b.stage : 'applied', str(b.interviewDateTime),
    str(b.decision), str(b.primaryInterviewer) || 'Hesham', cv.name, cv.data, report.name, report.data, t, t);
  if (Array.isArray(b.evaluations)) replaceEvaluations(id, b.evaluations);
  res.status(201).json(getCandidate(id));
});

app.patch('/api/candidates/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Candidate not found.' });
  const b = req.body || {};
  const next = { ...cur };
  ['name', 'phone', 'email', 'linkedinUrl', 'notes', 'interviewDateTime', 'decision', 'primaryInterviewer'].forEach((k) => {
    if (k in b) next[k] = str(b[k]);
  });
  if (!next.name) return res.status(400).json({ error: 'Name is required.' });
  if (!next.primaryInterviewer) next.primaryInterviewer = 'Hesham';
  if ('jobId' in b) {
    if (!db.prepare('SELECT id FROM jobs WHERE id = ?').get(b.jobId)) return res.status(400).json({ error: 'Unknown jobId.' });
    next.jobId = b.jobId;
  }
  if ('source' in b) {
    if (!SOURCES.includes(b.source)) return res.status(400).json({ error: 'Source must be applied or messaged.' });
    next.source = b.source;
  }
  if ('stage' in b) {
    if (!STAGES.includes(b.stage)) return res.status(400).json({ error: `Stage must be one of: ${STAGES.join(', ')}.` });
    next.stage = b.stage;
  }
  if ('archived' in b) next.archived = b.archived ? 1 : 0;
  try {
    if ('cvBase64' in b) { const f = cleanFile(b.cvFileName, b.cvBase64); next.cvFileName = f.name; next.cvBase64 = f.data; }
    if ('reportBase64' in b) { const f = cleanFile(b.reportFileName, b.reportBase64); next.reportFileName = f.name; next.reportBase64 = f.data; }
  } catch (e) { return res.status(400).json({ error: e.message }); }
  db.prepare(`UPDATE candidates SET jobId=?, name=?, phone=?, email=?, source=?, linkedinUrl=?, notes=?, stage=?, interviewDateTime=?,
    decision=?, primaryInterviewer=?, cvFileName=?, cvBase64=?, reportFileName=?, reportBase64=?, archived=?, updatedAt=? WHERE id=?`).run(
    next.jobId, next.name, next.phone, next.email, next.source, next.linkedinUrl, next.notes, next.stage, next.interviewDateTime,
    next.decision, next.primaryInterviewer, next.cvFileName, next.cvBase64, next.reportFileName, next.reportBase64, next.archived, now(), cur.id);
  if (Array.isArray(b.evaluations)) replaceEvaluations(cur.id, b.evaluations);
  res.json(getCandidate(cur.id));
});

// Replace a candidate's interviewer scores in one go (from a scorecard report).
// Rank a job's shortlisted candidates: body { order: [candidateId, ...] }, first = #1.
app.put('/api/jobs/:id/shortlist-order', (req, res) => {
  if (!db.prepare('SELECT id FROM jobs WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Job not found.' });
  const order = Array.isArray((req.body || {}).order) ? req.body.order : null;
  if (!order) return res.status(400).json({ error: 'order must be a list of candidate ids.' });
  const upd = db.prepare('UPDATE candidates SET shortlistRank = ? WHERE id = ? AND jobId = ?');
  order.forEach((cid, i) => upd.run(i + 1, String(cid), req.params.id));
  res.json({ ok: true });
});

app.put('/api/candidates/:id/evaluations', (req, res) => {
  if (!db.prepare('SELECT id FROM candidates WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Candidate not found.' });
  replaceEvaluations(req.params.id, (req.body || {}).evaluations);
  res.json(getCandidate(req.params.id));
});

function sendFile(col, nameCol) {
  return (req, res) => {
    const r = db.prepare(`SELECT ${nameCol} AS n, ${col} AS d FROM candidates WHERE id = ?`).get(req.params.id);
    if (!r || !r.d) return res.status(404).json({ error: 'File not found.' });
    res.json({ fileName: r.n, base64: r.d });
  };
}
app.get('/api/candidates/:id/cv', sendFile('cvBase64', 'cvFileName'));
app.get('/api/candidates/:id/report', sendFile('reportBase64', 'reportFileName'));

app.listen(PORT, () => {
  console.log(`Fullstock ATS listening on port ${PORT}`);
});
