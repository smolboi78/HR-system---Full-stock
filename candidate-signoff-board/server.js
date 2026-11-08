const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { computeChecklist } = require('./onboarding');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'candidates.db');
// Shared secret gating every /candidates route — set in Railway's Variables tab,
// never hardcoded or committed. If it's unset, the API refuses all requests
// rather than silently running open.
const ACCESS_KEY = process.env.BOARD_ACCESS_KEY || '';

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
if (!existingColumns.includes('referred')) {
  db.exec('ALTER TABLE candidates ADD COLUMN referred INTEGER NOT NULL DEFAULT 0');
}
if (!existingColumns.includes('referredBy')) {
  db.exec('ALTER TABLE candidates ADD COLUMN referredBy TEXT');
}
if (!existingColumns.includes('notesLog')) {
  db.exec("ALTER TABLE candidates ADD COLUMN notesLog TEXT NOT NULL DEFAULT '[]'");
}
if (!existingColumns.includes('moveLog')) {
  db.exec("ALTER TABLE candidates ADD COLUMN moveLog TEXT NOT NULL DEFAULT '[]'");
}

// Candidates approved before the `stage` column existed have stage=NULL, which makes
// them fail every HR tab's `stage === 'approved'` filter — backfill them into the
// first funnel stage. Safe to run on every boot: it only ever touches NULL stages.
db.exec("UPDATE candidates SET stage = 'approved' WHERE status = 'approved' AND stage IS NULL");

// Same story for rejections made before the funnel redesign: there was only one
// rejection path back then (the initial-screening one), so backfill them accordingly.
db.exec("UPDATE candidates SET rejectionReason = 'after_second_screening' WHERE status = 'rejected' AND rejectionReason IS NULL");

// Collapse note-like fields that pre-date the shared notes history (reviewer
// notes, hold note, rejection comment, and scorecard summary) into notesLog,
// so nothing written before this feature existed is lost. Deliberately does
// NOT include `notes` — that's the candidate's screening description/profile
// (still shown on its own on the card), not a commentary-style note, and
// folding it in here just duplicated it under a misleading "HR" note entry.
// Only touches rows with no history yet, so it's a one-time backfill per
// candidate, safe to run on every boot.
const rowsNeedingNotesBackfill = db.prepare("SELECT * FROM candidates WHERE notesLog IS NULL OR notesLog = '[]'").all();
if (rowsNeedingNotesBackfill.length) {
  const updateNotesLog = db.prepare('UPDATE candidates SET notesLog = ? WHERE id = ?');
  for (const row of rowsNeedingNotesBackfill) {
    const entries = [];
    if (row.reviewNotes) entries.push({ author: 'Reviewer', text: row.reviewNotes, createdAt: row.decidedAt || row.dateAdded });
    if (row.holdNote) entries.push({ author: 'Reviewer', text: row.holdNote, createdAt: row.dateAdded });
    if (row.status === 'rejected' && row.decisionComment) {
      const author = (row.rejectionReason === 'after_interview' || row.rejectionReason === 'not_fit_after_messaging') ? 'HR' : 'Reviewer';
      entries.push({ author, text: row.decisionComment, createdAt: row.decidedAt || row.dateAdded });
    }
    if (row.scoreSummary) entries.push({ author: 'HR', text: row.scoreSummary, createdAt: row.dateAdded });
    if (entries.length) {
      entries.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      updateNotesLog.run(JSON.stringify(entries), row.id);
    }
  }
}

// One-time cleanup for the mistake above: an earlier version of this backfill
// (now fixed) also copied `notes` into notesLog, duplicating the screening
// description as a fake "HR" note. Strip exactly that entry — author 'HR',
// text equal to the candidate's own `notes`, timestamp equal to their
// dateAdded — from every candidate's history. That signature only matches
// the erroneously auto-added entry, so this is safe to run on every boot.
const rowsWithAnyHistory = db.prepare("SELECT id, notes, dateAdded, notesLog FROM candidates WHERE notesLog IS NOT NULL AND notesLog != '[]'").all();
if (rowsWithAnyHistory.length) {
  const updateNotesLog = db.prepare('UPDATE candidates SET notesLog = ? WHERE id = ?');
  for (const row of rowsWithAnyHistory) {
    if (!row.notes) continue;
    const entries = JSON.parse(row.notesLog);
    const filtered = entries.filter((n) => !(n.author === 'HR' && n.text === row.notes && n.createdAt === row.dateAdded));
    if (filtered.length !== entries.length) {
      updateNotesLog.run(JSON.stringify(filtered), row.id);
    }
  }
}

// Backfill a best-effort move history for candidates added before this
// feature existed. There's no per-transition record of their past (only
// their current state plus dateAdded/decidedAt), so this gives a synthetic
// two-point history — "added to the board" and, if since decided, their
// current stage — rather than every intermediate hop. Going forward every
// real transition is logged as it happens (see the PATCH handler below).
const rowsNeedingMoveBackfill = db.prepare("SELECT * FROM candidates WHERE moveLog IS NULL OR moveLog = '[]'").all();
if (rowsNeedingMoveBackfill.length) {
  const updateMoveLog = db.prepare('UPDATE candidates SET moveLog = ? WHERE id = ?');
  for (const row of rowsNeedingMoveBackfill) {
    const entries = [{ at: row.dateAdded, by: 'HR', from: null, to: 'Initial Screening' }];
    if (row.status !== 'pending' || row.onHold) {
      const author = (row.status === 'rejected' && (row.rejectionReason === 'after_interview' || row.rejectionReason === 'not_fit_after_messaging')) ? 'HR' : 'Reviewer';
      entries.push({ at: row.decidedAt || row.dateAdded, by: author, from: 'Initial Screening', to: describeCandidateStage(row) });
    }
    updateMoveLog.run(JSON.stringify(entries), row.id);
  }
}

// --- Onboarding module tables (additive only; the Recruitment board above is
// untouched). Login/sessions land once real account emails are confirmed. ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expiresAt TEXT NOT NULL,
    usedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS managers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hires (
    id TEXT PRIMARY KEY,
    candidateId TEXT,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    company TEXT,
    phase TEXT NOT NULL DEFAULT 'awaiting_offer',
    archived INTEGER NOT NULL DEFAULT 0,
    declineReason TEXT,
    managerId TEXT,
    managerName TEXT,
    startDate TEXT,
    arrivalTime TEXT,
    offerSignedAt TEXT,
    offerDeclinedAt TEXT,
    probationEndDate TEXT,
    tightTimeline INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS checklist_items (
    id TEXT PRIMARY KEY,
    hireId TEXT NOT NULL,
    n INTEGER NOT NULL,
    stage TEXT NOT NULL,
    title TEXT NOT NULL,
    who TEXT NOT NULL,
    dueDate TEXT NOT NULL,
    dueNow INTEGER NOT NULL DEFAULT 0,
    email TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    doneAt TEXT,
    doneBy TEXT,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS org_chart (
    id TEXT PRIMARY KEY,
    fileName TEXT,
    base64 TEXT,
    uploadedAt TEXT,
    uploadedBy TEXT
  );
  CREATE TABLE IF NOT EXISTS email_templates (
    key TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

// Seed the editable manager list once, from the build brief. HR can edit it
// afterward (never re-seeded once any manager row exists).
if (db.prepare('SELECT COUNT(*) AS c FROM managers').get().c === 0) {
  const insertManager = db.prepare('INSERT INTO managers (id, name, title, active, createdAt) VALUES (?, ?, ?, 1, ?)');
  const now = new Date().toISOString();
  [
    ['Hesham Hamouda', 'Co-Founder & Exec. Board Member'],
    ['Ahmed Abdel Sattar', 'Managing Director'],
    ['Ahmed Badran', 'Finance Manager'],
    ['Ahmed Said', 'Supply Chain Manager'],
    ['Alaa Mamdouh', 'Purchasing Manager'],
  ].forEach(([name, title]) => insertManager.run(crypto.randomUUID(), name, title, now));
}

// Seed the email templates once. Only the Welcome email has Nesma's actual
// approved text (from the design mockup); the rest are drafts clearly marked
// as placeholders until she supplies the final wording, editable later without
// a code change.
if (db.prepare('SELECT COUNT(*) AS c FROM email_templates').get().c === 0) {
  const insertTemplate = db.prepare('INSERT INTO email_templates (key, subject, body, updatedAt) VALUES (?, ?, ?, ?)');
  const now = new Date().toISOString();
  const DRAFT_NOTE = '[Draft placeholder — replace with Nesma\'s final text for this template.]';
  [
    ['kpi_request', '30-60-90 KPI plan for [First name]', DRAFT_NOTE + '\n\nHi [Manager name],\n\n[First name] has signed their offer as [Role], starting [start date]. Please fill in the attached 30-60-90 KPI plan so it\'s ready before they start.'],
    ['laptop_sim', 'Laptop and SIM request: [First name]', DRAFT_NOTE + '\n\nHi Mr. Mohamed Reda,\n\nCould you arrange a laptop and SIM card for our new hire, [First name] ([Role]), starting [start date]?'],
    ['welcome', 'Welcome to Fullstock, [First name]!', 'Hi [First name],\n\nWe\'re really happy you\'re joining us as [Role], and we\'re looking forward to seeing you on [day, date] at 10:30 AM at our office in Sheikh Zayed: https://maps.app.goo.gl/99YYS9i49TvbmfuU7\n\nPlease bring the documents on the attached checklist. If anything isn\'t ready yet, bring what you have and we\'ll sort out the rest together.\n\nOn your first day, you\'ll start with me: we\'ll fill in a short info form and I\'ll get you set up on our systems. Then you\'ll meet [Manager name] and collect your laptop and SIM card from the HyperOne management. I\'ve also attached your schedule for the first week so you know what to expect.\n\nI\'ll give you a quick call the day before to confirm everything. If you have any questions before then, just reply to this email or give me a call.\n\nSee you soon!'],
    ['day_before', 'Tomorrow: [First name] starts', DRAFT_NOTE + '\n\nHi [Manager name],\n\nJust a reminder that [First name] starts tomorrow, [day, date], at 10:30 AM.'],
    ['team_announcement', 'Please welcome [First name] to the team', DRAFT_NOTE + '\n\nHi all,\n\nPlease join us in welcoming [First name], who joins us today as [Role].'],
    ['manager_briefing', 'Onboarding [First name]: what you\'ll need to do', DRAFT_NOTE + '\n\nHi [Manager name],\n\nHere\'s what we\'ll need from you as [First name] onboards as [Role].'],
  ].forEach(([key, subject, body]) => insertTemplate.run(key, subject, body, now));
}

// Seed one active hire (per the build brief) so the Onboarding screens aren't
// empty on first boot. Only runs once — any existing hire row skips it.
if (db.prepare('SELECT COUNT(*) AS c FROM hires').get().c === 0) {
  const hireId = crypto.randomUUID();
  const startDate = '2026-10-11';
  const offerSignedAt = '2026-09-15';
  const { items, tightTimeline, probationEndDate } = computeChecklist(startDate, offerSignedAt, '10:30');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO hires
      (id, candidateId, name, role, company, phase, archived, managerId, managerName, startDate, arrivalTime, offerSignedAt, probationEndDate, tightTimeline, createdAt)
    VALUES
      (@id, NULL, @name, @role, @company, 'active', 0, NULL, @managerName, @startDate, @arrivalTime, @offerSignedAt, @probationEndDate, @tightTimeline, @createdAt)
  `).run({
    id: hireId,
    name: 'Hadeer Hassan',
    role: 'Sales Supervisor, Greater Cairo',
    company: 'Jammies',
    managerName: 'Hesham Hamouda',
    startDate,
    arrivalTime: '10:30',
    offerSignedAt,
    probationEndDate,
    tightTimeline: tightTimeline ? 1 : 0,
    createdAt: now,
  });

  const insertItem = db.prepare(`
    INSERT INTO checklist_items (id, hireId, n, stage, title, who, dueDate, dueNow, email, done, doneAt, doneBy, notes)
    VALUES (@id, @hireId, @n, @stage, @title, @who, @dueDate, @dueNow, @email, @done, @doneAt, @doneBy, NULL)
  `);
  const ownerFor = (n) => (n === 13 || n === 16 ? 'Hesham Hamouda' : n === 14 ? 'Hadeer Hassan' : 'HR');
  for (const item of items) {
    const isDone = item.n <= 17; // items 1-17 done, 18 (Month 1 check-in) left overdue
    insertItem.run({
      id: crypto.randomUUID(),
      hireId,
      n: item.n,
      stage: item.stage,
      title: item.title,
      who: item.who,
      dueDate: item.dueDate,
      dueNow: item.dueNow ? 1 : 0,
      email: item.email,
      done: isDone ? 1 : 0,
      doneAt: isDone ? item.dueDate + 'T12:00:00.000Z' : null,
      doneBy: isDone ? ownerFor(item.n) : null,
    });
  }
}

const stmts = {
  list: db.prepare('SELECT * FROM candidates ORDER BY dateAdded ASC'),
  getById: db.prepare('SELECT * FROM candidates WHERE id = ?'),
  getCv: db.prepare('SELECT cvFileName, cvBase64 FROM candidates WHERE id = ?'),
  getScorecard: db.prepare('SELECT scorecardFileName, scorecardBase64 FROM candidates WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO candidates
      (id, name, role, dateAdded, notes, score, criteria, status, cvFileName, cvBase64, cvLink, decidedAt, decisionComment, reviewNotes, onHold, holdNote, source, company, linkedinUrl, archived, stage, rejectionReason, interviewDateTime, interviewConfirmed, scorecardFileName, scorecardBase64, scoreSummary, scoredBy, cvHash, referred, referredBy, notesLog, moveLog)
    VALUES
      (@id, @name, @role, @dateAdded, @notes, @score, @criteria, @status, @cvFileName, @cvBase64, @cvLink, @decidedAt, @decisionComment, @reviewNotes, @onHold, @holdNote, @source, @company, @linkedinUrl, @archived, @stage, @rejectionReason, @interviewDateTime, @interviewConfirmed, @scorecardFileName, @scorecardBase64, @scoreSummary, @scoredBy, @cvHash, @referred, @referredBy, @notesLog, @moveLog)
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
      scoreSummary = @scoreSummary, scoredBy = @scoredBy, cvHash = @cvHash,
      referred = @referred, referredBy = @referredBy, notesLog = @notesLog, moveLog = @moveLog
    WHERE id = @id
  `),
  remove: db.prepare('DELETE FROM candidates WHERE id = ?'),
};

const STATUSES = ['pending', 'approved', 'rejected'];
const SOURCES = ['applied', 'headhunting'];
const STAGES = ['approved', 'messaged', 'scheduled', 'shortlisted'];
const REJECTION_REASONS = ['after_second_screening', 'after_interview', 'not_fit_after_messaging'];
const NOTE_AUTHORS = ['HR', 'Reviewer'];

function hashCv(cvBase64) {
  if (!cvBase64) return null;
  return crypto.createHash('sha256').update(cvBase64).digest('hex');
}

// Human-readable label for wherever a candidate currently sits in the funnel —
// shared by the move-history auto-logger (to describe "from X to Y") and the
// one-time backfill below.
function describeCandidateStage(row) {
  if (row.archived) return 'Closed';
  if (row.status === 'rejected') {
    if (row.rejectionReason === 'after_interview') return 'Rejected after interview';
    if (row.rejectionReason === 'not_fit_after_messaging') return 'Not a fit (LinkedIn)';
    return 'Rejected after second screening';
  }
  if (row.status === 'pending') return row.onHold ? 'On Hold' : 'Initial Screening';
  if (row.status === 'approved') {
    if (row.stage === 'messaged') return 'Messaged on LinkedIn';
    if (row.stage === 'scheduled') return 'Scheduled for Interview';
    if (row.stage === 'shortlisted') return 'Interviewed & Shortlisted';
    return 'Approved for Interview';
  }
  return row.status;
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
    referred: !!row.referred,
    referredBy: row.referredBy || '',
    notesHistory: row.notesLog ? JSON.parse(row.notesLog) : [],
    moveHistory: row.moveLog ? JSON.parse(row.moveLog) : [],
  };
  if (includeCv) {
    candidate.cvBase64 = row.cvBase64 || null;
  }
  return candidate;
}

function getChecklistItems(hireId) {
  return db.prepare('SELECT * FROM checklist_items WHERE hireId = ? ORDER BY n ASC').all(hireId);
}

function rowToHire(row, items) {
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const todayIso = new Date().toISOString().slice(0, 10);
  const overdue = items.filter((i) => !i.done && i.dueDate < todayIso).length;
  return {
    id: row.id,
    candidateId: row.candidateId || null,
    name: row.name,
    role: row.role,
    company: row.company || '',
    phase: row.phase,
    archived: !!row.archived,
    declineReason: row.declineReason || null,
    managerId: row.managerId || null,
    managerName: row.managerName || '',
    startDate: row.startDate || null,
    arrivalTime: row.arrivalTime || null,
    offerSignedAt: row.offerSignedAt || null,
    offerDeclinedAt: row.offerDeclinedAt || null,
    probationEndDate: row.probationEndDate || null,
    tightTimeline: !!row.tightTimeline,
    notes: row.notes || '',
    createdAt: row.createdAt,
    checklist: {
      total,
      done,
      overdue,
      items: items.map((it) => ({
        id: it.id,
        n: it.n,
        stage: it.stage,
        title: it.title,
        who: it.who,
        dueDate: it.dueDate,
        dueNow: !!it.dueNow,
        email: it.email || null,
        done: !!it.done,
        doneAt: it.doneAt || null,
        doneBy: it.doneBy || null,
      })),
    },
  };
}

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// Gate every /candidates route (listing, CVs, scorecards, create/update/delete)
// behind a shared key sent as the x-access-key header. Compared with a
// constant-time check so response timing can't leak how much of the key
// a guess got right.
function requireAccessKey(req, res, next) {
  if (!ACCESS_KEY) {
    return res.status(401).json({ error: 'Server has no access key configured.' });
  }
  const provided = Buffer.from(req.get('x-access-key') || '');
  const expected = Buffer.from(ACCESS_KEY);
  const valid = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  if (!valid) {
    return res.status(401).json({ error: 'Missing or invalid access key.' });
  }
  next();
}
app.use('/candidates', requireAccessKey);
// Onboarding routes are stopgap-gated behind the same shared key until the
// per-user login system (still pending real account emails) replaces it.
app.use(['/hires', '/managers', '/checklist-items'], requireAccessKey);

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
  const {
    name, role, notes, score, criteria, cvFileName, cvBase64, cvLink, source, company, linkedinUrl,
    referred, referredBy, scheduleNow, interviewDateTime, interviewConfirmed,
  } = req.body || {};

  if (!name || !String(name).trim() || !role || !String(role).trim()) {
    return res.status(400).json({ error: 'Name and role are required.' });
  }

  const resolvedSource = SOURCES.includes(source) ? source : 'applied';
  // Referred candidates can optionally skip Initial Screening and the CEO's
  // approve/reject step entirely, landing straight in Scheduled for Interview —
  // scheduleNow implies referred, since the fast-track only makes sense for one.
  const isReferred = !!referred || !!scheduleNow;
  const fastTrack = !!scheduleNow;

  const dateAdded = new Date().toISOString();
  const trimmedNotes = notes ? String(notes).trim() : '';

  const row = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    role: String(role).trim(),
    dateAdded,
    notes: trimmedNotes || null,
    score: Number.isInteger(score) ? score : null,
    criteria: JSON.stringify(Array.isArray(criteria) ? criteria : []),
    status: fastTrack ? 'approved' : 'pending',
    cvFileName: cvFileName || null,
    cvBase64: cvBase64 || null,
    cvLink: cvLink || null,
    decidedAt: fastTrack ? dateAdded : null,
    decisionComment: fastTrack ? 'Referral — added directly to Scheduled for Interview' : null,
    reviewNotes: null,
    onHold: 0,
    holdNote: null,
    source: resolvedSource,
    company: company ? String(company) : null,
    linkedinUrl: linkedinUrl ? String(linkedinUrl) : null,
    archived: 0,
    stage: fastTrack ? 'scheduled' : null,
    rejectionReason: null,
    interviewDateTime: fastTrack && interviewDateTime ? String(interviewDateTime) : null,
    interviewConfirmed: fastTrack && interviewConfirmed ? 1 : 0,
    scorecardFileName: null,
    scorecardBase64: null,
    scoreSummary: null,
    scoredBy: null,
    cvHash: hashCv(cvBase64),
    referred: isReferred ? 1 : 0,
    referredBy: isReferred && referredBy ? String(referredBy) : null,
    notesLog: '[]',
    moveLog: '[]',
  };
  row.moveLog = JSON.stringify([{ at: dateAdded, by: 'HR', from: null, to: describeCandidateStage(row) }]);

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
  const actor = NOTE_AUTHORS.includes(body.actor) ? body.actor : 'HR';

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
  if (body.referred !== undefined) next.referred = body.referred ? 1 : 0;
  if (body.referredBy !== undefined) next.referredBy = body.referredBy ? String(body.referredBy) : null;

  // Auto-log structured notes (hold reason, rejection reason, scorecard summary,
  // reviewer notes) into the shared notes history as they're written, so the
  // history stays the one complete record without each call site needing to
  // know about it. Only logs on an actual change, so re-saving unchanged text
  // doesn't spam duplicate entries.
  const notesLogArr = existing.notesLog ? JSON.parse(existing.notesLog) : [];
  const noteNowIso = new Date().toISOString();
  if (body.holdNote !== undefined && body.holdNote && body.holdNote !== existing.holdNote) {
    notesLogArr.push({ author: 'Reviewer', text: String(body.holdNote), createdAt: noteNowIso });
  }
  if (body.status === 'rejected' && body.decisionComment) {
    const author = (next.rejectionReason === 'after_interview' || next.rejectionReason === 'not_fit_after_messaging') ? 'HR' : 'Reviewer';
    notesLogArr.push({ author, text: String(body.decisionComment), createdAt: noteNowIso });
  }
  if (body.scoreSummary !== undefined && body.scoreSummary && body.scoreSummary !== existing.scoreSummary) {
    notesLogArr.push({ author: 'HR', text: String(body.scoreSummary), createdAt: noteNowIso });
  }
  if (body.reviewNotes !== undefined && body.reviewNotes && body.reviewNotes !== existing.reviewNotes) {
    notesLogArr.push({ author: 'Reviewer', text: String(body.reviewNotes), createdAt: noteNowIso });
  }
  next.notesLog = JSON.stringify(notesLogArr);

  // Auto-log stage transitions into the shared move history, so "where did
  // they move and who moved them" stays derived from the same PATCH calls
  // that already drive every stage change, rather than needing its own
  // write path. Only logs when the computed stage label actually changes.
  const fromLabel = describeCandidateStage(existing);
  const toLabel = describeCandidateStage(next);
  const moveLogArr = existing.moveLog ? JSON.parse(existing.moveLog) : [];
  if (fromLabel !== toLabel) {
    moveLogArr.push({ at: noteNowIso, by: actor, from: fromLabel, to: toLabel });
  }
  next.moveLog = JSON.stringify(moveLogArr);

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
    referred: next.referred,
    referredBy: next.referredBy,
    notesLog: next.notesLog,
    moveLog: next.moveLog,
  });

  const updated = stmts.getById.get(req.params.id);
  res.json(rowToCandidate(updated));
});

app.post('/candidates/:id/notes', (req, res) => {
  const existing = stmts.getById.get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Candidate not found' });
  }

  const { author, text } = req.body || {};
  if (!NOTE_AUTHORS.includes(author)) {
    return res.status(400).json({ error: `author must be one of ${NOTE_AUTHORS.join(', ')}` });
  }
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'Note text is required.' });
  }

  const log = existing.notesLog ? JSON.parse(existing.notesLog) : [];
  log.push({ author, text: String(text).trim(), createdAt: new Date().toISOString() });
  db.prepare('UPDATE candidates SET notesLog = ? WHERE id = ?').run(JSON.stringify(log), req.params.id);

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

// --- Onboarding ---

app.get('/managers', (req, res) => {
  const rows = db.prepare('SELECT * FROM managers WHERE active = 1 ORDER BY name ASC').all();
  res.json(rows.map((r) => ({ id: r.id, name: r.name, title: r.title || '' })));
});

app.get('/hires', (req, res) => {
  const rows = db.prepare('SELECT * FROM hires ORDER BY createdAt ASC').all();
  res.json(rows.map((row) => rowToHire(row, getChecklistItems(row.id))));
});

app.get('/hires/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM hires WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Hire not found' });
  res.json(rowToHire(row, getChecklistItems(row.id)));
});

app.patch('/hires/:id', (req, res) => {
  const hire = db.prepare('SELECT * FROM hires WHERE id = ?').get(req.params.id);
  if (!hire) return res.status(404).json({ error: 'Hire not found' });
  const { notes } = req.body || {};
  if (notes !== undefined) {
    db.prepare('UPDATE hires SET notes = ? WHERE id = ?').run(notes ? String(notes) : null, hire.id);
  }
  const updated = db.prepare('SELECT * FROM hires WHERE id = ?').get(hire.id);
  res.json(rowToHire(updated, getChecklistItems(hire.id)));
});

// The "Hired" button on an Interviewed & Shortlisted candidate: creates the
// onboarding record under "Awaiting signed offer" and archives the candidate
// on the Recruitment board (full history kept, just moved to Archived > Closed
// — this is what "moves the candidate ... into Onboarding" actually does).
app.post('/candidates/:id/hire', (req, res) => {
  const existing = stmts.getById.get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  if (existing.status !== 'approved' || existing.stage !== 'shortlisted' || existing.archived) {
    return res.status(400).json({ error: 'Candidate must be Interviewed & Shortlisted, and not already archived.' });
  }

  const actor = NOTE_AUTHORS.includes((req.body || {}).actor) ? req.body.actor : 'HR';
  const now = new Date().toISOString();
  const hireId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO hires (id, candidateId, name, role, company, phase, archived, createdAt)
    VALUES (?, ?, ?, ?, ?, 'awaiting_offer', 0, ?)
  `).run(hireId, existing.id, existing.name, existing.role, existing.company || null, now);

  const fromLabel = describeCandidateStage(existing);
  const toLabel = describeCandidateStage({ ...existing, archived: 1 });
  const moveLogArr = existing.moveLog ? JSON.parse(existing.moveLog) : [];
  if (fromLabel !== toLabel) {
    moveLogArr.push({ at: now, by: actor, from: fromLabel, to: toLabel });
  }
  db.prepare('UPDATE candidates SET archived = 1, moveLog = ? WHERE id = ?').run(JSON.stringify(moveLogArr), existing.id);

  const hireRow = db.prepare('SELECT * FROM hires WHERE id = ?').get(hireId);
  res.status(201).json(rowToHire(hireRow, []));
});

app.patch('/hires/:id/offer-signed', (req, res) => {
  const hire = db.prepare('SELECT * FROM hires WHERE id = ?').get(req.params.id);
  if (!hire) {
    return res.status(404).json({ error: 'Hire not found' });
  }
  if (hire.phase !== 'awaiting_offer') {
    return res.status(400).json({ error: 'This hire is not awaiting a signed offer.' });
  }

  const { startDate, managerId, arrivalTime } = req.body || {};
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return res.status(400).json({ error: 'A valid start date (YYYY-MM-DD) is required.' });
  }
  const manager = managerId ? db.prepare('SELECT * FROM managers WHERE id = ?').get(managerId) : null;
  if (managerId && !manager) {
    return res.status(400).json({ error: 'Unknown manager.' });
  }

  const now = new Date().toISOString();
  const arrival = arrivalTime && /^\d{2}:\d{2}$/.test(arrivalTime) ? arrivalTime : '10:30';
  const { items, tightTimeline, probationEndDate } = computeChecklist(startDate, now.slice(0, 10), arrival);

  db.prepare(`
    UPDATE hires SET
      phase = 'active', managerId = @managerId, managerName = @managerName,
      startDate = @startDate, arrivalTime = @arrivalTime, offerSignedAt = @offerSignedAt,
      probationEndDate = @probationEndDate, tightTimeline = @tightTimeline
    WHERE id = @id
  `).run({
    id: hire.id,
    managerId: manager ? manager.id : null,
    managerName: manager ? manager.name : null,
    startDate,
    arrivalTime: arrival,
    offerSignedAt: now,
    probationEndDate,
    tightTimeline: tightTimeline ? 1 : 0,
  });

  const insertItem = db.prepare(`
    INSERT INTO checklist_items (id, hireId, n, stage, title, who, dueDate, dueNow, email, done)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);
  for (const item of items) {
    insertItem.run(crypto.randomUUID(), hire.id, item.n, item.stage, item.title, item.who, item.dueDate, item.dueNow ? 1 : 0, item.email);
  }

  const updated = db.prepare('SELECT * FROM hires WHERE id = ?').get(hire.id);
  res.json(rowToHire(updated, getChecklistItems(hire.id)));
});

app.patch('/hires/:id/offer-declined', (req, res) => {
  const hire = db.prepare('SELECT * FROM hires WHERE id = ?').get(req.params.id);
  if (!hire) {
    return res.status(404).json({ error: 'Hire not found' });
  }
  const { reason } = req.body || {};
  db.prepare('UPDATE hires SET archived = 1, declineReason = ?, offerDeclinedAt = ? WHERE id = ?')
    .run(reason ? String(reason) : null, new Date().toISOString(), hire.id);
  const updated = db.prepare('SELECT * FROM hires WHERE id = ?').get(hire.id);
  res.json(rowToHire(updated, getChecklistItems(hire.id)));
});

app.patch('/checklist-items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Checklist item not found' });
  }

  const body = req.body || {};
  const actor = NOTE_AUTHORS.includes(body.actor) ? body.actor : 'HR';
  const done = !!body.done;
  const now = new Date().toISOString();

  db.prepare('UPDATE checklist_items SET done = ?, doneAt = ?, doneBy = ? WHERE id = ?')
    .run(done ? 1 : 0, done ? now : null, done ? actor : null, item.id);

  // The Onboarding "Done" section is driven by the feedback survey (item 23)
  // being sent, per the brief ("Hires move here once their probation
  // decision is made and the feedback survey is sent").
  if (item.n === 23) {
    db.prepare('UPDATE hires SET phase = ? WHERE id = ?').run(done ? 'done' : 'active', item.hireId);
  }

  const updated = db.prepare('SELECT * FROM hires WHERE id = ?').get(item.hireId);
  res.json(rowToHire(updated, getChecklistItems(item.hireId)));
});

app.listen(PORT, () => {
  console.log(`Candidate sign-off board listening on port ${PORT}`);
  console.log(`Using database at ${DB_PATH}`);
});
