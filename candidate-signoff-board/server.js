const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'candidates.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

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

// Non-destructive migration for databases created before reviewNotes existed.
const existingColumns = db.prepare('PRAGMA table_info(candidates)').all().map((c) => c.name);
if (!existingColumns.includes('reviewNotes')) {
  db.exec('ALTER TABLE candidates ADD COLUMN reviewNotes TEXT');
}

const stmts = {
  list: db.prepare('SELECT * FROM candidates ORDER BY dateAdded ASC'),
  getById: db.prepare('SELECT * FROM candidates WHERE id = ?'),
  getCv: db.prepare('SELECT cvFileName, cvBase64 FROM candidates WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO candidates
      (id, name, role, dateAdded, notes, score, criteria, status, cvFileName, cvBase64, cvLink, decidedAt, decisionComment, reviewNotes)
    VALUES
      (@id, @name, @role, @dateAdded, @notes, @score, @criteria, @status, @cvFileName, @cvBase64, @cvLink, @decidedAt, @decisionComment, @reviewNotes)
  `),
  update: db.prepare(`
    UPDATE candidates SET
      name = @name, role = @role, notes = @notes, score = @score, criteria = @criteria,
      status = @status, cvFileName = @cvFileName, cvBase64 = @cvBase64, cvLink = @cvLink,
      decidedAt = @decidedAt, decisionComment = @decisionComment, reviewNotes = @reviewNotes
    WHERE id = @id
  `),
  remove: db.prepare('DELETE FROM candidates WHERE id = ?'),
};

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
    reviewNotes: row.reviewNotes || '',
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
  const rows = stmts.list.all();
  res.json(rows.map((row) => rowToCandidate(row)));
});

app.get('/candidates/:id/cv', (req, res) => {
  const row = stmts.getCv.get(req.params.id);
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

  const row = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    role: String(role).trim(),
    dateAdded: new Date().toISOString(),
    notes: notes ? String(notes) : null,
    score: Number.isInteger(score) ? score : null,
    criteria: JSON.stringify(Array.isArray(criteria) ? criteria : []),
    status: 'pending',
    cvFileName: cvFileName || null,
    cvBase64: cvBase64 || null,
    cvLink: cvLink || null,
    decidedAt: null,
    decisionComment: null,
    reviewNotes: null,
  };

  stmts.insert.run(row);

  res.status(201).json(rowToCandidate(row));
});

app.patch('/candidates/:id', (req, res) => {
  const existing = stmts.getById.get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Candidate not found' });
  }

  const body = req.body || {};
  const next = { ...existing };

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
    }
    next.status = body.status;
    next.decidedAt = body.status === 'pending' ? null : new Date().toISOString();
    next.decisionComment = body.status === 'pending'
      ? null
      : (body.decisionComment ? String(body.decisionComment) : (existing.decisionComment || ''));
  }

  if (body.name !== undefined) {
    if (!String(body.name).trim()) {
      return res.status(400).json({ error: 'Name cannot be empty.' });
    }
    next.name = String(body.name).trim();
  }

  if (body.role !== undefined) {
    if (!String(body.role).trim()) {
      return res.status(400).json({ error: 'Role cannot be empty.' });
    }
    next.role = String(body.role).trim();
  }

  if (body.notes !== undefined) next.notes = body.notes ? String(body.notes) : null;
  if (body.score !== undefined) next.score = Number.isInteger(body.score) ? body.score : null;
  if (body.criteria !== undefined) next.criteria = JSON.stringify(Array.isArray(body.criteria) ? body.criteria : []);
  if (body.cvLink !== undefined) next.cvLink = body.cvLink ? String(body.cvLink) : null;
  if (body.cvFileName !== undefined && body.cvBase64 !== undefined) {
    next.cvFileName = body.cvFileName || null;
    next.cvBase64 = body.cvBase64 || null;
  }
  if (body.reviewNotes !== undefined) next.reviewNotes = body.reviewNotes ? String(body.reviewNotes) : null;

  stmts.update.run({
    id: next.id,
    name: next.name,
    role: next.role,
    notes: next.notes,
    score: next.score,
    criteria: next.criteria,
    status: next.status,
    cvFileName: next.cvFileName,
    cvBase64: next.cvBase64,
    cvLink: next.cvLink,
    decidedAt: next.decidedAt,
    decisionComment: next.decisionComment,
    reviewNotes: next.reviewNotes,
  });

  const updated = stmts.getById.get(req.params.id);
  res.json(rowToCandidate(updated));
});

app.delete('/candidates/:id', (req, res) => {
  const result = stmts.remove.run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Candidate sign-off board listening on port ${PORT}`);
  console.log(`Using database at ${DB_PATH}`);
});
