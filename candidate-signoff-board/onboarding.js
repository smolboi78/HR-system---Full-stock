// Pure date/checklist logic for the Onboarding module — no DB, no Express.
// All dates are UTC-midnight Date objects or 'YYYY-MM-DD' strings, so calendar
// math (add days/months) never drifts across a timezone or a DST boundary.

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

// Builds the 23-item template with computed due dates for one hire.
// `startDateIso`/`offerSignedAtIso` are 'YYYY-MM-DD'. `arrivalTime` is 'HH:MM'.
function computeChecklist(startDateIso, offerSignedAtIso, arrivalTime) {
  const start = toDate(startDateIso);
  const signedAt = toDate(offerSignedAtIso);
  const probationEnd = addMonths(start, 3); // hard legal cap, not extendable

  const month1Last = lastWorkdayOfMonth(start.getUTCFullYear(), start.getUTCMonth());
  const nextMonth = addMonths(start, 1);
  const month2Last = lastWorkdayOfMonth(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth());
  // Item 20: "first working day of Month 4" always collides with the hard cap
  // (Month 4 would start exactly when probation ends), so the "fewer than 5
  // working days left" exception always applies in practice: due date is the
  // Sunday opening the last complete Sun-Thu work week before the cap's week.
  const evalReportDue = addDays(startOfWeek(probationEnd), -7);

  const raw = [
    // --- Before Day 1 ---
    { n: 1, stage: 'Before Day 1', title: 'Send the 30-60-90 KPI plan to the manager', who: HR_OWNER, due: signedAt, email: 'Send email' },
    { n: 2, stage: 'Before Day 1', title: 'Filled plan returned and KPIs checked as measurable', who: 'Manager + HR', due: shiftToWorkday(addDays(start, -10)), email: null },
    { n: 3, stage: 'Before Day 1', title: 'Laptop and SIM requested from HyperOne (Mr. Mohamed Reda)', who: HR_OWNER, due: shiftToWorkday(addDays(start, -7)), email: 'Send email' },
    { n: 4, stage: 'Before Day 1', title: 'Work email and Odoo access created', who: HR_OWNER, due: shiftToWorkday(addDays(start, -3)), email: null },
    { n: 5, stage: 'Before Day 1', title: 'Welcome email sent, with the documents checklist and first-week schedule', who: HR_OWNER, due: shiftToWorkday(addDays(start, -3)), email: 'Send email' },
    { n: 6, stage: 'Before Day 1', title: 'Day-before reminder to the manager', who: HR_OWNER, due: shiftToWorkday(addDays(start, -1)), email: 'Send email' },
    { n: 7, stage: 'Before Day 1', title: 'Quick confirmation call to the new hire', who: HR_OWNER, due: shiftToWorkday(addDays(start, -1)), email: null },
    // --- Day 1 ---
    { n: 8, stage: 'Day 1', title: 'Team announcement email', who: HR_OWNER, due: start, email: 'Send email' },
    { n: 9, stage: 'Day 1', title: 'Paper info form filled in and entered in ZenHR; documents scanned', who: HR_OWNER, due: start, email: null },
    { n: 10, stage: 'Day 1', title: 'Quick hello with everyone in the office', who: HR_OWNER, due: start, email: null },
    { n: 11, stage: 'Day 1', title: 'ZenHR and other systems set up, first clock-in', who: HR_OWNER, due: start, email: null },
    { n: 12, stage: 'Day 1', title: 'Company introduction (locations, org chart) and policies including attendance', who: HR_OWNER, due: start, email: null },
    { n: 13, stage: 'Day 1', title: 'Role, expectations and walk-through of the 30-60-90 plan', who: MANAGER_OWNER, due: start, email: null },
    { n: 14, stage: 'Day 1', title: 'Laptop, SIM and hard-copy documents at HyperOne', who: 'New hire', due: start, email: null },
    // --- First week ---
    { n: 15, stage: 'First week', title: 'Day 2: shadow the manager or team; sit-downs with key people', who: 'HR arranges', due: shiftToWorkday(addDays(start, 1)), email: null },
    { n: 16, stage: 'First week', title: 'Days 3 and 4: working with the manager and team', who: MANAGER_OWNER, due: shiftToWorkday(addDays(start, 3)), email: null },
    { n: 17, stage: 'First week', title: 'Day 5: end-of-week check-in (15 minutes)', who: HR_OWNER, due: shiftToWorkday(addDays(start, 4)), email: null },
    // --- Probation ---
    { n: 18, stage: 'Probation', title: 'Month 1 check-in', who: 'HR + Manager', due: month1Last, email: 'Send reminder' },
    { n: 19, stage: 'Probation', title: 'Month 2 check-in', who: 'HR + Manager', due: month2Last, email: 'Send reminder' },
    { n: 20, stage: 'Probation', title: 'Probation evaluation report', who: 'Manager + HR', due: shiftToWorkday(evalReportDue), email: 'Send request' },
    { n: 21, stage: 'Probation', title: 'Joint decision by the CEO and manager', who: 'CEO + Manager', due: shiftToWorkday(probationEnd), email: null },
    { n: 22, stage: 'Probation', title: 'Decision passed to HyperOne for the outcome letter', who: HR_OWNER, due: shiftToWorkday(probationEnd), email: null },
    { n: 23, stage: 'Probation', title: 'Feedback survey (Jotform link)', who: HR_OWNER, due: shiftToWorkday(probationEnd), email: 'Send survey' },
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
      email: item.email,
    };
  });

  return {
    items,
    tightTimeline,
    probationEndDate: toIso(shiftToWorkday(probationEnd)),
  };
}

module.exports = { computeChecklist, shiftToWorkday, lastWorkdayOfMonth, addDays, addMonths, toDate, toIso, startOfWeek, isWorkday };
