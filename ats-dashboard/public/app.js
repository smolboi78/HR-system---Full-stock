/* Fullstock ATS dashboard frontend (vanilla JS, no build step). */
(function () {
  'use strict';

  var KEY_STORE = 'fullstock-ats-key';
  var STATUS_LABEL = { open: 'Open', on_hold: 'On hold', closed: 'Closed' };
  var STAGE_LABEL = {
    applied: 'Applied / Messaged',
    interviewed: 'Interviewed',
    shortlisted: 'Shortlisted',
    rejected_before: 'Rejected before interview',
    rejected_after: 'Rejected after interview'
  };
  var COLS = [
    { key: 'all', label: 'Applied / Messaged', test: function () { return true; } },
    { key: 'int', label: 'Interviewed', test: function (c) { return c.stage === 'interviewed' || c.stage === 'shortlisted' || c.stage === 'rejected_after'; } },
    { key: 'sl', label: 'Shortlisted', test: function (c) { return c.stage === 'shortlisted'; } },
    { key: 'rej', label: 'Rejected', test: function (c) { return c.stage === 'rejected_before' || c.stage === 'rejected_after'; } }
  ];
  var CHEVRON = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  var XICON = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  var GRIP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
  var UP = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
  var DOWN = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

  // Shortlisted candidates in rank order; anyone not ranked yet goes last, oldest first.
  function rankSort(list) {
    return list.slice().sort(function (a, b) {
      var ra = a.shortlistRank == null ? Infinity : a.shortlistRank;
      var rb = b.shortlistRank == null ? Infinity : b.shortlistRank;
      if (ra !== rb) return ra - rb;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
  }
  function saveRank(jobId, ids) {
    ids.forEach(function (id, i) { var c = candById(id); if (c) c.shortlistRank = i + 1; });
    render();
    api('PUT', '/api/jobs/' + jobId + '/shortlist-order', { order: ids })
      .then(function () { toast('Ranking saved'); })
      .catch(function (err) { toast(err.message); load(); });
  }
  function shortlistIds(jobId) {
    return rankSort(candsFor(jobId).filter(COLS[2].test)).map(function (c) { return c.id; });
  }

  var state = { role: null, jobs: [], candidates: [], filter: 'all', open: null };
  var app = document.getElementById('app');
  var modal = document.getElementById('modal');

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function getKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { localStorage.setItem(KEY_STORE, k); } catch (e) { /* ignore */ } }
  function clearKey() { try { localStorage.removeItem(KEY_STORE); } catch (e) { /* ignore */ } }
  function isAdmin() { return state.role === 'admin'; }

  function api(method, url, body) {
    var opts = { method: method, headers: { 'x-access-key': getKey() } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401) { clearKey(); showGate('That key did not work. Please enter it again.'); throw new Error('unauthorized'); }
        if (!r.ok) throw new Error(data.error || ('Request failed (' + r.status + ')'));
        return data;
      });
    });
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }
  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d)) return esc(v);
    var hasTime = /T\d\d:\d\d/.test(v);
    var opts = { month: 'short', day: 'numeric', year: 'numeric' };
    if (hasTime) { opts.hour = 'numeric'; opts.minute = '2-digit'; }
    return d.toLocaleString('en-US', opts);
  }
  function jobById(id) { return state.jobs.filter(function (j) { return j.id === id; })[0]; }
  function candById(id) { return state.candidates.filter(function (c) { return c.id === id; })[0]; }
  function candsFor(jobId) { return state.candidates.filter(function (c) { return c.jobId === jobId; }); }
  function readFile(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('Could not read the file.')); };
      fr.readAsDataURL(file);
    });
  }

  // The interviewer whose scores and decision show on the one-line row (Hesham by default).
  function primaryEval(c) {
    var who = String(c.primaryInterviewer || 'Hesham').toLowerCase();
    var ev = c.evaluations || [];
    return ev.filter(function (e) { return String(e.interviewer || '').toLowerCase().indexOf(who) !== -1; })[0] || null;
  }
  function scoreHtml(score, max) {
    if (score == null) return '<span class="score na">-</span>';
    var text = max ? (score + ' / ' + max) : String(score);
    var pct = max ? score / max * 100 : score;
    var cls = pct >= 80 ? 'hi' : (pct >= 65 ? 'mid' : 'lo');
    return '<span class="score ' + cls + '" title="' + (max ? Math.round(pct) + '%' : '') + '">' + esc(text) + '</span>';
  }
  function avg(list, sk, mk) {
    var xs = list.filter(function (e) { return e[sk] != null; });
    if (!xs.length) return '-';
    var withMax = xs.filter(function (e) { return e[mk]; });
    if (withMax.length === xs.length) {
      var p = withMax.reduce(function (a, e) { return a + e[sk] / e[mk]; }, 0) / withMax.length * 100;
      return Math.round(p) + '%';
    }
    return (Math.round(xs.reduce(function (a, e) { return a + e[sk]; }, 0) / xs.length * 10) / 10).toString();
  }

  // ---------- gate ----------
  function showGate(msg) {
    modal.innerHTML = '';
    app.innerHTML = '<form class="gate" id="gate">' +
      '<img src="img/fullstock-logo.png" alt="Fullstock">' +
      '<h1 class="display" style="font-size:24px">Recruitment dashboard</h1>' +
      '<div class="f"><label for="gk">Access key</label><input id="gk" type="password" autocomplete="current-password" required></div>' +
      (msg ? '<div class="err">' + esc(msg) + '</div>' : '') +
      '<button class="btn" type="submit">Open dashboard</button></form>';
    document.getElementById('gate').addEventListener('submit', function (e) {
      e.preventDefault();
      setKey(document.getElementById('gk').value.trim());
      load();
    });
  }

  // ---------- data ----------
  function load() {
    return api('GET', '/api/data').then(function (d) {
      state.role = d.role; state.jobs = d.jobs; state.candidates = d.candidates;
      render();
    }).catch(function (e) { if (e.message !== 'unauthorized') app.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }

  // ---------- dashboard ----------
  function render() {
    var jobs = state.jobs;
    var all = state.candidates;
    var cnt = function (t) { return all.filter(t).length; };
    var msg = cnt(function (c) { return c.source === 'messaged'; });
    var intv = cnt(COLS[1].test);
    var sl = cnt(COLS[2].test);
    var openJobs = jobs.filter(function (j) { return j.status === 'open'; }).length;
    var onHold = jobs.filter(function (j) { return j.status === 'on_hold'; }).length;

    var h = '';
    h += '<header class="head"><div><h1>Recruitment overview</h1><p>Click any number in the table to see the candidates behind it.</p></div><div class="actions">';
    if (isAdmin()) h += '<button class="btn" data-a="new-job">+ New job</button>';
    else h += '<span class="pill view">View only</span>';
    h += '</div></header>';

    h += '<section class="kpis" aria-label="Summary">' +
      kpi('Open jobs', openJobs, jobs.length + (jobs.length === 1 ? ' job' : ' jobs') + ' in total, ' + onHold + ' on hold') +
      kpi('Applied / Messaged', all.length, (all.length - msg) + ' applied · ' + msg + ' messaged') +
      kpi('Interviewed', intv, all.length ? Math.round(intv / all.length * 100) + '% of everyone who came in' : 'No candidates yet') +
      '<div class="kpi dark"><span class="l">Shortlisted</span><span class="v">' + sl + '</span><span class="s">out of ' + intv + ' interviewed</span></div>' +
      kpi('Rejected', cnt(COLS[3].test), 'closed out at any stage') +
      '</section>';

    var tabs = [['all', 'All'], ['open', 'Open'], ['on_hold', 'On hold'], ['closed', 'Closed']];
    h += '<section class="card" aria-label="Jobs"><div class="cardhead"><h2>Jobs</h2><div class="tabs">';
    tabs.forEach(function (t) {
      var n = t[0] === 'all' ? jobs.length : jobs.filter(function (j) { return j.status === t[0]; }).length;
      h += '<button class="tab" data-a="filter" data-v="' + t[0] + '" aria-pressed="' + (state.filter === t[0]) + '">' + t[1] + ' · ' + n + '</button>';
    });
    h += '</div></div>';

    var shown = jobs.filter(function (j) { return state.filter === 'all' || j.status === state.filter; });
    if (!jobs.length) {
      h += '<p class="empty">No jobs yet.' + (isAdmin() ? ' Use "+ New job" to add the first one.' : '') + '</p>';
    } else if (!shown.length) {
      h += '<p class="empty">No jobs with this status.</p>';
    } else {
      h += '<div class="tablebox"><table class="jobs"><thead><tr><th scope="col">Job</th><th scope="col" style="width:150px">Status</th>';
      COLS.forEach(function (c) { h += '<th scope="col" class="c" style="width:140px">' + c.label + '</th>'; });
      h += '</tr></thead><tbody>';
      shown.forEach(function (j) { h += jobRow(j); });
      h += '</tbody></table></div>';
    }
    h += '</section>';
    app.innerHTML = h;
  }
  function kpi(l, v, s) {
    return '<div class="kpi"><span class="l">' + l + '</span><span class="v">' + v + '</span><span class="s">' + esc(s) + '</span></div>';
  }

  function jobRow(j) {
    var cands = candsFor(j.id);
    var isOpen = state.open && state.open.job === j.id;
    var meta = [j.department, j.location, j.hiringManager ? 'Manager: ' + j.hiringManager : ''].filter(Boolean).join(' · ');
    var h = '<tr class="' + (isOpen ? 'isopen' : '') + '"><td><div class="jt">' + esc(j.title) + '</div>' +
      (meta ? '<div class="jm">' + esc(meta) + '</div>' : '');
    if (isAdmin()) {
      h += '<div class="jobtools"><button class="linkbtn" data-a="edit-job" data-id="' + j.id + '">Edit job</button>' +
        '<button class="linkbtn" data-a="new-cand" data-id="' + j.id + '">+ Add candidate</button></div>';
    }
    h += '</td><td>';
    if (isAdmin()) {
      h += '<select class="status st-' + j.status + '" data-a="status" data-id="' + j.id + '" aria-label="Status for ' + esc(j.title) + '">';
      ['open', 'on_hold', 'closed'].forEach(function (s) {
        h += '<option value="' + s + '"' + (s === j.status ? ' selected' : '') + '>' + STATUS_LABEL[s] + '</option>';
      });
      h += '</select>';
    } else {
      h += '<span class="status st-' + j.status + '">' + STATUS_LABEL[j.status] + '</span>';
    }
    h += '</td>';
    COLS.forEach(function (col) {
      var n = cands.filter(col.test).length;
      var active = isOpen && state.open.col === col.key;
      h += '<td class="c"><button class="count' + (col.key === 'rej' ? ' rej' : '') + '" data-a="cell" data-id="' + j.id + '" data-col="' + col.key + '" aria-expanded="' + active + '" aria-label="' + esc(col.label + ' for ' + j.title + ': ' + n) + '"><span>' + n + '</span>' + CHEVRON + '</button>';
      if (col.key === 'all') {
        var m = cands.filter(function (c) { return c.source === 'messaged'; }).length;
        h += '<div class="sub">' + (n - m) + ' applied · ' + m + ' msg</div>';
      }
      h += '</td>';
    });
    h += '</tr>';
    if (isOpen) h += panelRow(j, cands);
    return h;
  }

  function panelRow(j, cands) {
    var col = COLS.filter(function (c) { return c.key === state.open.col; })[0];
    var list = cands.filter(col.test);
    var ranking = col.key === 'sl';
    if (ranking) list = rankSort(list);
    var canDrag = ranking && list.length > 1;
    var h = '<tr><td colspan="6" class="panelcell"><div class="panel"><div class="ph"><h3>' + esc(col.label + ' · ' + j.title + ' (' + list.length + ')') + '</h3><div class="tabs">';
    if (isAdmin()) h += '<button class="btn small" data-a="new-cand" data-id="' + j.id + '">+ Add candidate</button>';
    h += '<button class="btn small ghost" data-a="close">Close</button></div></div><div class="list"><div class="tablebox"><div style="min-width:820px">' +
      '<div class="lrow hdr"><span>Name</span><span>Interview date</span><span>Technical</span><span>Behavioral</span><span>Comment</span><span></span></div><div class="lscroll">';
    if (!list.length) h += '<div class="empty">No candidates here yet.</div>';
    list.forEach(function (c, idx) {
      var pe = primaryEval(c);
      var rankBits = '';
      if (ranking) {
        rankBits = '<span class="rank">#' + (idx + 1) + '</span>';
        if (canDrag) {
          rankBits = '<span class="grip" aria-hidden="true">' + GRIP + '</span>' + rankBits +
            '<span class="mv"><button type="button" class="mvbtn" data-a="rank-up" data-id="' + c.id + '" data-job="' + j.id + '" aria-label="Move ' + esc(c.name) + ' up"' + (idx === 0 ? ' disabled' : '') + '>' + UP + '</button>' +
            '<button type="button" class="mvbtn" data-a="rank-down" data-id="' + c.id + '" data-job="' + j.id + '" aria-label="Move ' + esc(c.name) + ' down"' + (idx === list.length - 1 ? ' disabled' : '') + '>' + DOWN + '</button></span>';
        }
      }
      h += '<div class="lrow' + (ranking ? ' ranked' : '') + '"' + (canDrag ? ' draggable="true" data-drag="' + c.id + '" data-job="' + j.id + '"' : '') + '><div class="nmcell">' + rankBits + '<div><div class="nm">' + esc(c.name) + '</div><div class="nmsub">' + (c.source === 'messaged' ? 'Messaged' : 'Applied') + ' · ' + esc(STAGE_LABEL[c.stage]) + '</div></div></div>' +
        '<span>' + (c.interviewDateTime ? fmtDate(c.interviewDateTime) : '<span class="muted">Not interviewed</span>') + '</span>' +
        '<span>' + (pe ? scoreHtml(pe.techScore, pe.techMax) : scoreHtml(null)) + '</span>' +
        '<span>' + (pe ? scoreHtml(pe.behScore, pe.behMax) : scoreHtml(null)) + '</span>' +
        '<span class="cmt" title="' + esc(c.decision || '') + '">' + (c.decision ? esc(c.decision) : '<span class="muted">-</span>') + '</span>' +
        '<button class="more" data-a="more" data-id="' + c.id + '">More</button></div>';
    });
    h += '</div></div></div></div>';
    if (canDrag) h += '<p class="hint" style="margin:0 0 6px">Drag the shortlisted candidates (or use the arrows) to rank them. #1 is the top choice.</p>';
    h += '</div></td></tr>';
    return h;
  }

  // ---------- candidate detail ("More") ----------
  function openDetail(id) {
    var c = candById(id);
    if (!c) return;
    var j = jobById(c.jobId) || {};
    var ev = c.evaluations || [];
    var who = String(c.primaryInterviewer || 'Hesham').toLowerCase();
    var h = '<div class="overlay" data-a="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-label="Candidate details">' +
      '<div class="dhead"><div><div class="k">' + (ev.length ? 'Scorecard report' : 'Candidate') + '</div><h2>' + esc(c.name) + '</h2>' +
      '<div class="m">' + esc(j.title || '') + ' · ' + esc(STAGE_LABEL[c.stage]) + (c.interviewDateTime ? ' · Interviewed ' + fmtDate(c.interviewDateTime) : '') + '</div></div>' +
      '<button class="x" data-a="close-modal" aria-label="Close">' + XICON + '</button></div><div class="dbody">';

    if (c.decision) h += '<div class="decision"><div class="l">' + esc(c.primaryInterviewer || 'Hesham') + '\'s decision</div>' + esc(c.decision) + '</div>';

    if (ev.length) {
      h += '<div class="minis">' +
        '<div class="mini"><span class="l">Technical (average)</span><span class="v">' + avg(ev, 'techScore', 'techMax') + '</span></div>' +
        '<div class="mini"><span class="l">Behavioral (average)</span><span class="v">' + avg(ev, 'behScore', 'behMax') + '</span></div>' +
        '<div class="mini"><span class="l">Interviewers</span><span class="v">' + ev.length + '</span></div></div>';
      h += '<div><h3 style="margin-bottom:8px">Who scored what</h3><div class="etable"><div class="scroll"><div class="inner">' +
        '<div class="erow hdr"><span>Interviewer</span><span>Sheet</span><span>Technical</span><span>Behavioral</span><span>Comment</span></div>';
      ev.forEach(function (e) {
        var prim = String(e.interviewer).toLowerCase().indexOf(who) !== -1;
        h += '<div class="erow' + (prim ? ' primary' : '') + '"><span style="font-weight:600">' + esc(e.interviewer) + '</span><span>' + esc(e.sheet || '-') + '</span>' +
          '<span>' + scoreHtml(e.techScore, e.techMax) + '</span><span>' + scoreHtml(e.behScore, e.behMax) + '</span>' +
          '<span style="color:var(--soft);font-size:13px;line-height:1.45;white-space:pre-wrap">' + esc(e.comment || '') + '</span></div>';
      });
      h += '</div></div></div></div>';
    } else {
      h += '<p class="muted" style="margin:0">No interview scores yet.</p>';
    }

    h += '<div class="files">' +
      (c.hasReport ? '<button class="btn dark" data-a="file" data-kind="report" data-id="' + c.id + '">Open scorecard report (PDF)</button>' : '') +
      (c.hasCv ? '<button class="btn ghost" data-a="file" data-kind="cv" data-id="' + c.id + '">Open CV</button>' : '') +
      (c.linkedinUrl ? '<a class="btn ghost" href="' + esc(c.linkedinUrl) + '" target="_blank" rel="noopener">LinkedIn</a>' : '') + '</div>';

    h += '<div class="facts">' +
      fact('Source', c.source === 'messaged' ? 'Messaged' : 'Applied') + fact('Phone', c.phone) + fact('Email', c.email) + '</div>';
    if (c.notes) h += '<div><h3 style="margin-bottom:8px">Notes</h3><div class="notes">' + esc(c.notes) + '</div></div>';
    h += '</div>';
    if (isAdmin()) h += '<div class="dfoot"><span></span><div class="r"><button class="btn" data-a="edit-cand" data-id="' + c.id + '">Edit candidate</button></div></div>';
    h += '</div></div>';
    modal.innerHTML = h;
  }
  function fact(l, v) { return '<div><div class="l">' + l + '</div>' + (v ? esc(v) : '<span class="muted">-</span>') + '</div>'; }

  function openFile(id, kind) {
    var w = window.open('', '_blank');
    api('GET', '/api/candidates/' + id + '/' + kind).then(function (d) {
      var parts = d.base64.split(',');
      var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'application/pdf';
      var bin = atob(parts[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: mime }));
      if (w) w.location = url; else window.location = url;
    }).catch(function (e) { if (w) w.close(); toast(e.message); });
  }

  // ---------- job form ----------
  function openJobForm(id) {
    var j = id ? jobById(id) : { status: 'open', dateOpened: new Date().toISOString().slice(0, 10) };
    var h = '<div class="overlay" data-a="overlay"><form class="dialog narrow" id="jobform" role="dialog" aria-modal="true" aria-label="Job">' +
      '<div class="dhead"><div><div class="k">' + (id ? 'Edit job' : 'New job') + '</div><h2>' + esc(id ? j.title : 'Add a job') + '</h2></div>' +
      '<button type="button" class="x" data-a="close-modal" aria-label="Close">' + XICON + '</button></div>' +
      '<div class="dbody"><div class="form">' +
      field('title', 'Job title', j.title, 'text', true, true) +
      field('department', 'Department', j.department) + field('location', 'Location', j.location) +
      field('hiringManager', 'Hiring manager', j.hiringManager) + field('dateOpened', 'Date opened', j.dateOpened, 'date') +
      '<div class="f"><label for="f-status">Status</label><select id="f-status" name="status">' +
      ['open', 'on_hold', 'closed'].map(function (s) { return '<option value="' + s + '"' + (s === j.status ? ' selected' : '') + '>' + STATUS_LABEL[s] + '</option>'; }).join('') +
      '</select></div></div><div class="err" id="ferr"></div></div>' +
      '<div class="dfoot">' + (id ? '<button type="button" class="btn danger" data-a="archive-job" data-id="' + id + '">Archive job</button>' : '<span></span>') +
      '<div class="r"><button type="button" class="btn ghost" data-a="close-modal">Cancel</button><button class="btn" type="submit">Save job</button></div></div></form></div>';
    modal.innerHTML = h;
    document.getElementById('jobform').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var body = {};
      fd.forEach(function (v, k) { body[k] = v; });
      var btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
      (id ? api('PATCH', '/api/jobs/' + id, body) : api('POST', '/api/jobs', body)).then(function () {
        modal.innerHTML = ''; toast('Job saved'); return load();
      }).catch(function (err) { btn.disabled = false; document.getElementById('ferr').textContent = err.message; });
    });
  }
  function field(name, label, val, type, wide, req) {
    return '<div class="f' + (wide ? ' wide' : '') + '"><label for="f-' + name + '">' + label + '</label><input id="f-' + name + '" name="' + name + '" type="' + (type || 'text') + '" value="' + esc(val || '') + '"' + (req ? ' required' : '') + '></div>';
  }

  // ---------- candidate form ----------
  function openCandForm(id, jobId) {
    var c = id ? candById(id) : { jobId: jobId, source: 'applied', stage: 'applied', primaryInterviewer: 'Hesham', evaluations: [] };
    var dt = c.interviewDateTime ? String(c.interviewDateTime).slice(0, 16) : '';
    var h = '<div class="overlay" data-a="overlay"><form class="dialog" id="candform" role="dialog" aria-modal="true" aria-label="Candidate">' +
      '<div class="dhead"><div><div class="k">' + (id ? 'Edit candidate' : 'New candidate') + '</div><h2>' + esc(id ? c.name : 'Add a candidate') + '</h2></div>' +
      '<button type="button" class="x" data-a="close-modal" aria-label="Close">' + XICON + '</button></div><div class="dbody"><div class="form">' +
      field('name', 'Full name', c.name, 'text', false, true) +
      '<div class="f"><label for="f-jobId">Job</label><select id="f-jobId" name="jobId">' +
      state.jobs.map(function (j) { return '<option value="' + j.id + '"' + (j.id === c.jobId ? ' selected' : '') + '>' + esc(j.title) + '</option>'; }).join('') + '</select></div>' +
      sel('source', 'Source', c.source, [['applied', 'Applied'], ['messaged', 'Messaged']]) +
      sel('stage', 'Stage', c.stage, Object.keys(STAGE_LABEL).map(function (k) { return [k, STAGE_LABEL[k]]; })) +
      field('interviewDateTime', 'Interview date and time', dt, 'datetime-local') +
      field('primaryInterviewer', 'Scores shown on the row come from', c.primaryInterviewer) +
      field('phone', 'Phone', c.phone, 'tel') + field('email', 'Email', c.email, 'email') +
      field('linkedinUrl', 'LinkedIn link', c.linkedinUrl, 'url', true) +
      '<div class="f wide"><label for="f-decision">Hesham\'s decision (shown as the comment)</label><textarea id="f-decision" name="decision">' + esc(c.decision || '') + '</textarea></div>' +
      '<div class="f wide"><label for="f-notes">Notes</label><textarea id="f-notes" name="notes">' + esc(c.notes || '') + '</textarea></div>' +
      fileField('cv', 'CV', c.hasCv ? c.cvFileName : '') + fileField('report', 'Scorecard report (PDF)', c.hasReport ? c.reportFileName : '') +
      '</div><div><div class="cardhead" style="margin-bottom:10px"><h3>Interviewer scores</h3><button type="button" class="btn small ghost" data-a="add-eval">+ Add interviewer</button></div>' +
      '<div class="evals" id="evals">' + (c.evaluations || []).map(evalRow).join('') + '</div></div>' +
      '<div class="err" id="ferr"></div></div>' +
      '<div class="dfoot">' + (id ? '<button type="button" class="btn danger" data-a="archive-cand" data-id="' + id + '">Archive candidate</button>' : '<span></span>') +
      '<div class="r"><button type="button" class="btn ghost" data-a="close-modal">Cancel</button><button class="btn" type="submit">Save candidate</button></div></div></form></div>';
    modal.innerHTML = h;
    var form = document.getElementById('candform');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var g = function (n) { var el = form.elements[n]; return el ? el.value : ''; };
      var body = {};
      ['name', 'jobId', 'source', 'stage', 'interviewDateTime', 'primaryInterviewer', 'phone', 'email', 'linkedinUrl', 'decision', 'notes'].forEach(function (k) { body[k] = g(k); });
      body.evaluations = Array.prototype.map.call(form.querySelectorAll('.evrow'), function (r) {
        var q = function (n) { return r.querySelector('[data-f="' + n + '"]').value; };
        return { interviewer: q('interviewer'), sheet: q('sheet'), techScore: q('techScore'), techMax: q('techMax'), behScore: q('behScore'), behMax: q('behMax'), comment: q('comment') };
      });
      var btn = form.querySelector('[type=submit]'); btn.disabled = true;
      var cvF = form.elements.cvFile.files[0];
      var repF = form.elements.reportFile.files[0];
      Promise.all([cvF ? readFile(cvF) : null, repF ? readFile(repF) : null]).then(function (files) {
        if (files[0]) { body.cvFileName = cvF.name; body.cvBase64 = files[0]; }
        if (files[1]) { body.reportFileName = repF.name; body.reportBase64 = files[1]; }
        return id ? api('PATCH', '/api/candidates/' + id, body) : api('POST', '/api/candidates', body);
      }).then(function (saved) {
        toast('Candidate saved');
        return load().then(function () { openDetail(saved.id); });
      }).catch(function (err) { btn.disabled = false; document.getElementById('ferr').textContent = err.message; });
    });
  }
  function sel(name, label, val, opts) {
    return '<div class="f"><label for="f-' + name + '">' + label + '</label><select id="f-' + name + '" name="' + name + '">' +
      opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>';
  }
  function fileField(name, label, current) {
    return '<div class="f"><label for="f-' + name + 'File">' + label + '</label><input id="f-' + name + 'File" name="' + name + 'File" type="file" accept=".pdf,.doc,.docx,image/*">' +
      '<span class="hint">' + (current ? 'Current: ' + esc(current) + '. Choose a file to replace it.' : 'No file yet.') + '</span></div>';
  }
  var evalSeq = 0;
  function evalRow(e) {
    e = e || {};
    var n = ++evalSeq;
    var inp = function (f, label, v, type) {
      return '<div class="f"><label for="ev' + n + f + '">' + label + '</label><input id="ev' + n + f + '" data-f="' + f + '" type="' + (type || 'text') + '" step="any" value="' + esc(v == null ? '' : v) + '"></div>';
    };
    return '<div class="evrow">' + inp('interviewer', 'Interviewer', e.interviewer) +
      '<div class="f"><label for="ev' + n + 'sheet">Sheet</label><select id="ev' + n + 'sheet" data-f="sheet"><option value="">-</option>' +
      ['Behavioral', 'Technical', 'Both'].map(function (s) { return '<option' + (s === e.sheet ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
      inp('techScore', 'Tech score', e.techScore, 'number') + inp('techMax', 'out of', e.techMax, 'number') +
      inp('behScore', 'Beh. score', e.behScore, 'number') + inp('behMax', 'out of', e.behMax, 'number') +
      '<button type="button" class="iconbtn" data-a="del-eval" aria-label="Remove interviewer">' + XICON + '</button>' +
      '<div class="f cm"><label for="ev' + n + 'comment">Comment</label><input id="ev' + n + 'comment" data-f="comment" value="' + esc(e.comment || '') + '"></div></div>';
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-a]');
    if (!t) return;
    var a = t.getAttribute('data-a');
    var id = t.getAttribute('data-id');
    if (a === 'overlay') { if (e.target === t) modal.innerHTML = ''; return; }
    if (a === 'close-modal') { modal.innerHTML = ''; return; }
    if (a === 'filter') { state.filter = t.getAttribute('data-v'); render(); return; }
    if (a === 'cell') {
      var col = t.getAttribute('data-col');
      state.open = (state.open && state.open.job === id && state.open.col === col) ? null : { job: id, col: col };
      render(); return;
    }
    if (a === 'close') { state.open = null; render(); return; }
    if (a === 'more') { openDetail(id); return; }
    if (a === 'file') { openFile(id, t.getAttribute('data-kind')); return; }
    if (a === 'rank-up' || a === 'rank-down') {
      var jid = t.getAttribute('data-job');
      var ids = shortlistIds(jid);
      var i = ids.indexOf(id);
      var k = a === 'rank-up' ? i - 1 : i + 1;
      if (i < 0 || k < 0 || k >= ids.length) return;
      ids.splice(i, 1); ids.splice(k, 0, id);
      saveRank(jid, ids);
      setTimeout(function () { var b = document.querySelector('[data-a="' + a + '"][data-id="' + id + '"]'); if (b && !b.disabled) b.focus(); }, 0);
      return;
    }
    if (!isAdmin()) return;
    if (a === 'new-job') openJobForm(null);
    else if (a === 'edit-job') openJobForm(id);
    else if (a === 'new-cand') openCandForm(null, id);
    else if (a === 'edit-cand') openCandForm(id);
    else if (a === 'add-eval') document.getElementById('evals').insertAdjacentHTML('beforeend', evalRow({}));
    else if (a === 'del-eval') t.closest('.evrow').remove();
    else if (a === 'archive-job') {
      if (!confirmText('Archive this job? It will be hidden from the dashboard.')) return;
      api('PATCH', '/api/jobs/' + id, { archived: true }).then(function () { modal.innerHTML = ''; toast('Job archived'); load(); }).catch(function (err) { toast(err.message); });
    } else if (a === 'archive-cand') {
      if (!confirmText('Archive this candidate? They will be hidden from the counts.')) return;
      api('PATCH', '/api/candidates/' + id, { archived: true }).then(function () { modal.innerHTML = ''; toast('Candidate archived'); load(); }).catch(function (err) { toast(err.message); });
    }
  });
  function confirmText(msg) { return window.confirm(msg); }

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.getAttribute('data-a') === 'status' && isAdmin()) {
      var id = t.getAttribute('data-id');
      api('PATCH', '/api/jobs/' + id, { status: t.value }).then(function (j) {
        state.jobs = state.jobs.map(function (x) { return x.id === id ? j : x; });
        render(); toast('Status updated');
      }).catch(function (err) { toast(err.message); load(); });
    }
  });
  // Drag and drop ranking (mouse). Arrow buttons cover keyboard and touch.
  var dragId = null;
  document.addEventListener('dragstart', function (e) {
    var row = e.target.closest && e.target.closest('[data-drag]');
    if (!row) return;
    dragId = row.getAttribute('data-drag');
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch (err) { /* ignore */ }
  });
  document.addEventListener('dragover', function (e) {
    if (!dragId) return;
    var row = e.target.closest && e.target.closest('[data-drag]');
    if (!row) return;
    e.preventDefault();
    var r = row.getBoundingClientRect();
    var after = e.clientY > r.top + r.height / 2;
    document.querySelectorAll('.drop-before,.drop-after').forEach(function (x) { x.classList.remove('drop-before', 'drop-after'); });
    if (row.getAttribute('data-drag') !== dragId) row.classList.add(after ? 'drop-after' : 'drop-before');
  });
  document.addEventListener('drop', function (e) {
    if (!dragId) return;
    var row = e.target.closest && e.target.closest('[data-drag]');
    if (!row) return;
    e.preventDefault();
    var target = row.getAttribute('data-drag');
    var jid = row.getAttribute('data-job');
    var after = row.classList.contains('drop-after');
    var moving = dragId;
    dragId = null;
    if (target === moving) { render(); return; }
    var ids = shortlistIds(jid).filter(function (x) { return x !== moving; });
    var k = ids.indexOf(target) + (after ? 1 : 0);
    ids.splice(k, 0, moving);
    saveRank(jid, ids);
  });
  document.addEventListener('dragend', function () {
    dragId = null;
    document.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(function (x) { x.classList.remove('dragging', 'drop-before', 'drop-after'); });
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.innerHTML) modal.innerHTML = ''; });

  // ---------- start ----------
  // A shared link can carry the key as ?key=... (the view-only link does this);
  // it is saved and then removed from the address bar.
  var params = new URLSearchParams(location.search);
  if (params.get('key')) {
    setKey(params.get('key'));
    history.replaceState(null, '', location.pathname);
  }
  if (getKey()) load(); else showGate();
})();
