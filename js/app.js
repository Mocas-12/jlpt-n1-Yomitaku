/* Yomitaku — 交互逻辑（无依赖，支持 file:// 直接打开）
   题库来源：js/bank.js 中手写的 BANK + 「真题·题库」页导入的自定义题组（存 localStorage） */
(function () {
  'use strict';

  var LS_KEY = 'yt_n1_dokkai_v1';        // 练习记录/错题/统计
  var LS_CUSTOM = 'yt_custom_sets_v1';   // 页面导入的自定义题组
  var LS_THEME = 'yt_theme';             // 深色模式偏好（缺省跟随系统）
  var LS_DRAFT = 'yt_session_draft_v1';  // 未提交会话草稿（刷新/意外关闭后恢复进度）
  var LS_GROUP = 'yt_group_open_v1';     // 题组列表按题型折叠分组的展开状态（训练页/题库页共用）
  var SIG_WORDS = ['にもかかわらず', 'とはいえ', 'これに対して', '言い換えれば', 'したがって', 'けれども', 'しかし', 'なぜなら', 'ところが', 'それでも', 'もっとも', 'たしかに', 'もちろん', 'すなわち', 'そのため', 'それゆえ', '要するに', 'つまり', '確かに', 'たしか', '一方', 'だが', 'ただし'];
  var SIG_RE = new RegExp('(' + SIG_WORDS.join('|') + ')', 'g');
  var LABELS = ['①', '②', '③', '④'];
  var TYPE_KEYS = ['tanbun', 'chubun', 'chobun', 'togo', 'shucho', 'joho'];
  var MOCK_BLUEPRINT = [ // 模拟卷蓝图：按官方大题构成抽取题组（不足则全取）
    { key: 'tanbun', sets: 4 }, { key: 'chubun', sets: 2 }, { key: 'chobun', sets: 1 },
    { key: 'togo', sets: 1 }, { key: 'shucho', sets: 1 }, { key: 'joho', sets: 1 }
  ];

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

  /* ---------- 数据养护：history 上限 + 失效错题清理 + 练习日期回填 ---------- */
  var HISTORY_MAX = 200;
  function pruneData() {
    var d = load();
    var changed = false;
    /* 旧数据迁移：练习日期（streak 用）先于 history 截断从完整历史回填，
       重度用户（每天多会话）的连续打卡才不会被 200 条上限截掉早前的天数 */
    if (!Array.isArray(d.days)) {
      var days = [];
      (d.history || []).forEach(function (r) { days.push(dstr(new Date(r.ts))); });
      d.days = days.filter(function (x, i) { return days.indexOf(x) === i; });
      changed = true;
    }
    if (d.history && d.history.length > HISTORY_MAX) { d.history = d.history.slice(0, HISTORY_MAX); changed = true; }
    if (d.wrong) {
      Object.keys(d.wrong).forEach(function (qid) {
        if (!setById(d.wrong[qid].setId)) { delete d.wrong[qid]; changed = true; }
      });
    }
    if (changed) save(d);
  }

  /* ---------- 会话草稿：未提交会话的进度持久化 ----------
     每次作答即写入；提交或返回列表时清除。题组只存 id，恢复时重新解析，
     解析不到（题组已删）整份丢弃，避免恢复出残缺会话。 */
  function saveDraft() {
    if (!session || session.submitted) return;
    try {
      localStorage.setItem(LS_DRAFT, JSON.stringify({
        mode: session.mode, setId: session.setId, regen: session.regen, title: session.title,
        groups: session.groups.map(function (g) { return { setId: g.set.id, qidx: g.qidx }; }),
        answers: session.answers, qtimes: session.qtimes,
        startTs: session.startTs, budgetSec: session.budgetSec
      }));
    } catch (e) {}
  }
  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_DRAFT));
      if (!d || !d.mode || !Array.isArray(d.groups)) return false;
      var groups = d.groups.map(function (g) {
        var s = setById(g.setId);
        if (!s || !Array.isArray(g.qidx)) return null;
        /* 兜底被篡改/损坏的草稿：下标须为范围内的整数并去重，
           否则 renderSession 取 s.questions[qi] 得 undefined 直接崩，
           且草稿不清除、每次进训练页都会反复崩 */
        var seen = {}, qidx = [];
        g.qidx.forEach(function (qi) {
          if (typeof qi === 'number' && qi % 1 === 0 && qi >= 0 && qi < s.questions.length && !seen[qi]) {
            seen[qi] = 1;
            qidx.push(qi);
          }
        });
        return qidx.length ? { set: s, qidx: qidx } : null;
      });
      if (groups.some(function (g) { return !g; })) throw new Error('题组已不存在');
      /* 答案值夹到 0〜3（否则错题本渲染 LABELS[越界] = undefined）；
         只保留当前会话内的题（防止 updateSubmitCount 计数虚高绕过未答确认） */
      var validKeys = {};
      groups.forEach(function (g) {
        g.qidx.forEach(function (qi) { validKeys[g.set.id + ':' + qi] = 1; });
      });
      var answers = {}, src = d.answers || {};
      Object.keys(src).forEach(function (k) {
        if (validKeys[k] && typeof src[k] === 'number' && src[k] % 1 === 0 && src[k] >= 0 && src[k] <= 3) answers[k] = src[k];
      });
      session = {
        mode: d.mode, setId: d.setId || null, regen: d.regen || null, title: d.title || '',
        groups: groups, answers: answers, qtimes: d.qtimes || {},
        submitted: false, startTs: d.startTs || Date.now(), budgetSec: d.budgetSec || 0,
        lastMark: Date.now() // 刷新期间的空档不计入下一题的用时
      };
      return true;
    } catch (e) {
      try { localStorage.removeItem(LS_DRAFT); } catch (e2) {}
      return false;
    }
  }
  function clearDraft() {
    try { localStorage.removeItem(LS_DRAFT); } catch (e) {}
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
  }
  /* 渲染侧兜底：来源链接只放行 http(s)，其余回落站内锚点（含旧导入数据里的 javascript: 等） */
  function safeUrl(u) {
    var s = String(u == null ? '' : u);
    return /^https?:\/\//i.test(s) ? esc(s) : '#bank';
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
      /* 非法 typeKey 一并剔除：导入校验只护新导入，localStorage 里的旧脏数据
         若流到渲染侧（byType[s.typeKey]）会整页崩——渲染侧兜底，同 safeUrl 惯例 */
      if (!s || !s.id || TYPE_KEYS.indexOf(s.typeKey) < 0) return;
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
  function pad2(n) { return String(n).padStart(2, '0'); }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function dstr(dt) { return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate()); }
  function calcStreak(d) { // 连续打卡天数：优先读独立的练习日期记录（不受 history 上限截断影响），旧数据回退从 history 推导
    var days = {};
    if (Array.isArray(d.days)) d.days.forEach(function (s) { days[s] = 1; });
    else (d.history || []).forEach(function (r) { days[dstr(new Date(r.ts))] = 1; });
    var n = 0, dt = new Date();
    if (!days[dstr(dt)]) dt.setDate(dt.getDate() - 1);
    while (days[dstr(dt)]) { n++; dt.setDate(dt.getDate() - 1); }
    return n;
  }
  function markTime(key) { // 每题用时：与上一题作答时刻的间隔（首题从开考起算）
    if (!session || session.qtimes[key] != null) return;
    var now = Date.now();
    session.qtimes[key] = Math.max(1, Math.round((now - (session.lastMark || session.startTs)) / 1000));
    session.lastMark = now;
  }
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
  function downloadJSON(text, name) { // 触发浏览器下载一段 JSON 文本
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
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
  /* sigOn：信号词衬底高亮由开关控制（默认关，还原考场素卷）；
     ⟪…⟫ 划线句标记属于题面内容（划线句含义题依赖），不受开关影响 */
  function passageHTML(text, sigOn) {
    return String(text).split('\n').map(function (para) {
      var h = esc(para);
      h = h.replace(/⟪(.+?)⟫/g, '<mark class="uline">$1</mark>');
      if (sigOn) h = h.replace(SIG_RE, '<mark class="sig">$1</mark>');
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
    if (h === 'practice') {
      if (session) { renderSession(); showSessionView(); if (!session.submitted) startTimer(); }
      else { renderSetList(); showSetList(); }
    }
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
    var streak = calcStreak(d);
    box.innerHTML =
      '<div class="grid cols-2">' +
      '<div class="card"><h3>按题型正确率</h3>' + rows +
      '<p style="margin-top:12px;font-size:13.5px;color:var(--muted)">当前题库：' + bankN + ' 组题（<a href="#bank">真题·题库</a>导入/管理）</p></div>' +
      '<div class="card"><h3>最近练习</h3>' +
      (streak ? '<p class="streakline">🔥 连续打卡 <b>' + streak + '</b> 天</p>' : '') +
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

  function setCardHTML(s, d, customs) {
    var t = typeInfo(s.typeKey);
    var bestRec = null;
    (d.history || []).forEach(function (r) {
      if (r.setId !== s.id || !r.t) return;
      if (!bestRec || r.c / r.t > bestRec.c / r.t) bestRec = r;
    });
    var best = bestRec ? '最好成绩 ' + bestRec.c + '/' + bestRec.t : '';
    var wn = 0;
    if (d.wrong) Object.keys(d.wrong).forEach(function (qid) { if (qid.indexOf(s.id + ':') === 0) wn++; });
    var isCustom = customs.some(function (c) { return c.id === s.id; });
    return '<div class="card setcard" data-id="' + esc(s.id) + '">' +
      '<h3>' + esc(s.title) + '</h3>' +
      '<div class="meta"><span class="badge">' + t.label + '</span>' +
      (s.source ? '<a class="badge gray" ' + (s.sourceUrl ? 'href="' + safeUrl(s.sourceUrl) + '" target="_blank" rel="noopener"' : '') + ' onclick="event.stopPropagation()">来源：' + esc(s.source) + '</a>' : '<span class="badge gray">' + (isCustom ? '自定义导入' : t.no) + '</span>') +
      '<span class="badge gray">' + s.questions.length + ' 问 · 建议 ' + (s.minutes || 3) + ' 分钟</span>' +
      (wn ? '<span class="badge red">错题 ' + wn + '</span>' : '') +
      '</div>' + (best ? '<div class="best">' + best + '</div>' : '') +
      '</div>';
  }

  /* 折叠分组：原生 details/summary（零依赖、file:// 可用、自带键盘操作）。
     「全部」视图按题型收纳成长列表；筛选到单一题型时保持平铺。 */
  function groupOpenMap() {
    try { return JSON.parse(localStorage.getItem(LS_GROUP)) || {}; }
    catch (e) { return {}; }
  }
  function groupedTypeHTML(byType) {
    var open = groupOpenMap();
    return TYPE_KEYS.filter(function (k) { return byType[k].length; }).map(function (k) {
      return '<details class="typegroup" data-type="' + k + '"' + (open[k] ? ' open' : '') + '>' +
        '<summary><span class="tg-label">' + typeInfo(k).label + '</span>' +
        '<span class="tg-count">' + byType[k].length + ' 组</span></summary>' +
        '<div class="tg-body">' + byType[k].join('') + '</div></details>';
    }).join('');
  }
  function wireTypeGroups(containerId) {
    document.querySelectorAll('#' + containerId + ' details.typegroup').forEach(function (det) {
      det.addEventListener('toggle', function () {
        var m = groupOpenMap();
        m[det.getAttribute('data-type')] = det.open;
        try { localStorage.setItem(LS_GROUP, JSON.stringify(m)); } catch (e) {}
      });
    });
  }

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
    var byType = {};
    TYPE_KEYS.forEach(function (k) { byType[k] = []; });
    sets.forEach(function (s) {
      if (curFilter !== 'all' && s.typeKey !== curFilter) return;
      byType[s.typeKey].push(setCardHTML(s, d, customs));
    });
    document.getElementById('set-cards').innerHTML =
      curFilter === 'all' ? groupedTypeHTML(byType) : byType[curFilter].join('');
    document.getElementById('set-cards').classList.toggle('grouped', curFilter === 'all');
    wireTypeGroups('set-cards');
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
    if (session.timerId) return; // 已在计时（路由重入时防止叠加 interval）
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
      mode: 'set', setId: setId, title: s.title, regen: null,
      groups: [{ set: s, qidx: s.questions.map(function (_, i) { return i; }) }],
      answers: {}, qtimes: {}, submitted: false, startTs: Date.now(),
      budgetSec: (s.minutes || 3) * 60
    };
    renderSession();
    showSessionView();
    startTimer();
    saveDraft();
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
    var totalW = groups.reduce(function (n, g) { return n + g.qidx.length; }, 0);
    session = { mode: 'wrong', title: '错题重练（' + totalW + ' 题）', regen: null, groups: groups, answers: {}, qtimes: {}, submitted: false, startTs: Date.now(), budgetSec: 0 };
    /* 会话渲染在训练页容器里：若当前在别的路由（如错题本页），需切到 #practice 才可见 */
    if (location.hash !== '#practice') {
      location.hash = '#practice'; // hashchange → route() 渲染
    } else {
      renderSession();
      showSessionView();
    }
    startTimer();
    saveDraft();
  }

  /* 随机混合：从全部题组抽 N 问（同题组的题归并渲染，文章只出现一次） */
  function startMixSession(count) {
    var pool = [];
    allSets().forEach(function (s) {
      s.questions.forEach(function (_, qi) { pool.push({ set: s, qi: qi }); });
    });
    if (!pool.length) { toast('题库为空，无法抽题', false); return; }
    shuffle(pool);
    pool = pool.slice(0, Math.min(count || 10, pool.length));
    var groups = [];
    pool.forEach(function (p) {
      var g = null;
      for (var i = 0; i < groups.length; i++) if (groups[i].set.id === p.set.id) { g = groups[i]; break; }
      if (g) g.qidx.push(p.qi); else groups.push({ set: p.set, qidx: [p.qi] });
    });
    stopTimer();
    session = {
      mode: 'mix', title: '随机混合 ' + pool.length + ' 问', regen: { kind: 'mix', count: count || 10 },
      groups: groups, answers: {}, qtimes: {}, submitted: false, startTs: Date.now(),
      budgetSec: pool.length * 90
    };
    renderSession();
    showSessionView();
    startTimer();
    saveDraft();
  }

  /* 模拟卷：按官方大题构成（問題7〜12）抽题组卷，全局计时 */
  function startMockSession() {
    var groups = [], budget = 0, total = 0;
    MOCK_BLUEPRINT.forEach(function (bp) {
      var pool = allSets().filter(function (s) { return s.typeKey === bp.key; });
      shuffle(pool);
      pool.slice(0, bp.sets).forEach(function (s) {
        groups.push({ set: s, qidx: s.questions.map(function (_, i) { return i; }) });
        budget += (s.minutes || 3) * 60;
        total += s.questions.length;
      });
    });
    if (!groups.length) { toast('题库为空，无法组卷', false); return; }
    stopTimer();
    session = {
      mode: 'mock', title: '模拟卷 · ' + total + ' 问', regen: { kind: 'mock' },
      groups: groups, answers: {}, qtimes: {}, submitted: false, startTs: Date.now(),
      budgetSec: budget
    };
    renderSession();
    showSessionView();
    startTimer();
    saveDraft();
  }

  function redoSession() {
    if (session.regen) {
      session.regen.kind === 'mock' ? startMockSession() : startMixSession(session.regen.count);
    } else if (session.mode === 'wrong') {
      startWrongSession();
    } else {
      startSet(session.setId);
    }
  }

  function renderSession() {
    if (!session.submitted) { // 新开/重做会话时清掉上一组的分数显示
      var rb = document.getElementById('session-result');
      rb.innerHTML = '';
      rb.className = 'big';
    }
    var sigOn = document.getElementById('sig-toggle').checked; // 开关状态：喂给 passageHTML（曾因"从未读取"被误删）
    var body = '';
    var qnNo = 0; // 混合/模拟卷模式下按顺序重新编号
    session.groups.forEach(function (g) {
      var s = g.set, t = typeInfo(s.typeKey);
      body += '<div class="card" style="padding:14px 18px"><h3 style="margin:0;font-size:16px">' + esc(s.title) +
        ' <span class="badge" style="margin-left:8px">' + t.label + '</span>' +
        (s.source ? ' <a class="badge gray" style="margin-left:6px" href="' + safeUrl(s.sourceUrl) + '" target="_blank" rel="noopener">来源：' + esc(s.source) + '</a>' : '') +
        '</h3></div>';
      var phtml = '<div class="passage">';
      if (s.passageA) {
        phtml += '<p><span class="labelA">文A</span></p>' + passageHTML(s.passageA, sigOn);
        phtml += '<p><span class="labelA">文B</span></p>' + passageHTML(s.passageB, sigOn);
      } else {
        phtml += passageHTML(s.passage, sigOn);
      }
      phtml += '</div>';
      body += phtml;
      g.qidx.forEach(function (qi) {
        var q = s.questions[qi];
        var key = s.id + ':' + qi;
        var num = (session.mode === 'mix' || session.mode === 'mock') ? (++qnNo) : (qi + 1);
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
          var qt = session.qtimes[key];
          exp = '<div class="explain"><div class="head ' + (ok ? 'ok' : 'ng') + '">' + headTxt + (qt != null ? '<span class="qtime">用时 ' + qt + ' 秒</span>' : '') + (q.label ? '　<span class="badge gray">' + esc(q.label) + '</span>' : '') + '</div>';
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
          '<p class="qstem"><span class="qnum">問' + num + '</span>' + esc(q.q) + '</p>' +
          '<div class="opts">' + opts + '</div>' + exp + '</div>';
      });
    });
    document.getElementById('session-body').innerHTML = body;
    document.getElementById('session-head-title').textContent = session.title;

    if (!session.submitted) {
      document.querySelectorAll('#session-body .opt').forEach(function (el) {
        el.onclick = function () {
          if (session.submitted) return;
          var key = el.getAttribute('data-key'), oi = parseInt(el.getAttribute('data-oi'), 10);
          session.answers[key] = oi;
          markTime(key);
          saveDraft();
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
      var redoLabel = session.regen ? (session.regen.kind === 'mock' ? '再考一次（重新组卷）' : '再抽一组') : (session.mode === 'wrong' ? '再练一遍错题' : '重做这一组');
      acts.innerHTML = '<button class="btn" id="btn-redo">' + redoLabel + '</button>' +
        '<button class="btn sub" id="btn-back">返回列表</button>';
      document.getElementById('btn-redo').onclick = redoSession;
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
    var counted = session.mode !== 'wrong'; // set/mix/mock 都计入统计与历史，wrong 只记账错题
    session.groups.forEach(function (g) {
      var s = g.set;
      if (counted) d.stats[s.typeKey] = d.stats[s.typeKey] || { c: 0, t: 0 };
      g.qidx.forEach(function (qi) {
        var key = s.id + ':' + qi, q = s.questions[qi];
        var chosen = session.answers[key];
        var ok = chosen === q.answer;
        totalQ++;
        if (ok) c++;
        if (counted) {
          d.stats[s.typeKey].t++;
          if (ok) d.stats[s.typeKey].c++;
        }
        if (ok) delete d.wrong[key];
        else d.wrong[key] = { setId: s.id, chosen: chosen, ts: Date.now() };
      });
    });
    if (counted) {
      d.history.unshift({ ts: Date.now(), setId: session.setId || session.mode, title: session.title, c: c, t: totalQ, seconds: sec });
      d.history = d.history.slice(0, HISTORY_MAX);
      var today = dstr(new Date()); // 练习日期独立于 history 存（streak 不受上限截断）
      if (!Array.isArray(d.days)) d.days = [];
      if (d.days.indexOf(today) < 0) d.days.unshift(today);
      if (d.days.length > 730) d.days.length = 730; // 上限两年，远超任何可见的连续打卡
    }
    save(d);
    clearDraft();

    var rb = document.getElementById('session-result');
    rb.innerHTML = c + '/' + totalQ + ' <span style="font-size:13px;color:var(--muted)">（' + Math.round(c / totalQ * 100) + '% · 用时 ' + fmt(sec) + '）</span>';
    rb.className = 'big ' + (c / totalQ >= 0.7 ? 'good' : 'bad');
    renderSession();
  }

  function backToList() {
    stopTimer();
    clearDraft();
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
    var byType = {};
    TYPE_KEYS.forEach(function (k) { byType[k] = []; });
    sets.forEach(function (s) {
      var t = typeInfo(s.typeKey);
      var isCustom = customs.some(function (c) { return c.id === s.id; });
      byType[s.typeKey].push('<div class="wrongitem">' +
        '<span class="badge">' + t.label + '</span>' +
        '<span class="qt"><b>' + esc(s.title) + '</b>　' + s.questions.length + ' 问' +
        (s.source ? '　<span class="badge gray">来源：' + esc(s.source) + '</span>' : '') + '</span>' +
        (isCustom ? '<button class="btn sm ghost" data-rm="' + esc(s.id) + '">移除</button>' : '<span class="badge gray">bank.js</span>') +
        '</div>');
    });
    document.getElementById('bank-list').innerHTML = sets.length ? groupedTypeHTML(byType) : '<div class="empty">暂无题组</div>';
    wireTypeGroups('bank-list');
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
      if (s.sourceUrl && !/^https?:\/\//i.test(s.sourceUrl)) throw new Error(at + '：sourceUrl 必须以 http(s) 开头');
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
    if (d.days !== undefined && !Array.isArray(d.days)) throw new Error('data.days 必须是数组（练习日期，streak 用）');
    return d;
  }

  function initBankUI() {
    var ta = document.getElementById('bank-import-text');
    var file = document.getElementById('bank-file');
    document.getElementById('btn-import').onclick = function () {
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
      } else if (ta.value.trim()) {
        go(ta.value);
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
      downloadJSON(JSON.stringify(allSets(), null, 2), 'yomitaku-bank.json');
    };
    var ex = document.getElementById('btn-example');
    if (ex) ex.onclick = function () {
      /* 完整示例题（本站原创，可直接导入体验；字段说明见下方 JSON 格式速览） */
      ta.value = JSON.stringify([{
        id: 'my-set-1', typeKey: 'tanbun', title: '示例题组 · 叱らない上司（可直接导入体验，再把内容替换成你的题目）',
        source: '本站示例（替换成你的来源，如：公式問題集 Vol.1）',
        sourceUrl: 'https://www.jlpt.jp/samples/sample2012/pdf/N1R.pdf',
        minutes: 2,
        passage: '「部下を叱らない上司が増えている」という記事を目にした。叱るのが苦手なのか、それとも面倒なのか。しかし、注意をしないまま放置すれば、部下は自分の課題に気づく機会を失ったままになる。\n叱るときに大切なのは、感情をぶつけることではなく、改善すべき点を具体的に伝えることである。怒りは関係を壊すが、具体的な指摘は成長の材料になる。叱り方もまた、マネジメントの技術なのである。',
        questions: [{
          q: '筆者が最も言いたいことはどれか。',
          label: '主旨把握',
          options: [
            '部下を叱らない上司が増えても、特に問題にはならない。',
            '叱るときは感情ではなく、改善すべき点を具体的に伝えるべきだ。',
            '部下を叱ることは、上司が信頼を寄せていることの表れである。',
            '放置は部下の自立を促す、有効なマネジメント手段である。',
          ],
          answer: 1,
          explain: [
            '「特に問題にはならない」とは言っておらず、むしろ叱らないことの課題を指摘している。',
            '正解。末段「改善すべき点を具体的に伝えることである」と一致。',
            '叱ることを信頼の表れと結びつけた記述は本文にない。',
            '放置を有効な手段とするのは主張の逆。本文は放置を「機会を失う」としている。',
          ]
        }]
      }], null, 2);
      toast('已填入示例题组：可直接导入体验，或把字段内容替换成你的题目');
    };

    /* AI 转录提示词复制（clipboard API 不可用时回退 execCommand） */
    var copyBtn = document.getElementById('btn-copy-prompt');
    if (copyBtn) copyBtn.onclick = function () {
      var text = document.getElementById('ai-prompt-text').textContent;
      var fallback = function () {
        var t = document.createElement('textarea');
        t.value = text;
        t.style.position = 'fixed';
        t.style.opacity = '0';
        document.body.appendChild(t);
        t.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(t);
      };
      var done = function () { toast('提示词已复制，粘贴给任意 AI 并附上题目原文即可'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(); done(); });
      } else {
        fallback();
        done();
      }
    };

    /* 练习记录备份（导出 / 下载 / 覆盖导入） */
    var recTa = document.getElementById('rec-text');
    var recFile = document.getElementById('rec-file');
    document.getElementById('btn-rec-export').onclick = function () {
      recTa.value = JSON.stringify({ kind: 'yomitaku-records', version: 1, exportedAt: new Date().toISOString(), data: load() }, null, 2);
      toast('已导出练习记录到文本框');
    };
    document.getElementById('btn-rec-download').onclick = function () {
      downloadJSON(JSON.stringify({ kind: 'yomitaku-records', version: 1, exportedAt: new Date().toISOString(), data: load() }, null, 2), 'yomitaku-records.json');
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
  function motionOK() { // 系统"减少动态效果"时不做平滑滚动（CSS 侧另有全局降级）
    return !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function markCurQ(scroll) {
    var blocks = document.querySelectorAll('#session-body .qblock');
    blocks.forEach(function (b) { b.classList.remove('cur'); });
    var idx = firstUnanswered();
    if (idx >= 0 && blocks[idx]) {
      blocks[idx].classList.add('cur');
      if (scroll) blocks[idx].scrollIntoView({ block: 'nearest', behavior: motionOK() ? 'smooth' : 'auto' });
    }
  }
  function onKeydown(e) {
    if (!session || session.submitted) return;
    /* 只在训练页为当前路由时响应：会话进行中切到其他页（session 仍存活），
       数字键/Enter 不得暗中修改后台会话的作答或触发交卷。
       判断 hash 而非 .on class：hashchange 事件落地前 class 仍是旧页，hash 已是新值 */
    if ((location.hash || '#home').replace('#', '') !== 'practice') return;
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
    if (idx < 0) return; // 全部答完，数字键不动作（改选请直接点击选项）
    var flat = flatQuestions();
    var f = flat[idx];
    var key = f.set.id + ':' + f.qi;
    session.answers[key] = n - 1;
    markTime(key);
    saveDraft();
    var blocks = document.querySelectorAll('#session-body .qblock');
    blocks[idx].querySelectorAll('.opt').forEach(function (el, i) {
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
    // 随机混合 / 模拟卷入口
    document.getElementById('btn-mix10').onclick = function () { startMixSession(10); };
    document.getElementById('btn-mock').onclick = function () { startMockSession(); };
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
    // 首屏/说明页的题库规模文案随 bank.js 自动对齐（data-bank-stat 钩子，防止静态数字过期）
    var bankAll = (typeof BANK !== 'undefined' && BANK) ? BANK : [];
    var bankQ = bankAll.reduce(function (a, s) { return a + s.questions.length; }, 0);
    document.querySelectorAll('[data-bank-stat]').forEach(function (el) {
      el.textContent = el.getAttribute('data-bank-stat') === 'sets' ? bankAll.length : bankQ;
    });
    if (loadDraft()) toast('已恢复上次未完成的练习，计时继续', true);
    route();
  });
})();
