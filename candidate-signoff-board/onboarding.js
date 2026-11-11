// Pure date/checklist logic for the Onboarding module — no DB, no Express.
// All dates are UTC-midnight Date objects or 'YYYY-MM-DD' strings, so calendar
// math (add days/months) never drifts across a timezone or a DST boundary.
//
// Checklist process per the build brief agreed 11 Nov 2026 (supersedes the
// earlier draft process this module originally shipped with).

function toDate(isoDateStr) {
  const [y, m, d] = isoDateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toIso(date) {
  return date.toISOString().slice(0, 10);
}
function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function addMonths(date, n) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}
function isWorkday(date) {
  const w = date.getUTCDay(); // 0=Sun .. 6=Sat
  return w !== 5 && w !== 6; // work week is Sun-Thu
}
// "Any due date that falls on a Friday or Saturday moves back to the Thursday before."
function shiftToWorkday(date) {
  let d = new Date(date);
  while (!isWorkday(d)) d = addDays(d, -1);
  return d;
}
function lastWorkdayOfMonth(year, monthIndex0) {
  // Day 0 of the *next* month = last day of this month.
  let d = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  return shiftToWorkday(d);
}
// The Sunday that starts the calendar week containing `date`.
function startOfWeek(date) {
  return addDays(date, -date.getUTCDay());
}

const MANAGER_OWNER = 'Manager';
const HR_OWNER = 'HR';

// Builds the 21-item checklist plus the three post-checklist milestone dates
// for one hire. `startDateIso`/`offerSignedAtIso` are 'YYYY-MM-DD'.
function computeChecklist(startDateIso, offerSignedAtIso, arrivalTime) {
  const start = toDate(startDateIso);
  const signedAt = toDate(offerSignedAtIso);
  const probationEnd = addMonths(start, 3); // hard legal cap, not extendable

  const month1Last = lastWorkdayOfMonth(start.getUTCFullYear(), start.getUTCMonth());
  const nextMonth = addMonths(start, 1);
  const month2Last = lastWorkdayOfMonth(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth());
  // Probation evaluation report: "first working day of Month 4" always
  // collides with the hard cap (Month 4 would start exactly when probation
  // ends), so the "fewer than 5 working days left" exception always applies
  // in practice: due date is the Sunday opening the last complete Sun-Thu
  // work week before the cap's week.
  const evalReportDate = shiftToWorkday(addDays(startOfWeek(probationEnd), -7));
  const probationEndDate = shiftToWorkday(probationEnd);

  const raw = [
    // --- Before Day 1 (starts when the offer is signed) ---
    { n: 1, stage: 'Before Day 1', title: 'Send KPI plan to manager, check all KPIs are measurable', who: 'Manager + HR', due: shiftToWorkday(addDays(start, -10)),
      emails: [{ key: 'kpi_request', label: 'Send KPI request' }, { key: 'kpi_howto', label: 'Send instructions' }] },
    { n: 2, stage: 'Before Day 1', title: 'Send hire details to HyperOne, request set-up of laptop and SIM', who: HR_OWNER, due: signedAt,
      emails: [{ key: 'hyperone_request', label: 'Send email' }] },
    { n: 3, stage: 'Before Day 1', title: "Get from manager the new hire's key contacts in other departments", who: HR_OWNER, due: shiftToWorkday(addDays(start, -7)), emails: [] },
    { n: 4, stage: 'Before Day 1', title: 'Check free accounts in ZenHR, Bricks, Odoo and email', who: HR_OWNER, due: shiftToWorkday(addDays(start, -3)), emails: [] },
    { n: 5, stage: 'Before Day 1', title: 'Send welcome email with documents checklist', who: HR_OWNER, due: shiftToWorkday(addDays(start, -3)),
      emails: [{ key: 'welcome', label: 'Send email' }] },
    { n: 6, stage: 'Before Day 1', title: 'Remind manager', who: HR_OWNER, due: shiftToWorkday(addDays(start, -1)),
      emails: [{ key: 'day_before', label: 'Send email' }] },
    { n: 7, stage: 'Before Day 1', title: 'Confirmation call to new hire', who: HR_OWNER, due: shiftToWorkday(addDays(start, -1)), emails: [] },
    // --- Day 1 (Sheikh Zayed office) ---
    { n: 8, stage: 'Day 1', title: 'Create email, ZenHR, Odoo, Bricks (portal: Ahmed Abdelsattar)', who: HR_OWNER, due: start, emails: [] },
    { n: 9, stage: 'Day 1', title: 'Team announcement email, new hire copied', who: HR_OWNER, due: start,
      emails: [{ key: 'team_announcement', label: 'Send email' }] },
    { n: 10, stage: 'Day 1', title: 'Fill info form, scan documents, enter details in ZenHR', who: HR_OWNER, due: start, emails: [] },
    { n: 11, stage: 'Day 1', title: 'Quick hello with the office team', who: HR_OWNER, due: start, emails: [] },
    { n: 12, stage: 'Day 1', title: 'Set up systems, first clock-in on ZenHR', who: HR_OWNER, due: start, emails: [] },
    { n: 13, stage: 'Day 1', title: 'Company intro: locations, org chart, vacation and attendance policy', who: HR_OWNER, due: start, emails: [] },
    { n: 14, stage: 'Day 1', title: 'Meet manager: role and expectations', who: MANAGER_OWNER, due: start, emails: [] },
    { n: 15, stage: 'Day 1', title: 'At HyperOne: sign contract, hand in documents, get laptop and SIM', who: 'New hire', due: start, emails: [] },
    // --- Day 2 ---
    { n: 16, stage: 'Day 2', title: 'Walk through 30-60-90 KPI plan', who: MANAGER_OWNER, due: shiftToWorkday(addDays(start, 1)), emails: [] },
    { n: 17, stage: 'Day 2', title: "Short sit-downs with key people they'll work with most", who: 'HR arranges', due: shiftToWorkday(addDays(start, 1)), emails: [] },
    { n: 18, stage: 'Day 2', title: 'Upload signed contract, SIM number, laptop code and KPI plan to ZenHR', who: HR_OWNER, due: shiftToWorkday(addDays(start, 1)), emails: [] },
    // --- Day 5 ---
    { n: 19, stage: 'Day 5', title: '15-min week check-in: how it went, anything missing, questions', who: HR_OWNER, due: shiftToWorkday(addDays(start, 4)), emails: [] },
    // --- Monthly check-ins (end of Month 1 and Month 2, last working day of the month) ---
    { n: 20, stage: 'Monthly check-ins', title: 'Month 1 check-in (review KPIs, how the month went, feedback, confirm)', who: 'HR + Manager', due: month1Last,
      emails: [{ key: 'month1_checkin', label: 'Send reminder' }] },
    { n: 21, stage: 'Monthly check-ins', title: 'Month 2 check-in (review KPIs, how the month went, feedback, confirm)', who: 'HR + Manager', due: month2Last,
      emails: [{ key: 'month2_checkin', label: 'Send reminder' }] },
  ];

  // "If the start date is too close, show a tight timeline warning and mark
  // the late items as due now" — only the pre-Day-1 items (1-7) can land in
  // the past relative to the offer-signed moment; everything from Day 1
  // onward is anchored to the (future) start date itself.
  let tightTimeline = false;
  const items = raw.map((item) => {
    let due = item.due;
    let dueNow = false;
    if (item.n <= 7 && due < signedAt) {
      due = signedAt;
      dueNow = true;
      tightTimeline = true;
    }
    return {
      n: item.n,
      stage: item.stage,
      title: item.title,
      who: item.who,
      dueDate: toIso(due),
      dueNow,
      emails: item.emails,
    };
  });

  return {
    items,
    tightTimeline,
    probationEndDate: toIso(probationEndDate),
    // "Shown as dates on the hire card" — not tickable checklist items.
    milestones: {
      probationEvalDate: toIso(evalReportDate),
      probationEndDate: toIso(probationEndDate),
      feedbackSurveyDate: toIso(probationEndDate),
    },
  };
}

module.exports = { computeChecklist, shiftToWorkday, lastWorkdayOfMonth, addDays, addMonths, toDate, toIso, startOfWeek, isWorkday };
