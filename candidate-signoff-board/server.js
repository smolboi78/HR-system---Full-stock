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

// Non-destructive migrations for databases created before these columns existed.
const existingColumns = db.prepare('PRAGMA table_info(candidates)').all().map((c) => c.name);
if (!existingColumns.includes('reviewNotes')) {
  db.exec('ALTER TABLE candidates ADD COLUMN reviewNotes TEXT');
}
if (!existingColumns.includes('onHold')) {
  db.exec('ALTER TABLE candidates ADD COLUMN onHold INTEGER NOT NULL DEFAULT 0');
}
if (!existingColumns.includes('holdNote')) {
  db.exec('ALTER TABLE candidates ADD COLUMN holdNote TEXT');
}
if (!existingColumns.includes('source')) {
  db.exec("ALTER TABLE candidates ADD COLUMN source TEXT NOT NULL DEFAULT 'applied'");
}
if (!existingColumns.includes('company')) {
  db.exec('ALTER TABLE candidates ADD COLUMN company TEXT');
}
if (!existingColumns.includes('linkedinUrl')) {
  db.exec('ALTER TABLE candidates ADD COLUMN linkedinUrl TEXT');
}
if (!existingColumns.includes('archived')) {
  db.exec('ALTER TABLE candidates ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
}
if (!existingColumns.includes('stage')) {
  db.exec('ALTER TABLE candidates ADD COLUMN stage TEXT');
}
if (!existingColumns.includes('rejectionReason')) {
  db.exec('ALTER TABLE candidates ADD COLUMN rejectionReason TEXT');
}
if (!existingColumns.includes('interviewDateTime')) {
  db.exec('ALTER TABLE candidates ADD COLUMN interviewDateTime TEXT');
}
if (!existingColumns.includes('interviewConfirmed')) {
  db.exec('ALTER TABLE candidates ADD COLUMN interviewConfirmed INTEGER NOT NULL DEFAULT 0');
}
if (!existingColumns.includes('scorecardFileName')) {
  db.exec('ALTER TABLE candidates ADD COLUMN scorecardFileName TEXT');
}
if (!existingColumns.includes('scorecardBase64')) {
  db.exec('ALTER TABLE candidates ADD COLUMN scorecardBase64 TEXT');
}
if (!existingColumns.includes('scoreSummary')) {
  db.exec('ALTER TABLE candidates ADD COLUMN scoreSummary TEXT');
}
if (!existingColumns.includes('scoredBy')) {
  db.exec('ALTER TABLE candidates ADD COLUMN scoredBy TEXT');
}
if (!existingColumns.includes('cvHash')) {
  db.exec('ALTER TABLE candidates ADD COLUMN cvHash TEXT');
}

// Candidates approved before the `stage` column existed have stage=NULL, which makes
// them fail every HR tab's `stage === 'approved'` filter — backfill them into the
// first funnel stage. Safe to run on every boot: it only ever touches NULL stages.
db.exec("UPDATE candidates SET stage = 'approved' WHERE status = 'approved' AND stage IS NULL");

const stmts = {
  list: db.prepare('SELECT * FROM candidates ORDER BY dateAdded ASC'),
  getById: db.prepare('SELECT * FROM candidates WHERE id = ?'),
  getCv: db.prepare('SELECT cvFileName, cvBase64 FROM candidates WHERE id = ?'),
  getScorecard: db.prepare('SELECT scorecardFileName, scorecardBase64 FROM candidates WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO candidates
      (id, name, role, dateAdded, notes, score, criteria, status, cvFileName, cvBase64, cvLink, decidedAt, decisionComment, reviewNotes, onHold, holdNote, source, company, linkedinUrl, archived, stage, rejectionReason, interviewDateTime, interviewConfirmed, scorecardFileName, scorecardBase64, scoreSummary, scoredBy, cvHash)
    VALUES
      (@id, @name, @role, @dateAdded, @notes, @score, @criteria, @status, @cvFileName, @cvBase64, @cvLink, @decidedAt, @decisionComment, @reviewNotes, @onHold, @holdNote, @source, @company, @linkedinUrl, @archived, @stage, @rejectionReason, @interviewDateTime, @interviewConfirmed, @scorecardFileName, @scorecardBase64, @scoreSummary, @scoredBy, @cvHash)
  `),
  update: db.prepare(`
    UPDATE candidates SET
      name = @name, role = @role, notes = @notes, score = @score, criteria = @criteria,
      status = @status, cvFileName = @cvFileName, cvBase64 = @cvBase64, cvLink = @cvLink,
      decidedAt = @decidedAt, decisionComment = @decisionComment, reviewNotes = @reviewNotes,
      onHold = @onHold, holdNote = @holdNote, source = @source, company = @company, linkedinUrl = @linkedinUrl,
      archived = @archived, stage = @stage, rejectionReason = @rejectionReason,
      interviewDateTime = @interviewDateTime, interviewConfirmed = @interviewConfirmed,
      scorecardFileName = @scorecardFileName, scorecardBase64 = @scorecardBase64,
      scoreSummary = @scoreSummary, scoredBy = @scoredBy, cvHash = @cvHash
    WHERE id = @id
  `),
  remove: db.prepare('DELETE FROM candidates WHERE id = ?'),
};

const STATUSES = ['pending', 'approved', 'rejected'];
const SOURCES = ['applied', 'headhunting'];
const STAGES = ['approved', 'scheduled', 'shortlisted'];
const REJECTION_REASONS = ['after_second_screening', 'after_interview'];

function hashCv(cvBase64) {
  if (!cvBase64) return null;
  return crypto.createHash('sha256').update(cvBase64).digest('hex');
}

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
    cvHash: row.cvHash || null,
    decision: row.status !== 'pending'
      ? { decidedAt: row.decidedAt, comment: row.decisionComment || '' }
      : null,
    reviewNotes: row.reviewNotes || '',
    onHold: !!row.onHold,
    holdNote: row.holdNote || '',
    source: row.source || 'applied',
    company: row.company || '',
    linkedinUrl: row.linkedinUrl || '',
    archived: !!row.archived,
    stage: row.stage || null,
    rejectionReason: row.rejectionReason || null,
    interviewDateTime: row.interviewDateTime || null,
    interviewConfirmed: !!row.interviewConfirmed,
    hasScorecard: !!row.scorecardBase64,
    scorecardFileName: row.scorecardFileName || null,
    scoreSummary: row.scoreSummary || '',
    scoredBy: row.scoredBy || '',
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

app.get('/candidates/:id/scorecard', (req, res) => {
  const row = stmts.getScorecard.get(req.params.id);
  if (!row || !row.scorecardBase64) {
    return res.status(404).json({ error: 'Scorecard not found' });
  }
  res.json({ scorecardFileName: row.scorecardFileName, scorecardBase64: row.scorecardBase64 });
});

app.post('/candidates', (req, res) => {
  const { name, role, notes, score, criteria, cvFileName, cvBase64, cvLink, source, company, linkedinUrl } = req.body || {};

  if (!name || !String(name).trim() || !role || !String(role).trim()) {
    return res.status(400).json({ error: 'Name and role are required.' });
  }

  const resolvedSource = SOURCES.includes(source) ? source : 'applied';

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
    onHold: 0,
    holdNote: null,
    source: resolvedSource,
    company: company ? String(company) : null,
    linkedinUrl: linkedinUrl ? String(linkedinUrl) : null,
    archived: 0,
    stage: null,
    rejectionReason: null,
    interviewDateTime: null,
    interviewConfirmed: 0,
    scorecardFileName: null,
    scorecardBase64: null,
    scoreSummary: null,
    scoredBy: null,
    cvHash: hashCv(cvBase64),
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
    const wasApproved = existing.status === 'approved';
    next.status = body.status;
    next.decidedAt = body.status === 'pending' ? null : new Date().toISOString();
    next.decisionComment = body.status === 'pending'
      ? null
      : (body.decisionComment ? String(body.decisionComment) : (existing.decisionComment || ''));

    // A hold is a pending-only concern — clear it once a real decision is made,
    // unless this same request is also explicitly setting the hold.
    if (body.status !== 'pending' && body.onHold === undefined) {
      next.onHold = 0;
      next.holdNote = null;
    }

    // Freshly approved candidates start at the top of the post-approval funnel,
    // unless this same request is also explicitly placing them at a stage.
    if (body.status === 'approved' && !wasApproved && body.stage === undefined) {
      next.stage = 'approved';
    }
    if (body.status !== 'approved') {
      next.stage = null;
    }

    // Rejecting defaults to "after second screening" (the Initial Screening flow);
    // the interview-stage reject flow passes rejectionReason explicitly.
    if (body.status === 'rejected') {
      next.rejectionReason = REJECTION_REASONS.includes(body.rejectionReason)
        ? body.rejectionReason
        : 'after_second_screening';
    } else if (body.status !== 'rejected' && body.rejectionReason === undefined) {
      next.rejectionReason = null;
    }
  }

  if (body.stage !== undefined) {
    if (body.stage !== null && !STAGES.includes(body.stage)) {
      return res.status(400).json({ error: `stage must be one of ${STAGES.join(', ')}` });
    }
    next.stage = body.stage;
  }

  if (body.rejectionReason !== undefined && body.status === undefined) {
    if (body.rejectionReason !== null && !REJECTION_REASONS.includes(body.rejectionReason)) {
      return res.status(400).json({ error: `rejectionReason must be one of ${REJECTION_REASONS.join(', ')}` });
    }
    next.rejectionReason = body.rejectionReason;
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
    next.cvHash = hashCv(next.cvBase64);
  }
  if (body.reviewNotes !== undefined) next.reviewNotes = body.reviewNotes ? String(body.reviewNotes) : null;
  if (body.onHold !== undefined) next.onHold = body.onHold ? 1 : 0;
  if (body.holdNote !== undefined) next.holdNote = body.holdNote ? String(body.holdNote) : null;
  if (body.source !== undefined) {
    if (!SOURCES.includes(body.source)) {
      return res.status(400).json({ error: `source must be one of ${SOURCES.join(', ')}` });
    }
    next.source = body.source;
  }
  if (body.company !== undefined) next.company = body.company ? String(body.company) : null;
  if (body.linkedinUrl !== undefined) next.linkedinUrl = body.linkedinUrl ? String(body.linkedinUrl) : null;
  if (body.archived !== undefined) next.archived = body.archived ? 1 : 0;
  if (body.interviewDateTime !== undefined) next.interviewDateTime = body.interviewDateTime ? String(body.interviewDateTime) : null;
  if (body.interviewConfirmed !== undefined) next.interviewConfirmed = body.interviewConfirmed ? 1 : 0;
  if (body.scorecardFileName !== undefined && body.scorecardBase64 !== undefined) {
    next.scorecardFileName = body.scorecardFileName || null;
    next.scorecardBase64 = body.scorecardBase64 || null;
  }
  if (body.scoreSummary !== undefined) next.scoreSummary = body.scoreSummary ? String(body.scoreSummary) : null;
  if (body.scoredBy !== undefined) next.scoredBy = body.scoredBy ? String(body.scoredBy) : null;

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
    onHold: next.onHold,
    holdNote: next.holdNote,
    source: next.source,
    company: next.company,
    linkedinUrl: next.linkedinUrl,
    archived: next.archived,
    stage: next.stage,
    rejectionReason: next.rejectionReason,
    interviewDateTime: next.interviewDateTime,
    interviewConfirmed: next.interviewConfirmed,
    scorecardFileName: next.scorecardFileName,
    scorecardBase64: next.scorecardBase64,
    scoreSummary: next.scoreSummary,
    scoredBy: next.scoredBy,
    cvHash: next.cvHash,
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
