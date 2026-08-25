const path = require('path');
const fs = require('fs');
const express = require('express');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'candidates.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    dateAdded TEXT NOT NULL,
    notes TEXT,
    score INTEGER,
    criteria TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    cvFileName TEXT,
    cvBase64 TEXT,
    cvLink TEXT,
    decidedAt TEXT,
    decisionComment TEXT
  );
`);

const STATUSES = ['pending', 'approved', 'rejected'];

function rowToCandidate(row, { includeCv } = { includeCv: false }) {
  const candidate = {
    id: row.id,
    name: row.name,
    role: row.role,
    dateAdded: row.dateAdded,
    notes: row.notes || '',
    score: row.score,
    criteria: row.criteria ? JSON.parse(row.criteria) : [],
    status: row.status,
    hasCv: !!row.cvBase64,
    cvFileName: row.cvFileName || null,
    cvLink: row.cvLink || null,
    decision: row.status !== 'pending'
      ? { decidedAt: row.decidedAt, comment: row.decisionComment || '' }
      : null,
  };
  if (includeCv) {
    candidate.cvBase64 = row.cvBase64 || null;
  }
  return candidate;
}

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/candidates', (req, res) => {
  const rows = db.prepare('SELECT * FROM candidates ORDER BY dateAdded ASC').all();
  res.json(rows.map((row) => rowToCandidate(row)));
});

app.get('/candidates/:id/cv', (req, res) => {
  const row = db.prepare('SELECT cvFileName, cvBase64 FROM candidates WHERE id = ?').get(req.params.id);
  if (!row || !row.cvBase64) {
    return res.status(404).json({ error: 'CV not found' });
  }
  res.json({ cvFileName: row.cvFileName, cvBase64: row.cvBase64 });
});

app.post('/candidates', (req, res) => {
  const { name, role, notes, score, criteria, cvFileName, cvBase64, cvLink } = req.body || {};

  if (!name || !String(name).trim() || !role || !String(role).trim()) {
    return res.status(400).json({ error: 'Name and role are required.' });
  }

  const id = uuidv4();
  const dateAdded = new Date().toISOString();
  const row = {
    id,
    name: String(name).trim(),
    role: String(role).trim(),
    dateAdded,
    notes: notes ? String(notes) : null,
    score: Number.isInteger(score) ? score : null,
    criteria: JSON.stringify(Array.isArray(criteria) ? criteria : []),
    status: 'pending',
    cvFileName: cvFileName || null,
    cvBase64: cvBase64 || null,
    cvLink: cvLink || null,
    decidedAt: null,
    decisionComment: null,
  };

  db.prepare(`
    INSERT INTO candidates
      (id, name, role, dateAdded, notes, score, criteria, status, cvFileName, cvBase64, cvLink, decidedAt, decisionComment)
    VALUES
      (@id, @name, @role, @dateAdded, @notes, @score, @criteria, @status, @cvFileName, @cvBase64, @cvLink, @decidedAt, @decisionComment)
  `).run(row);

  res.status(201).json(rowToCandidate(row));
});

app.patch('/candidates/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Candidate not found' });
  }

  const { status, decisionComment } = req.body || {};
  if (!status || !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  }

  const decidedAt = status === 'pending' ? null : new Date().toISOString();
  const comment = status === 'pending' ? null : (decisionComment ? String(decisionComment) : '');

  db.prepare(`
    UPDATE candidates SET status = ?, decidedAt = ?, decisionComment = ? WHERE id = ?
  `).run(status, decidedAt, comment, req.params.id);

  const updated = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
  res.json(rowToCandidate(updated));
});

app.delete('/candidates/:id', (req, res) => {
  const result = db.prepare('DELETE FROM candidates WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Candidate sign-off board listening on port ${PORT}`);
  console.log(`Using database at ${DB_PATH}`);
});
