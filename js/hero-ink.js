/* Yomitaku hero 水墨晕染 + 入场编排。
   技术形态借鉴 DeepSeek Harness 页（WebGL 流体渐变 + 省电三件套：锁 30fps /
   滚出视口暂停 / 页面隐藏暂停），配色改写为本站和纸暖色系。
   降级链（任一环失败都静默回落、绝不白屏）：
   脚本挂了 → 页面原样；WebGL 不可用 → 斜纹带保留，入场编排照常；
   prefers-reduced-motion → 全静态，终态由 CSS 兜底。 */
(function () {
  'use strict';
  var hero = document.querySelector('.hero');
  if (!hero) return;
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* —— 入场编排：--i 决定 stagger 次序，挂 ink-go 触发过渡 —— */
  var els = hero.querySelectorAll('[data-reveal]');
  for (var i = 0; i < els.length; i++) els[i].style.setProperty('--i', i);
  hero.classList.add('ink-anim');
  if (reduced) {
    hero.classList.add('ink-go');
  } else {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { hero.classList.add('ink-go'); });
    });
  }

  /* —— 题库规模数字滚动：只滚 [data-bank-stat] 卡（题库是自家的，滚动有增长感）；
     考试分数（110/60/19）是固定事实，静态显示。
     app.js 为 defer 脚本，会在本脚本之后才把真值填进来，用 MutationObserver 接住填充时刻 —— */
  function count(node, target, t0) {
    var p = Math.min(1, (performance.now() - t0) / 900);
    p = 1 - Math.pow(1 - p, 3); /* easeOutCubic */
    node.nodeValue = String(Math.round(target * p));
    if (p < 1) requestAnimationFrame(function () { count(node, target, t0); });
  }
  if (!reduced) {
    var statEl = hero.querySelector('.num [data-bank-stat="sets"]');
    if (statEl && 'MutationObserver' in window) {
      var mo = new MutationObserver(function () {
        var target = parseInt(statEl.textContent, 10);
        if (!isFinite(target) || target <= 0) return;
        mo.disconnect(); /* 只滚第一次填充，后续写入与滚动互不干扰 */
        count(statEl.firstChild, target, performance.now());
      });
      mo.observe(statEl, { childList: true, characterData: true, subtree: true });
    }
  }

  /* —— 水墨晕染画布 —— */
  var canvas = document.getElementById('hero-ink');
  if (!canvas || reduced) return; /* 减弱动态：保持静态斜纹带 */
  var gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' })
        || canvas.getContext('experimental-webgl');
  if (!gl) return;

  var VSH = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

  /* 单 pass 片元着色器：simplex 噪声域扭曲 = 颜料在和纸上晕开。
     噪声用 Ashima Arts / Stefan Gustavson 的公有领域参考实现。 */
  var FSH = [
    'precision mediump float;',
    'uniform vec2 u_res;',
    'uniform float u_time;',
    'uniform vec3 u_base;',
    'uniform vec3 u_c1;',
    'uniform vec3 u_c2;',
    'uniform vec3 u_c3;',
    'uniform vec3 u_c4;',
    'uniform float u_grain;',
    'vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }',
    'vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }',
    'vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }',
    'vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }',
    'float snoise(vec3 v){',
    '  const vec2 C = vec2(1.0/6.0, 1.0/3.0);',
    '  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);',
    '  vec3 i  = floor(v + dot(v, C.yyy));',
    '  vec3 x0 = v - i + dot(i, C.xxx);',
    '  vec3 g = step(x0.yzx, x0.xyz);',
    '  vec3 l = 1.0 - g;',
    '  vec3 i1 = min(g.xyz, l.zxy);',
    '  vec3 i2 = max(g.xyz, l.zxy);',
    '  vec3 x1 = x0 - i1 + C.xxx;',
    '  vec3 x2 = x0 - i2 + C.yyy;',
    '  vec3 x3 = x0 - D.yyy;',
    '  i = mod289(i);',
    '  vec4 p = permute(permute(permute(',
    '        i.z + vec4(0.0, i1.z, i2.z, 1.0))',
    '      + i.y + vec4(0.0, i1.y, i2.y, 1.0))',
    '      + i.x + vec4(0.0, i1.x, i2.x, 1.0));',
    '  float n_ = 0.142857142857;',
    '  vec3 ns = n_ * D.wyz - D.xzx;',
    '  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);',
    '  vec4 x_ = floor(j * ns.z);',
    '  vec4 y_ = floor(j - 7.0 * x_);',
    '  vec4 x = x_ * ns.x + ns.yyyy;',
    '  vec4 y = y_ * ns.x + ns.yyyy;',
    '  vec4 h = 1.0 - abs(x) - abs(y);',
    '  vec4 b0 = vec4(x.xy, y.xy);',
    '  vec4 b1 = vec4(x.zw, y.zw);',
    '  vec4 s0 = floor(b0)*2.0 + 1.0;',
    '  vec4 s1 = floor(b1)*2.0 + 1.0;',
    '  vec4 sh = -step(h, vec4(0.0));',
    '  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;',
    '  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;',
    '  vec3 p0 = vec3(a0.xy, h.x);',
    '  vec3 p1 = vec3(a0.zw, h.y);',
    '  vec3 p2 = vec3(a1.xy, h.z);',
    '  vec3 p3 = vec3(a1.zw, h.w);',
    '  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));',
    '  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;',
    '  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);',
    '  m = m * m;',
    '  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));',
    '}',
    'float fbm(vec2 p, float t){',
    '  float v = 0.0;',
    '  float a = 0.62;',
    '  for (int i = 0; i < 2; i++) {',
    '    v += a * snoise(vec3(p, t));',
    '    p = p * 2.1 + 17.3;',
    '    a *= 0.5;',
    '  }',
    '  return v;',
    '}',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / u_res;',
    '  vec2 p = uv; p.x *= u_res.x / u_res.y;',
    '  float t = u_time;',
    /* 两层低频噪声场互相推动 = 墨滴晕开的走向 */
    '  vec2 w = vec2(fbm(p * 1.3, t * 0.05), fbm(p * 1.3 + 5.2, t * 0.05 + 1.7));',
    '  float n = fbm(p * 1.7 + w * 1.1, t * 0.04) * 0.5 + 0.5;',
    '  float s = snoise(vec3(p * 0.9 + w, t * 0.03)) * 0.5 + 0.5;',
    '  vec3 col = u_base;',
    '  col = mix(col, u_c1, smoothstep(0.28, 0.60, n) * 0.85);',
    '  col = mix(col, u_c2, smoothstep(0.42, 0.72, s) * 0.85);',
    '  col = mix(col, u_c3, smoothstep(0.42, 0.75, n * s) * 0.7);',
    '  col = mix(col, u_c4, smoothstep(0.58, 0.92, n - s * 0.35) * 0.5);',
    /* 纸纹颗粒：半调网点的近亲 */
    '  float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);',
    '  col += (g - 0.5) * u_grain;',
    /* 边缘收向纸色，圆角外与页面底色无缝衔接 */
    '  float edge = smoothstep(0.0, 0.16, uv.x) * smoothstep(1.0, 0.84, uv.x)',
    '             * smoothstep(0.0, 0.30, uv.y) * smoothstep(1.0, 0.70, uv.y);',
    '  col = mix(u_base, col, 0.82 + 0.18 * edge);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function makeShader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  var vs = makeShader(gl.VERTEX_SHADER, VSH);
  var fs = makeShader(gl.FRAGMENT_SHADER, FSH);
  if (!vs || !fs) return;
  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var U = {};
  var UNAMES = ['u_res', 'u_time', 'u_base', 'u_c1', 'u_c2', 'u_c3', 'u_c4', 'u_grain'];
  for (var u = 0; u < UNAMES.length; u++) U[UNAMES[u]] = gl.getUniformLocation(prog, UNAMES[u]);

  /* 和纸暖色（浅）／夜の和紙（深），与 CSS 令牌同一族 */
  var PALETTES = {
    light: {
      base: [1.0, 0.973, 0.925],   /* #fff8ec 和纸 */
      c1: [1.0, 0.851, 0.812],     /* #ffd9cf 桜 */
      c2: [1.0, 0.890, 0.631],     /* #ffe3a1 山吹 */
      c3: [0.965, 0.722, 0.682],   /* #f6b8ae 薄朱 */
      c4: [0.800, 0.827, 0.867],   /* #ccd3dd 淡藍墨 */
      grain: 0.02
    },
    dark: {
      base: [0.090, 0.082, 0.129], /* #171521 夜の和紙 */
      c1: [0.227, 0.137, 0.192],   /* 夜桜 */
      c2: [0.122, 0.200, 0.314],   /* 藍 */
      c3: [0.302, 0.145, 0.157],   /* 朱の残照 */
      c4: [0.247, 0.212, 0.125],   /* 夜金 */
      grain: 0.028
    }
  };
  function applyTheme() {
    var p = PALETTES[document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'];
    gl.uniform3fv(U.u_base, p.base);
    gl.uniform3fv(U.u_c1, p.c1);
    gl.uniform3fv(U.u_c2, p.c2);
    gl.uniform3fv(U.u_c3, p.c3);
    gl.uniform3fv(U.u_c4, p.c4);
    gl.uniform1f(U.u_grain, p.grain);
  }
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* 移动端 DPR 钳制：2~3 倍屏全按原生分辨率渲是手机 GPU 翻车主因；
     柔和低频晕染降采样肉眼不可辨，1.5 足够 */
  var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  function resize() {
    var r = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width * dpr));
    var h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform2f(U.u_res, w, h); /* 着色器按此做 uv 归一化——漏设会除零，全场坍缩成底色 */
  }

  var FRAME = 1000 / 30; /* 锁 30fps：氛围动画不需要 60，省电是硬指标 */
  var raf = 0, last = 0, t0 = performance.now(), onScreen = true;
  function draw(now) {
    gl.uniform1f(U.u_time, (now - t0) / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function loop(now) {
    raf = 0;
    if (!onScreen || document.hidden) return;
    if (now - last < FRAME) { raf = requestAnimationFrame(loop); return; }
    last = now;
    draw(now);
    raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      onScreen = es[0].isIntersecting; /* hero 滚出视口即停，滚回来再续 */
      onScreen ? kick() : stop();
    }).observe(hero);
  }
  document.addEventListener('visibilitychange', function () {
    document.hidden ? stop() : kick();
  });
  window.addEventListener('resize', function () {
    resize();
    if (!raf) draw(performance.now()); /* 暂停中也要让新尺寸立即出帧 */
  });

  applyTheme();

  /* 激活时序：先量尺寸（opacity 方案下元素恒有布局），量到有效值才接管斜纹带；
     解析期强制布局可能量到 0，下一帧重试。同步出首帧避免画布闪黑。 */
  var started = false;
  function tryActivate() {
    if (started) return;
    resize();
    if (canvas.width < 10) { requestAnimationFrame(tryActivate); return; }
    started = true;
    hero.classList.add('ink-on');
    draw(performance.now());
    kick();
  }
  requestAnimationFrame(tryActivate);
})();
