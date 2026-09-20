/* Yomitaku — 交互逻辑（无依赖，支持 file:// 直接打开）
   题库来源：js/bank.js 中手写的 BANK + 「真题·题库」页导入的自定义题组（存 localStorage） */
(function () {
  'use strict';

  var LS_KEY = 'yt_n1_dokkai_v1';        // 练习记录/错题/统计
  var LS_CUSTOM = 'yt_custom_sets_v1';   // 页面导入的自定义题组
  var LS_THEME = 'yt_theme';             // 深色模式偏好（缺省跟随系统）
  var SIG_WORDS = ['にもかかわらず', 'とはいえ', 'これに対して', '言い換えれば', 'したがって', 'けれども', 'しかし', 'なぜなら', 'ところが', 'それでも', 'もっとも', 'たしかに', 'もちろん', 'すなわち', 'そのため', 'それゆえ', '要するに', 'つまり', '確かに', 'たしか', '一方', 'だが', 'ただし'];
  var SIG_RE = new RegExp('(' + SIG_WORDS.join('|') + ')', 'g');
  var LABELS = ['①', '②', '③', '④'];
  var TYPE_KEYS = ['tanbun', 'chubun', 'chobun', 'togo', 'shucho', 'joho'];

  /* ---------- storage ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function save(d) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(d)); }
    catch (e) { toast('保存失败：浏览器本地存储不可用或已满', false); }
  }
  function customSets() {
    try { return JSON.parse(localStorage.getItem(LS_CUSTOM)) || []; }
    catch (e) { return []; }
  }
  function saveCustom(list) {
    try { localStorage.setItem(LS_CUSTOM, JSON.stringify(list)); }
    catch (e) { toast('保存失败：浏览器本地存储不可用或已满', false); }
  }

  /* ---------- 数据养护：history 上限 + 失效错题清理 ---------- */
  var HISTORY_MAX = 200;
  function pruneData() {
    var d = load();
    var changed = false;
    if (d.history && d.history.length > HISTORY_MAX) { d.history = d.history.slice(0, HISTORY_MAX); changed = true; }
    if (d.wrong) {
      Object.keys(d.wrong).forEach(function (qid) {
        if (!setById(d.wrong[qid].setId)) { delete d.wrong[qid]; changed = true; }
      });
    }
    if (changed) save(d);
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
  }
  function typeInfo(key) {
    var m = { tanbun: '内容理解（短文）·問題7', chubun: '内容理解（中文）·問題8', chobun: '内容理解（长篇）·問題9', togo: '統合理解·問題10', shucho: '主張理解（长篇）·問題11', joho: '情報検索·問題12' };
    var p = (m[key] || key).split('·');
    return { key: key, label: p[0], no: p[1] || '' };
  }
  function allSets() {
    var list = (typeof BANK !== 'undefined' && BANK ? BANK.slice() : []).concat(customSets());
    var seen = {}, out = [];
    list.forEach(function (s) {
      if (!s || !s.id) return;
      if (seen[s.id]) { out[seen[s.id] - 1] = s; } else { seen[s.id] = out.push(s); }
    });
    return out;
  }
  function setById(id) {
    var l = allSets();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function fmt(sec) {
    sec = Math.max(0, sec | 0);
    return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function toast(msg, ok) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.style.borderColor = ok === false ? 'var(--accent)' : 'var(--ok)';
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ---------- theme ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#171521' : '#e8433a');
    var b = document.getElementById('theme-toggle');
    if (b) {
      b.textContent = t === 'dark' ? '☀️' : '🌙';
      b.setAttribute('aria-label', t === 'dark' ? '切换浅色模式' : '切换深色模式');
    }
  }

  /* ---------- passage rendering ---------- */
  function passageHTML(text) {
    return String(text).split('\n').map(function (para) {
      var h = esc(para);
      h = h.replace(/⟪(.+?)⟫/g, '<mark class="uline">$1</mark>');
      h = h.replace(SIG_RE, '<mark class="sig">$1</mark>');
      return '<p>' + h + '</p>';
    }).join('');
  }

  /* ---------- session state ---------- */
  var session = null; // {mode, setId?, groups:[{set,qidx}], answers:{}, submitted, startTs, budgetSec, timerId}

  /* =========================================================
     routing
     ========================================================= */
  var PAGES = ['home', 'tech', 'practice', 'review', 'bank'];
  function route() {
    var h = (location.hash || '#home').replace('#', '');
    if (PAGES.indexOf(h) < 0) h = 'home';
    PAGES.forEach(function (p) {
      var el = document.getElementById('page-' + p);
      if (el) el.classList.toggle('on', p === h);
      var tab = document.querySelector('nav.tabs a[data-page="' + p + '"]');
      if (tab) tab.classList.toggle('on', p === h);
    });
    if (h === 'home') renderHome();
    if (h === 'practice') { if (session) { renderSession(); showSessionView(); } else { session = null; renderSetList(); showSetList(); } }
    if (h === 'review') renderReview();
    if (h === 'bank') renderBankPage();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* =========================================================
     home
     ========================================================= */
  function renderHome() {
    var d = load();
    var box = document.getElementById('home-stats');
    if (!box) return;
    var totalC = 0, totalT = 0, rows = '';
    TYPE_KEYS.forEach(function (k) {
      var t = typeInfo(k);
      var st = (d.stats && d.stats[k]) || { c: 0, t: 0 };
      totalC += st.c; totalT += st.t;
      var pct = st.t ? Math.round(st.c / st.t * 100) : 0;
      rows += '<div class="stat-row"><span>' + t.label + '</span>' +
        '<span class="pbar"><i class="' + (st.t && pct < 50 ? 'low' : '') + '" style="width:' + (st.t ? pct : 0) + '%"></i></span>' +
        '<span>' + (st.t ? st.c + '/' + st.t + '（' + pct + '%）' : '—') + '</span></div>';
    });
    rows += '<div class="stat-row"><span><b>合计</b></span><span class="pbar"><i class="' + (totalT && totalC / totalT < 0.5 ? 'low' : '') + '" style="width:' + (totalT ? Math.round(totalC / totalT * 100) : 0) + '%"></i></span><span>' + (totalT ? totalC + '/' + totalT + '（' + Math.round(totalC / totalT * 100) + '%）' : '—') + '</span></div>';
    var hist = (d.history || []).slice(0, 6).map(function (r) {
      return '<div class="histitem"><span>' + fmtDate(r.ts) + '</span><b style="flex:1">' + esc(r.title) + '</b><span>' + r.c + '/' + r.t + ' · ' + fmt(r.seconds) + '</span></div>';
    }).join('');
    var wrongN = d.wrong ? Object.keys(d.wrong).length : 0;
    var bankN = allSets().length;
    box.innerHTML =
      '<div class="grid cols-2">' +
      '<div class="card"><h3>按题型正确率</h3>' + rows +
      '<p style="margin-top:12px;font-size:13.5px;color:var(--muted)">当前题库：' + bankN + ' 组题（<a href="#bank">真题·题库</a>导入/管理）</p></div>' +
      '<div class="card"><h3>最近练习</h3>' +
      (hist || '<div class="empty">还没有练习记录。内置题库已就绪，去<a href="#practice">专项训练</a>开始第一组吧。</div>') +
      (wrongN ? '<p style="margin-top:10px">错题本待消灭：<b style="color:var(--accent)">' + wrongN + '</b> 题 · <a href="#review">去看错题</a></p>' : '') +
      '</div></div>';
  }

  /* =========================================================
     practice — list
     ========================================================= */
  function showSetList() {
    document.getElementById('set-list').style.display = '';
    document.getElementById('session-view').style.display = 'none';
  }
  function showSessionView() {
    document.getElementById('set-list').style.display = 'none';
    document.getElementById('session-view').style.display = '';
  }

  var curFilter = 'all';
  function renderSetList() {
    var d = load();
    var sets = allSets();
    var chips = '<button class="fbtn' + (curFilter === 'all' ? ' on' : '') + '" data-f="all">全部（' + sets.length + '）</button>';
    TYPE_KEYS.forEach(function (k) {
      var n = sets.filter(function (s) { return s.typeKey === k; }).length;
      chips += '<button class="fbtn' + (curFilter === k ? ' on' : '') + '" data-f="' + k + '">' + typeInfo(k).label + '（' + n + '）</button>';
    });
    document.getElementById('filterbar').innerHTML = chips;

    if (!sets.length) {
      document.getElementById('set-cards').innerHTML =
        '<div class="card" style="text-align:center;padding:48px 24px">' +
        '<h3 style="font-size:20px">题库还是空的</h3>' +
        '<p style="color:var(--muted)">题库被清空了。可在 <a href="#bank">真题·题库</a> 页重新导入题组 JSON，<br>或恢复 js/bank.js 中的内置题库。</p>' +
        '<p style="margin-top:16px"><a class="btn" href="#bank">去获取官方例题 →</a></p></div>';
      return;
    }

    var customs = customSets();
    var cards = '';
    sets.forEach(function (s) {
      if (curFilter !== 'all' && s.typeKey !== curFilter) return;
      var t = typeInfo(s.typeKey);
      var bestRec = null;
      (d.history || []).forEach(function (r) {
        if (r.setId !== s.id || !r.t) return;
        if (!bestRec || r.c / r.t > bestRec.c / bestRec.t) bestRec = r;
      });
      var best = bestRec ? '最好成绩 ' + bestRec.c + '/' + bestRec.t : '';
      var wn = 0;
      if (d.wrong) Object.keys(d.wrong).forEach(function (qid) { if (qid.indexOf(s.id + ':') === 0) wn++; });
      var isCustom = customs.some(function (c) { return c.id === s.id; });
      cards += '<div class="card setcard" data-id="' + esc(s.id) + '">' +
        '<h3>' + esc(s.title) + '</h3>' +
        '<div class="meta"><span class="badge">' + t.label + '</span>' +
        (s.source ? '<a class="badge gray" ' + (s.sourceUrl ? 'href="' + esc(s.sourceUrl) + '" target="_blank" rel="noopener"' : '') + ' onclick="event.stopPropagation()">来源：' + esc(s.source) + '</a>' : '<span class="badge gray">' + (isCustom ? '自定义导入' : t.no) + '</span>') +
        '<span class="badge gray">' + s.questions.length + ' 问 · 建议 ' + (s.minutes || 3) + ' 分钟</span>' +
        (wn ? '<span class="badge red">错题 ' + wn + '</span>' : '') +
        '</div>' + (best ? '<div class="best">' + best + '</div>' : '') +
        '</div>';
    });
    document.getElementById('set-cards').innerHTML = cards;
    document.querySelectorAll('#set-cards .setcard').forEach(function (c) {
      c.onclick = function () { startSet(c.getAttribute('data-id')); };
    });
  }

  /* =========================================================
     practice — session
     ========================================================= */
  function stopTimer() {
    if (session && session.timerId) { clearInterval(session.timerId); session.timerId = null; }
  }
  function startTimer() {
    var tEl = document.getElementById('timer');
    tEl.style.display = '';
    session.timerId = setInterval(function () {
      if (!session) return;
      var sec = Math.floor((Date.now() - session.startTs) / 1000);
      if (session.budgetSec) {
        tEl.textContent = fmt(sec) + ' / 目标 ' + fmt(session.budgetSec);
        tEl.classList.toggle('over', sec > session.budgetSec);
      } else {
        tEl.textContent = fmt(sec);
      }
    }, 500);
  }

  function startSet(setId) {
    var s = setById(setId);
    if (!s) { toast('该题组不存在，可能已被删除', false); return; }
    stopTimer();
    session = {
      mode: 'set', setId: setId,
      groups: [{ set: s, qidx: s.questions.map(function (_, i) { return i; }) }],
      answers: {}, submitted: false, startTs: Date.now(),
      budgetSec: (s.minutes || 3) * 60
    };
    renderSession();
    showSessionView();
    startTimer();
  }

  function startWrongSession() {
    var d = load();
    if (!d.wrong || !Object.keys(d.wrong).length) return;
    var bySet = {};
    Object.keys(d.wrong).forEach(function (qid) {
      var i = qid.lastIndexOf(':');
      var sid = qid.slice(0, i);
      (bySet[sid] = bySet[sid] || []).push(parseInt(qid.slice(i + 1), 10));
    });
    var groups = Object.keys(bySet).map(function (sid) {
      var s = setById(sid);
      if (!s) return null;
      var qidx = bySet[sid].filter(function (qi) { return qi < s.questions.length; });
      return qidx.length ? { set: s, qidx: qidx.sort(function (a, b) { return a - b; }) } : null;
    }).filter(Boolean);
    if (!groups.length) { toast('错题对应的题组已不存在，建议清空错题本', false); return; }
    stopTimer();
    session = { mode: 'wrong', groups: groups, answers: {}, submitted: false, startTs: Date.now(), budgetSec: 0 };
    renderSession();
    showSessionView();
    startTimer();
  }

  function renderSession() {
    var sigOn = document.getElementById('sig-toggle').checked;
    var body = '';
    session.groups.forEach(function (g) {
      var s = g.set, t = typeInfo(s.typeKey);
      body += '<div class="card" style="padding:14px 18px"><h3 style="margin:0;font-size:16px">' + esc(s.title) +
        ' <span class="badge" style="margin-left:8px">' + t.label + '</span>' +
        (s.source ? ' <a class="badge gray" style="margin-left:6px" href="' + esc(s.sourceUrl || '#bank') + '" target="_blank" rel="noopener">来源：' + esc(s.source) + '</a>' : '') +
        '</h3></div>';
      var phtml = '<div class="passage">';
      if (s.passageA) {
        phtml += '<p><span class="labelA">文A</span></p>' + passageHTML(s.passageA);
        phtml += '<p><span class="labelA">文B</span></p>' + passageHTML(s.passageB);
      } else {
        phtml += passageHTML(s.passage);
      }
      phtml += '</div>';
      body += phtml;
      g.qidx.forEach(function (qi) {
        var q = s.questions[qi];
        var key = s.id + ':' + qi;
        var chosen = session.answers[key];
        var opts = '';
        q.options.forEach(function (op, oi) {
          var cls = 'opt';
          if (!session.submitted) {
            if (chosen === oi) cls += ' sel';
          } else {
            cls += ' lock';
            if (oi === q.answer) cls += ' correct';
            if (chosen === oi && oi !== q.answer) cls += ' wrongpick';
          }
          opts += '<div class="' + cls + '" data-key="' + esc(key) + '" data-oi="' + oi + '"><span class="tag">' + LABELS[oi] + '</span><span>' + esc(op) + '</span></div>';
        });
        var exp = '';
        if (session.submitted) {
          var ok = chosen === q.answer;
          var headTxt = ok ? '✓ 回答正确' : (chosen == null ? '－ 未作答' : '✗ 回答错误');
          exp = '<div class="explain"><div class="head ' + (ok ? 'ok' : 'ng') + '">' + headTxt + (q.label ? '　<span class="badge gray">' + esc(q.label) + '</span>' : '') + '</div>';
          if (q.explain && q.explain.length) {
            exp += '<ul>' + q.explain.map(function (e, i) {
              var mark = i === q.answer ? '<b style="color:var(--ok)">［正解 ' + LABELS[i] + '］</b>' : '<b>［' + LABELS[i] + '］</b>';
              var opText = String(q.options[i] || '');
              return '<li>' + mark + esc(opText).slice(0, 26) + (opText.length > 26 ? '…' : '') + ' <span class="why">' + esc(e) + '</span></li>';
            }).join('') + '</ul>';
          } else {
            exp += '<p style="margin:4px 0 0">正解：<b style="color:var(--ok)">' + LABELS[q.answer] + ' ' + esc(q.options[q.answer]) + '</b></p>';
          }
          exp += '</div>';
        }
        body += '<div class="qblock">' +
          '<p class="qstem"><span class="qnum">問' + (qi + 1) + '</span>' + esc(q.q) + '</p>' +
          '<div class="opts">' + opts + '</div>' + exp + '</div>';
      });
    });
    document.getElementById('session-body').innerHTML = body;
    var cur = session.mode === 'wrong' ? null : setById(session.setId);
    document.getElementById('session-head-title').textContent =
      session.mode === 'wrong' ? '错题重练（' + session.groups.reduce(function (n, g) { return n + g.qidx.length; }, 0) + ' 题）' : (cur ? cur.title : session.groups[0].set.title);

    if (!session.submitted) {
      document.querySelectorAll('#session-body .opt').forEach(function (el) {
        el.onclick = function () {
          if (session.submitted) return;
          var key = el.getAttribute('data-key'), oi = parseInt(el.getAttribute('data-oi'), 10);
          session.answers[key] = oi;
          Array.from(el.parentElement.children).forEach(function (c) { c.classList.remove('sel'); });
          el.classList.add('sel');
          updateSubmitCount();
          markCurQ(false);
        };
      });
    }

    var acts = document.getElementById('session-actions');
    if (!session.submitted) {
      acts.innerHTML = '<button class="btn" id="btn-submit">提交答案（0/0）</button>' +
        '<button class="btn sub" id="btn-back">返回列表</button>' +
        '<span class="kbd-hint">键盘 1〜4 选择 · Enter 提交</span>';
      document.getElementById('btn-submit').onclick = submitSession;
      document.getElementById('btn-back').onclick = backToList;
      updateSubmitCount();
    } else {
      acts.innerHTML = '<button class="btn" id="btn-redo">' + (session.mode === 'wrong' ? '再练一遍错题' : '重做这一组') + '</button>' +
        '<button class="btn sub" id="btn-back">返回列表</button>';
      document.getElementById('btn-redo').onclick = function () { session.mode === 'wrong' ? startWrongSession() : startSet(session.setId); };
      document.getElementById('btn-back').onclick = backToList;
    }
    if (!session.submitted) markCurQ(false);
  }

  function updateSubmitCount() {
    var totalQ = session.groups.reduce(function (n, g) { return n + g.qidx.length; }, 0);
    var b = document.getElementById('btn-submit');
    if (b) b.textContent = '提交答案（' + Object.keys(session.answers).length + '/' + totalQ + '）';
  }

  function submitSession() {
    if (session.submitted) return;
    var unanswered = session.groups.reduce(function (n, g) { return n + g.qidx.length; }, 0) - Object.keys(session.answers).length;
    if (unanswered > 0 && !confirm('还有 ' + unanswered + ' 题未作答，未作答的题将按错误记入错题本。确定提交吗？')) return;
    stopTimer();
    session.submitted = true;
    var sec = Math.floor((Date.now() - session.startTs) / 1000);
    var d = load();
    d.stats = d.stats || {}; d.history = d.history || []; d.wrong = d.wrong || {};

    var totalQ = 0, c = 0;
    session.groups.forEach(function (g) {
      var s = g.set, t = typeInfo(s.typeKey);
      if (session.mode === 'set') d.stats[t.key] = d.stats[t.key] || { c: 0, t: 0 };
      g.qidx.forEach(function (qi) {
        var key = s.id + ':' + qi, q = s.questions[qi];
        var chosen = session.answers[key];
        var ok = chosen === q.answer;
        totalQ++;
        if (ok) c++;
        if (session.mode === 'set') {
          d.stats[t.key].t++;
          if (ok) d.stats[t.key].c++;
        }
        if (ok) delete d.wrong[key];
        else d.wrong[key] = { setId: s.id, chosen: chosen, ts: Date.now() };
      });
    });
    if (session.mode === 'set') {
      d.history.unshift({ ts: Date.now(), setId: session.setId, title: session.groups[0].set.title, c: c, t: totalQ, seconds: sec });
      d.history = d.history.slice(0, HISTORY_MAX);
    }
    save(d);

    var rb = document.getElementById('session-result');
    rb.innerHTML = c + '/' + totalQ + ' <span style="font-size:13px;color:var(--muted)">（' + Math.round(c / totalQ * 100) + '% · 用时 ' + fmt(sec) + '）</span>';
    rb.className = 'big ' + (c / totalQ >= 0.7 ? 'good' : 'bad');
    renderSession();
  }

  function backToList() {
    stopTimer();
    session = null;
    renderSetList();
    showSetList();
    window.scrollTo(0, 0);
  }

  /* =========================================================
     review（错题本）
     ========================================================= */
  function renderReview() {
    var d = load();
    var box = document.getElementById('review-body');
    var keys = d.wrong ? Object.keys(d.wrong).sort(function (a, b) { return d.wrong[b].ts - d.wrong[a].ts; }) : [];
    document.getElementById('btn-wrong-session').style.display = keys.length ? '' : 'none';
    if (!keys.length) {
      box.innerHTML = '<div class="empty">错题本是空的。做错的题会自动收录到这里，方便考前重练。</div>';
      return;
    }
    var rows = keys.map(function (qid) {
      var e = d.wrong[qid];
      var s = setById(e.setId); if (!s) return '';
      var qi = parseInt(qid.split(':')[1], 10), q = s.questions[qi];
      if (!q) return '';
      var t = typeInfo(s.typeKey);
      return '<div class="wrongitem">' +
        '<span class="badge">' + t.label + '</span>' +
        '<span class="qt"><b>' + esc(s.title) + '</b> 問' + (qi + 1) + '　' + esc(q.q) + '<br>' +
        '<span style="color:var(--muted);font-size:13px">你的答案：' + (e.chosen == null ? '未作答' : LABELS[e.chosen]) +
        '｜正解：' + LABELS[q.answer] + '</span></span>' +
        '<button class="btn sm ghost" data-del="' + esc(qid) + '">删除</button>' +
        '</div>';
    }).join('');
    box.innerHTML = '<div class="card">' + rows + '</div>' +
      '<p style="text-align:right"><button class="btn sm sub" id="btn-clear-wrong">清空错题本</button>　<button class="btn sm sub" id="btn-clear-all">清空全部记录</button></p>';
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var dd = load();
        delete dd.wrong[b.getAttribute('data-del')];
        save(dd); renderReview();
      };
    });
    var cw = document.getElementById('btn-clear-wrong');
    if (cw) cw.onclick = function () { var dd = load(); dd.wrong = {}; save(dd); renderReview(); };
    var ca = document.getElementById('btn-clear-all');
    if (ca) ca.onclick = function () {
      if (confirm('确定清空全部练习记录、错题本和统计吗？（导入的题库不受影响）')) { localStorage.removeItem(LS_KEY); renderReview(); }
    };
  }

  /* =========================================================
     bank（真题·题库页：导入/导出/管理）
     ========================================================= */
  function renderBankPage() {
    var sets = allSets();
    var customs = customSets();
    document.getElementById('bank-count').textContent = sets.length + ' 组题（其中 ' + customs.length + ' 组来自页面导入，' + (sets.length - customs.length) + ' 组来自 js/bank.js 文件）';
    var rows = sets.map(function (s) {
      var t = typeInfo(s.typeKey);
      var isCustom = customs.some(function (c) { return c.id === s.id; });
      return '<div class="wrongitem">' +
        '<span class="badge">' + t.label + '</span>' +
        '<span class="qt"><b>' + esc(s.title) + '</b>　' + s.questions.length + ' 问' +
        (s.source ? '　<span class="badge gray">来源：' + esc(s.source) + '</span>' : '') + '</span>' +
        (isCustom ? '<button class="btn sm ghost" data-rm="' + esc(s.id) + '">移除</button>' : '<span class="badge gray">bank.js</span>') +
        '</div>';
    }).join('');
    document.getElementById('bank-list').innerHTML = rows || '<div class="empty">暂无题组</div>';
    document.querySelectorAll('#bank-list [data-rm]').forEach(function (b) {
      b.onclick = function () {
        var list = customSets().filter(function (c) { return c.id !== b.getAttribute('data-rm'); });
        saveCustom(list); renderBankPage(); toast('已移除该题组');
      };
    });
  }

  function validateSets(arr) {
    if (!Array.isArray(arr)) throw new Error('根元素必须是数组 [ ... ]');
    var seen = {};
    arr.forEach(function (s, i) {
      var at = '第 ' + (i + 1) + ' 组';
      if (!s || typeof s !== 'object') throw new Error(at + '：不是对象');
      if (!s.id) throw new Error(at + '：缺少 id');
      if (TYPE_KEYS.indexOf(s.typeKey) < 0) throw new Error(at + '：typeKey 必须是 ' + TYPE_KEYS.join(' / '));
      if (!s.title) throw new Error(at + '：缺少 title');
      if (!(s.passage || (s.passageA && s.passageB))) throw new Error(at + '：缺少 passage（统合理解用 passageA/passageB）');
      if (!Array.isArray(s.questions) || !s.questions.length) throw new Error(at + '：questions 不能为空');
      s.questions.forEach(function (q, j) {
        if (!q.q || typeof q.q !== 'string') throw new Error(at + ' 第 ' + (j + 1) + ' 题：缺少 q（设问原文）');
        if (!Array.isArray(q.options) || q.options.length !== 4) throw new Error(at + ' 第 ' + (j + 1) + ' 题：options 必须是 4 个');
        if (typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3 || q.answer % 1 !== 0) throw new Error(at + ' 第 ' + (j + 1) + ' 题：answer 必须是 0-3 的整数');
        if (q.explain && (!Array.isArray(q.explain) || q.explain.length !== 4)) throw new Error(at + ' 第 ' + (j + 1) + ' 题：explain 需与 options 等长（4 个），或留空');
      });
      if (seen[s.id]) throw new Error('存在重复 id：' + s.id);
      seen[s.id] = 1;
      s.minutes = s.minutes || 3;
    });
    return arr;
  }

  function validateRecords(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('根元素必须是对象 { kind, version, data }');
    if (obj.kind !== 'yomitaku-records') throw new Error('kind 必须是 "yomitaku-records"');
    if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) throw new Error('缺少 data 字段（练习记录对象）');
    var d = obj.data;
    if (d.stats !== undefined && (typeof d.stats !== 'object' || d.stats === null)) throw new Error('data.stats 必须是对象');
    if (d.history !== undefined && !Array.isArray(d.history)) throw new Error('data.history 必须是数组');
    if (d.wrong !== undefined && (typeof d.wrong !== 'object' || d.wrong === null)) throw new Error('data.wrong 必须是对象');
    return d;
  }

  function initBankUI() {
    var ta = document.getElementById('bank-import-text');
    var file = document.getElementById('bank-file');
    document.getElementById('btn-import').onclick = function () {
      var raw = (file.files && file.files[0]) ? null : ta.value;
      var go = function (text) {
        try {
          var arr = validateSets(JSON.parse(text));
          var list = customSets();
          var added = 0, updated = 0;
          arr.forEach(function (s) {
            var idx = list.findIndex(function (c) { return c.id === s.id; });
            if (idx >= 0) { list[idx] = s; updated++; } else { list.push(s); added++; }
          });
          saveCustom(list);
          ta.value = '';
          if (file.value) file.value = '';
          renderBankPage();
          toast('导入成功：新增 ' + added + ' 组，覆盖 ' + updated + ' 组');
        } catch (e) {
          toast('导入失败：' + e.message, false);
        }
      };
      if (file.files && file.files[0]) {
        var fr = new FileReader();
        fr.onload = function () { go(fr.result); };
        fr.readAsText(file.files[0]);
      } else if (raw && raw.trim()) {
        go(raw);
      } else {
        toast('请先粘贴 JSON 或选择文件', false);
      }
    };
    document.getElementById('btn-export').onclick = function () {
      var text = JSON.stringify(allSets(), null, 2);
      ta.value = text;
      toast('已导出到下方文本框，可全选复制或下载');
    };
    document.getElementById('btn-download').onclick = function () {
      var blob = new Blob([JSON.stringify(allSets(), null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'yomitaku-bank.json';
      a.click();
      URL.revokeObjectURL(a.href);
    };
    var ex = document.getElementById('btn-example');
    if (ex) ex.onclick = function () {
      ta.value = JSON.stringify([{
        id: 'my-set-1', typeKey: 'tanbun', title: '在此填写标题，如：公式問題集 Vol.1 問題7（一）',
        source: '官方問題例 PDF（2012）', sourceUrl: 'https://www.jlpt.jp/samples/sample2012/pdf/N1R.pdf',
        minutes: 2,
        passage: '（把文章正文原样粘贴到这里，可多段，用\\n换行）',
        questions: [{
          q: '（设问原文）', label: '主旨把握',
          options: ['选项①原文', '选项②原文', '选项③原文', '选项④原文'],
          answer: 0,
          explain: ['选项①为何错（可选）', '选项②为何错', '正解定位', '选项④为何错']
        }]
      }], null, 2);
    };

    /* 练习记录备份（导出 / 下载 / 覆盖导入） */
    var recTa = document.getElementById('rec-text');
    var recFile = document.getElementById('rec-file');
    document.getElementById('btn-rec-export').onclick = function () {
      recTa.value = JSON.stringify({ kind: 'yomitaku-records', version: 1, exportedAt: new Date().toISOString(), data: load() }, null, 2);
      toast('已导出练习记录到文本框');
    };
    document.getElementById('btn-rec-download').onclick = function () {
      var blob = new Blob([JSON.stringify({ kind: 'yomitaku-records', version: 1, exportedAt: new Date().toISOString(), data: load() }, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'yomitaku-records.json';
      a.click();
      URL.revokeObjectURL(a.href);
    };
    document.getElementById('btn-rec-import').onclick = function () {
      var go = function (text) {
        try {
          var d = validateRecords(JSON.parse(text));
          if (!confirm('导入将整体覆盖当前的练习记录、错题本和统计，确定继续吗？')) return;
          save(d);
          recTa.value = '';
          if (recFile.value) recFile.value = '';
          renderHome();
          toast('练习记录已导入（覆盖）');
        } catch (e) {
          toast('导入失败：' + e.message, false);
        }
      };
      if (recFile.files && recFile.files[0]) {
        var fr = new FileReader();
        fr.onload = function () { go(fr.result); };
        fr.readAsText(recFile.files[0]);
      } else if (recTa.value.trim()) {
        go(recTa.value);
      } else {
        toast('请先粘贴记录 JSON 或选择文件', false);
      }
    };
  }

  /* ---------- keyboard（1〜4 选择 · Enter 提交） ---------- */
  function flatQuestions() {
    var flat = [];
    session.groups.forEach(function (g) {
      g.qidx.forEach(function (qi) { flat.push({ set: g.set, qi: qi }); });
    });
    return flat;
  }
  function firstUnanswered() {
    var flat = flatQuestions();
    for (var i = 0; i < flat.length; i++) {
      if (session.answers[flat[i].set.id + ':' + flat[i].qi] === undefined) return i;
    }
    return -1;
  }
  function markCurQ(scroll) {
    var blocks = document.querySelectorAll('#session-body .qblock');
    Array.prototype.forEach.call(blocks, function (b) { b.classList.remove('cur'); });
    var idx = firstUnanswered();
    if (idx >= 0 && blocks[idx]) {
      blocks[idx].classList.add('cur');
      if (scroll) blocks[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  function onKeydown(e) {
    if (!session || session.submitted) return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Enter') {
      var btn = document.getElementById('btn-submit');
      if (btn) { e.preventDefault(); btn.click(); }
      return;
    }
    var n = parseInt(e.key, 10);
    if (!(n >= 1 && n <= 4)) return;
    var idx = firstUnanswered();
    if (idx < 0) return; // 全部答完，数字键不动作（可改选：点击该题后仍可用数字键重选）
    var flat = flatQuestions();
    var f = flat[idx];
    session.answers[f.set.id + ':' + f.qi] = n - 1;
    var blocks = document.querySelectorAll('#session-body .qblock');
    Array.prototype.forEach.call(blocks[idx].querySelectorAll('.opt'), function (el, i) {
      el.classList.toggle('sel', i === n - 1);
    });
    updateSubmitCount();
    markCurQ(true);
  }

  /* =========================================================
     init
     ========================================================= */
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('btn-wrong-session').onclick = function () { startWrongSession(); };
    document.getElementById('btn-back-top').onclick = function () { backToList(); };
    // 深色模式：头部按钮点击切换（初始 data-theme 已由 head 内联脚本定好）
    document.getElementById('theme-toggle').onclick = function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(LS_THEME, next); } catch (e) {}
      applyTheme(next);
    };
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    // 键盘作答：1〜4 选择、Enter 提交
    document.addEventListener('keydown', onKeydown);
    document.getElementById('sig-toggle').addEventListener('change', function () {
      if (session) renderSession();
    });
    // 筛选按钮：事件委托，innerHTML 重建后依然有效
    document.getElementById('filterbar').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.fbtn') : null;
      if (!b) return;
      curFilter = b.getAttribute('data-f');
      renderSetList();
    });
    initBankUI();
    pruneData();
    route();
  });
})();
