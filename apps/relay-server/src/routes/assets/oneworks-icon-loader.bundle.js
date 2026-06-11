'use strict'
var OneWorksIconLoader = (() => {
  var D = Object.defineProperty
  var ot = Object.getOwnPropertyDescriptor
  var rt = Object.getOwnPropertyNames
  var it = Object.prototype.hasOwnProperty
  var nt = (e, t, o) => t in e ? D(e, t, { enumerable: !0, configurable: !0, writable: !0, value: o }) : e[t] = o
  var at = (e, t) => {
      for (var o in t) D(e, o, { get: t[o], enumerable: !0 })
    },
    st = (e, t, o, r) => {
      if (t && typeof t == 'object' || typeof t == 'function') {
        for (let i of rt(t)) {
          !it.call(e, i) && i !== o &&
            D(e, i, { get: () => t[i], enumerable: !(r = ot(t, i)) || r.enumerable })
        }
      }
      return e
    }
  var lt = e => st(D({}, '__esModule', { value: !0 }), e)
  var m = (e, t, o) => nt(e, typeof t != 'symbol' ? t + '' : t, o)
  var oo = {}
  at(oo, { mountOneWorksIconLoader: () => eo })
  var ve = [0, 0, 1]
  var _ = (e, t, o, r, i) => ({
      amp: e.signedRandomRange(t, o),
      phase: e.randomRange(0, Math.PI * 2),
      timeFreq: e.randomChoice(i),
      uFreq: e.randomChoice(r)
    }),
    H = e => ({
      shape: {
        depthScale: e.signedRandomRange(.08, .22),
        diagonal: e.signedRandomRange(.04, .12),
        lobeBalance: e.signedRandomRange(.08, .2),
        phaseDrift: e.signedRandomRange(.03, .09),
        waist: e.signedRandomRange(.08, .2),
        xScale: e.signedRandomRange(.08, .18),
        yScale: e.signedRandomRange(.1, .22)
      },
      twist: [_(e, .1, .18, [1, 2, 3], [1, 2]), _(e, .04, .09, [2, 3, 4], [2, 3])],
      warpX: [_(e, .02, .05, [1, 2], [1, 2]), _(e, .01, .025, [3, 4], [2, 3])],
      warpY: [_(e, .018, .04, [1, 2], [1, 2]), _(e, .01, .02, [3, 4], [2, 3])],
      warpZ: [_(e, .055, .12, [1, 2, 3], [1, 2]), _(e, .025, .055, [2, 3, 4], [2, 3])],
      width: [_(e, .035, .06, [2, 3, 4], [1, 2]), _(e, .015, .03, [3, 4, 5], [2, 3])]
    }),
    be = (e, t, o, r = 10.24) => {
      let i = e + o, n = Math.floor(i / r), a = (i % r + r) % r / r, s = Math.sin(Math.PI * a) ** 2
      return { cycleIndex: n, envelope: s * t, phase: a }
    }
  var I = e => String(e ?? '').trim().replace(/[^\w-]/g, '').slice(0, 64) || null,
    R = () => {
      let e = new Uint32Array(2)
      return globalThis.crypto?.getRandomValues
        ? globalThis.crypto.getRandomValues(e)
        : (e[0] = Math.floor(Math.random() * 4294967295), e[1] = Date.now() >>> 0),
        I(`${e[0].toString(36)}${e[1].toString(36)}`) ?? 'oneworks'
    },
    Se = e => {
      let t = 2166136261
      for (let o = 0; o < e.length; o += 1) t ^= e.charCodeAt(o), t = Math.imul(t, 16777619)
      return t >>> 0
    },
    q = e => {
      let t = Se(e) || 2654435769
      return () => {
        t += 1831565813
        let o = t
        return o = Math.imul(o ^ o >>> 15, o | 1),
          o ^= o + Math.imul(o ^ o >>> 7, o | 61),
          ((o ^ o >>> 14) >>> 0) / 4294967296
      }
    }
  var P = (e, t, o) => {
      let r = Math.PI * 2 * o
      return e.reduce((i, n) => i + n.amp * Math.sin(n.uFreq * t + n.timeFreq * r + n.phase), 0)
    },
    K = (e, t) => {
      let { shape: o } = t.cycle,
        r = t.envelope || 0,
        i = Math.PI * 2 * (t.phase || 0),
        n = e + r * o.phaseDrift * Math.sin(i),
        a = Math.sin(n),
        s = Math.cos(n),
        c = Math.tanh(1.8 * a),
        l = 1 - r * o.waist * Math.cos(2 * n) ** 2,
        d = 1 + r * o.lobeBalance * c,
        p = 1 + r * o.xScale,
        h = 1 + r * o.yScale * Math.sin(i + .8),
        u = 1 + r * o.depthScale * Math.cos(i + .35),
        g = r * o.diagonal
      return [
        2.75 * p * d * l * a + g * Math.sin(3 * n + i),
        1.35 * h * Math.sin(2 * n) * (1 - .16 * r * c),
        .76 * u * s + r * .08 * Math.sin(3 * n - i)
      ]
    },
    ut = (e, t) => {
      let r = K(e - .001, t), i = K(e + .001, t)
      return [(i[0] - r[0]) / (2 * .001), (i[1] - r[1]) / (2 * .001), (i[2] - r[2]) / (2 * .001)]
    },
    Q = (e, t) => [e[0] + t[0], e[1] + t[1], e[2] + t[2]],
    Z = (e, t) => [e[0] * t, e[1] * t, e[2] * t],
    _e = (e, t) => [e[1] * t[2] - e[2] * t[1], e[2] * t[0] - e[0] * t[2], e[0] * t[1] - e[1] * t[0]],
    J = e => {
      let t = Math.hypot(e[0], e[1], e[2]) || 1
      return [e[0] / t, e[1] / t, e[2] / t]
    },
    te = (e, t) => {
      let o = [], r = e ? Math.PI * 2 * t.phase * e : 0
      for (let i = 0; i < 118; i += 1) {
        let n = 0 + 2 * Math.PI * i / 118, a = K(n, t), s = J(ut(n, t)), c = _e(ve, s)
        c = c[0] ** 2 + c[1] ** 2 + c[2] ** 2 < 1e-6 ? [1, 0, 0] : J(c)
        let l = J(_e(s, c)),
          d = t.envelope * P(t.cycle.twist, n, t.phase),
          p = 1 + t.envelope * P(t.cycle.width, n, t.phase) +
            t.envelope * t.cycle.shape.waist * .28 * Math.sin(2 * n + Math.PI * 2 * t.phase),
          h = n / 2 + Math.PI * .1 + d + r,
          u = Q(Z(c, Math.cos(h)), Z(l, Math.sin(h))),
          g = [
            t.envelope * P(t.cycle.warpX, n, t.phase),
            t.envelope * P(t.cycle.warpY, n, t.phase),
            t.envelope * P(t.cycle.warpZ, n, t.phase)
          ],
          v = Q(a, g),
          f = []
        for (let x = 0; x <= 12; x += 1) {
          let C = -.46 + 2 * .46 * x / 12, U = Q(v, Z(u, C * p))
          f.push({ u: n, v: C, x: U[0], y: U[1], z: U[2] })
        }
        o.push(f)
      }
      return o
    },
    ye = e => {
      let t = e.flat(),
        o = Math.min(...t.map(l => l.x)),
        r = Math.max(...t.map(l => l.x)),
        i = Math.min(...t.map(l => l.y)),
        n = Math.max(...t.map(l => l.y)),
        a = Math.min(820 / (r - o), 610 / (n - i)),
        s = (o + r) / 2,
        c = (i + n) / 2
      return l => ({ u: l.u, v: l.v, x: 512 + (l.x - s) * a, y: 512 - ((l.y - c) * a + l.z * a * .045), z: l.z })
    },
    Re = (e, t, o) => {
      let r = te(e, t), i = []
      for (let n = 0; n < 118; n += 1) {
        let a = (n + 1) % 118, s = a === 0
        for (let c = 0; c < 12; c += 1) {
          let l = mt(r, o, n, c, a, s)
          if (!l) continue
          let d = l.reduce((u, g) => u + g.z, 0) / 4,
            p = 0 + 2 * Math.PI * (n + .5) / 118,
            h = -.46 + 2 * .46 * (c + .5) / 12
          i.push({ depth: d, points: ht(l, .82), sortDepth: d + .11 * Math.cos(p), u: p, v: h })
        }
      }
      return i.sort((n, a) => n.sortDepth - a.sortDepth || n.u - a.u || n.v - a.v)
    },
    mt = (e, t, o, r, i, n) => {
      let a = n ? 12 - r : r,
        s = n ? 12 - r - 1 : r + 1,
        c = e[o],
        l = e[i],
        d = c?.[r],
        p = l?.[a],
        h = l?.[s],
        u = c?.[r + 1]
      return d && p && h && u ? [t(d), t(p), t(h), t(u)] : null
    },
    ht = (e, t) => {
      let o = e.reduce((i, n) => i + n.x, 0) / e.length, r = e.reduce((i, n) => i + n.y, 0) / e.length
      return e.map(i => {
        let n = i.x - o, a = i.y - r, s = Math.hypot(n, a) || 1
        return { ...i, x: i.x + t * n / s, y: i.y + t * a / s }
      })
    }
  var we = (e, t, o, r, i, n) => {
      let a = .5 + .5 * (o / (.76 + .46)),
        s = .5 + .5 * Math.cos(r - .55),
        c = Math.abs(i) / .46,
        l = .5 + .5 * Math.cos(r + n * .68)
      if (e === 'industrial') {
        let h = y(.74 * a + .14 * s + .08 * c + .04 * l),
          u = t === 'light'
            ? [[255, 230, 202], [255, 146, 58], [229, 58, 18], [82, 21, 9]]
            : [[20, 9, 6], [108, 22, 12], [226, 63, 18], [255, 145, 35]]
        return h < .44
          ? M(S(u[0], u[1], h / .44))
          : h < .78
          ? M(S(u[1], u[2], (h - .44) / .34))
          : M(S(u[2], u[3], (h - .78) / .22))
      }
      if (e === 'matrix') {
        let h = y(.76 * a + .12 * s + .08 * c + .04 * l),
          u = t === 'light'
            ? [[212, 255, 226], [38, 226, 112], [0, 146, 70], [0, 72, 40]]
            : [[2, 18, 10], [0, 86, 44], [0, 214, 96], [168, 255, 198]]
        return h < .36
          ? M(S(u[0], u[1], h / .36))
          : h < .78
          ? M(S(u[1], u[2], (h - .36) / .42))
          : M(S(u[2], u[3], (h - .78) / .22))
      }
      if (e === 'metal') {
        let h = c ** 1.6,
          u = .5 + .5 * Math.cos(r * 2.1 - .72),
          g = Math.max(0, Math.cos(r * 3.2 + i * 2.4 - 1.1)) ** 10,
          v = .025 * Math.sin(r * 54 + i * 18),
          f = y(.62 * a + .14 * s + .12 * h + .08 * u + .13 * g + v),
          x = t === 'light'
            ? [[34, 39, 42], [79, 88, 90], [159, 165, 162], [250, 248, 236], [72, 78, 79]]
            : [[8, 10, 11], [42, 47, 49], [139, 148, 147], [248, 247, 238], [82, 89, 91]]
        return f < .34
          ? M(S(x[0], x[1], f / .34))
          : f < .62
          ? M(S(x[1], x[2], (f - .34) / .28))
          : f < .82
          ? M(S(x[2], x[3], (f - .62) / .2))
          : M(S(x[3], x[4], (f - .82) / .18))
      }
      let d = y(.82 * a + .1 * s + .08 * c),
        p = t === 'dark'
          ? Math.max(18, Math.min(242, Math.round(14 + 226 * d)))
          : Math.max(18, Math.min(246, Math.round(248 - 226 * d)))
      return `rgb(${p},${p},${p})`
    },
    Ce = (e, t) =>
      e === 'industrial'
        ? t === 'light' ? '#FFF1E8' : '#180804'
        : e === 'matrix'
        ? t === 'light' ? '#E9FFF1' : '#001B0D'
        : e === 'metal'
        ? t === 'light' ? '#F2F4F0' : '#111615'
        : t === 'light'
        ? '#F3F5F2'
        : '#111514',
    y = (e, t = 0, o = 1) => Math.max(t, Math.min(o, e)),
    oe = (e, t, o) => Math.round(e + (t - e) * y(o)),
    S = (e, t, o) => [oe(e[0], t[0], o), oe(e[1], t[1], o), oe(e[2], t[2], o)],
    M = e => `rgb(${e[0]},${e[1]},${e[2]})`,
    re = (e, t) => `rgba(${e[0]},${e[1]},${e[2]},${t})`
  var Ee = (e = R()) => {
      let t = I(e) ?? R(),
        o = q(t),
        r = Fe(o),
        i = H(r),
        n = (u = R()) => (t = I(u) ?? R(), o = q(t), r = Fe(o), i = H(r), t),
        a = (u, g, v) => {
          let f = v?.motionCycle ?? i
          if (g === 0) return { cycle: f, envelope: 0, phase: 0 }
          let x = be(u, g, v?.motionOffset ?? 0, v?.motionLoopSeconds)
          return v && v.motionCycleIndex < 0 && (v.motionCycleIndex = x.cycleIndex),
            { cycle: f, envelope: x.envelope, phase: x.phase }
        },
        s = () => H(r),
        l = ye(te(0, { cycle: i, envelope: 0, phase: 0 })),
        d = (u, g, v = a(u, g)) => Re(g, v, l)
      return {
        get seed() {
          return t
        },
        buildMesh: d,
        createMotionCycle: s,
        createMotionSource: () => ({
          motionCycle: s(),
          motionCycleIndex: -1,
          motionLoopSeconds: 10.24,
          motionOffset: r.randomRange(0, 10.24)
        }),
        getMotionState: a,
        random: () => o(),
        randomRange: (u, g) => r.randomRange(u, g),
        resetMotionSource: u => {
          u.motionCycleIndex = -1,
            u.motionCycle = s(),
            u.motionOffset = r.randomRange(0, 10.24),
            u.motionLoopSeconds = 10.24
        },
        resetSeed: n,
        staticMesh: d(0, 0)
      }
    },
    Fe = e => {
      let t = (i, n) => i + e() * (n - i)
      return {
        random: e,
        randomChoice: i => i[Math.floor(e() * i.length)] ?? i[0] ?? 0,
        randomRange: t,
        signedRandomRange: (i, n) => t(i, n) * (e() < .5 ? -1 : 1)
      }
    }
  var Ie = (e, t) => {
      let o = t.width < 210 ? 11 : 13, r = Math.ceil(t.width / o) + 1
      t.rainFontSize = o,
        t.rainColumns = Array.from(
          { length: r },
          (i, n) => ({
            seed: e.randomRange(0, t.height + o * 18),
            speed: e.randomRange(22, 58),
            length: Math.round(e.randomRange(7, 15)),
            alpha: e.randomRange(.2, .72),
            x: n * o + o / 2
          })
        )
    },
    Be = (e, t) => {
      let o = t.width < 170 ? 12 : 15, r = Math.ceil(t.width / o), i = Math.ceil(t.height / o)
      t.heatCellSize = o,
        t.heatCols = r,
        t.heatRows = i,
        t.nextHeatUpdate = 0,
        t.heatCells = Array.from({ length: r * i }, (n, a) => pt(e, r, i, a))
    },
    Ue = (e, t, o) => {
      if (t.backgroundStyle === 'textured') {
        if (t.theme === 'matrix') {
          gt(t, o)
          return
        }
        t.theme === 'industrial' && vt(e, t, o)
      }
    },
    pt = (e, t, o, r) => {
      let i = r % t,
        n = Math.floor(r / t),
        a = (i + .5) / t,
        s = (n + .5) / o,
        c = y(ft(a, s) + e.randomRange(-.18, .18))
      return { speed: e.randomRange(.035, .085), target: c, value: c }
    },
    ft = (e, t) => {
      let o = Math.exp(-((e - .34) ** 2 / .035 + (t - .52) ** 2 / .055)),
        r = Math.exp(-((e - .66) ** 2 / .032 + (t - .42) ** 2 / .05)),
        i = Math.exp(-((e - .54) ** 2 / .06 + (t - .68) ** 2 / .04)),
        n = Math.max(0, 1 - Math.abs(t - (.82 - e * .62)) * 3.8)
      return y(.08 + o * .46 + r * .42 + i * .22 + n * .16)
    },
    gt = (e, t) => {
      let { ctx: o, height: r, mode: i, rainColumns: n, rainFontSize: a, width: s } = e,
        c = i === 'light',
        l = o.createRadialGradient(s * .54, r * .47, 0, s * .54, r * .47, s * .52)
      l.addColorStop(0, c ? 'rgba(0,180,84,0.09)' : 'rgba(0,255,118,0.12)'),
        l.addColorStop(.55, c ? 'rgba(0,180,84,0.035)' : 'rgba(0,255,118,0.045)'),
        l.addColorStop(1, 'rgba(0,255,118,0)'),
        o.fillStyle = l,
        o.fillRect(0, 0, s, r),
        o.save(),
        o.font = `${a}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
        o.textAlign = 'center',
        o.textBaseline = 'middle'
      for (let d of n) xt(e, d.x, d.length, d.seed, d.speed, d.alpha, t)
      o.restore()
    },
    xt = (e, t, o, r, i, n, a) => {
      let { ctx: s, height: c, mode: l, rainFontSize: d } = e, p = c + o * d, h = (a * .001 * i + r) % p - o * d
      for (let u = 0; u < o; u += 1) {
        let g = h - u * d
        if (g < -d || g > c + d) continue
        let v = 1 - u / o,
          f = Math.sin(t * 12.9898 + u * 78.233 + Math.floor(a * .006) * 18.97),
          x = l === 'light' ? u === 0 ? [0, 116, 58] : [0, 148, 72] : u === 0 ? [215, 255, 226] : [116, 255, 168],
          C = n * v * (u === 0 ? .74 : .42) * (l === 'light' ? .52 : 1)
        s.fillStyle = re(x, C), s.fillText(f > 0 ? '1' : '0', t, g)
      }
    },
    vt = (e, t, o) => {
      if (t.heatCells.length === 0) return
      bt(e, t, o)
      let { ctx: r, heatCellSize: i, heatCols: n, heatRows: a, mode: s } = t,
        c = Math.max(1, Math.round(i * .14)),
        l = i - c
      r.save(), r.globalCompositeOperation = 'source-over'
      for (let d = 0; d < a; d += 1) {
        for (let p = 0; p < n; p += 1) {
          let h = t.heatCells[d * n + p]
          if (!h) continue
          t.isStatic || (h.value += (h.target - h.value) * h.speed)
          let u = y(h.value)
          r.fillStyle = re(St(s, u), s === 'light' ? .22 + u * .48 : .18 + u * .64),
            r.fillRect(p * i + c / 2, d * i + c / 2, l, l)
        }
      }
      r.restore()
    },
    bt = (e, t, o) => {
      if (!(t.isStatic || o < t.nextHeatUpdate)) {
        t.nextHeatUpdate = o + e.randomRange(90, 170)
        for (let r of t.heatCells) {
          e.random() >= .28 || (r.target = y(r.target + e.randomRange(-.42, .42)), r.speed = e.randomRange(.045, .12))
        }
      }
    },
    St = (e, t) => {
      let o = e === 'light' ? [255, 239, 221] : [31, 12, 7],
        r = e === 'light' ? [255, 156, 55] : [124, 24, 12],
        i = e === 'light' ? [223, 54, 16] : [255, 98, 24],
        n = e === 'light' ? [96, 24, 10] : [255, 178, 56]
      return t < .42 ? S(o, r, t / .42) : t < .76 ? S(r, i, (t - .42) / .34) : S(i, n, (t - .76) / .24)
    }
  var Pe = `#version 300 es
precision mediump float;

layout(location = 0) in vec4 a_position;

uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform float u_imageAspectRatio;
uniform float u_originX;
uniform float u_originY;
uniform float u_worldWidth;
uniform float u_worldHeight;
uniform float u_fit;
uniform float u_scale;
uniform float u_rotation;
uniform float u_offsetX;
uniform float u_offsetY;

out vec2 v_objectUV;
out vec2 v_objectBoxSize;
out vec2 v_responsiveUV;
out vec2 v_responsiveBoxGivenSize;
out vec2 v_patternUV;
out vec2 v_patternBoxSize;
out vec2 v_imageUV;

vec3 getBoxSize(float boxRatio, vec2 givenBoxSize) {
  vec2 box = vec2(0.);
  // fit = none
  box.x = boxRatio * min(givenBoxSize.x / boxRatio, givenBoxSize.y);
  float noFitBoxWidth = box.x;
  if (u_fit == 1.) { // fit = contain
    box.x = boxRatio * min(u_resolution.x / boxRatio, u_resolution.y);
  } else if (u_fit == 2.) { // fit = cover
    box.x = boxRatio * max(u_resolution.x / boxRatio, u_resolution.y);
  }
  box.y = box.x / boxRatio;
  return vec3(box, noFitBoxWidth);
}

void main() {
  gl_Position = a_position;

  vec2 uv = gl_Position.xy * .5;
  vec2 boxOrigin = vec2(.5 - u_originX, u_originY - .5);
  vec2 givenBoxSize = vec2(u_worldWidth, u_worldHeight);
  givenBoxSize = max(givenBoxSize, vec2(1.)) * u_pixelRatio;
  float r = u_rotation * 3.14159265358979323846 / 180.;
  mat2 graphicRotation = mat2(cos(r), sin(r), -sin(r), cos(r));
  vec2 graphicOffset = vec2(-u_offsetX, u_offsetY);


  // ===================================================

  float fixedRatio = 1.;
  vec2 fixedRatioBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );

  v_objectBoxSize = getBoxSize(fixedRatio, fixedRatioBoxGivenSize).xy;
  vec2 objectWorldScale = u_resolution.xy / v_objectBoxSize;

  v_objectUV = uv;
  v_objectUV *= objectWorldScale;
  v_objectUV += boxOrigin * (objectWorldScale - 1.);
  v_objectUV += graphicOffset;
  v_objectUV /= u_scale;
  v_objectUV = graphicRotation * v_objectUV;

  // ===================================================

  v_responsiveBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );
  float responsiveRatio = v_responsiveBoxGivenSize.x / v_responsiveBoxGivenSize.y;
  vec2 responsiveBoxSize = getBoxSize(responsiveRatio, v_responsiveBoxGivenSize).xy;
  vec2 responsiveBoxScale = u_resolution.xy / responsiveBoxSize;

  #ifdef ADD_HELPERS
  v_responsiveHelperBox = uv;
  v_responsiveHelperBox *= responsiveBoxScale;
  v_responsiveHelperBox += boxOrigin * (responsiveBoxScale - 1.);
  #endif

  v_responsiveUV = uv;
  v_responsiveUV *= responsiveBoxScale;
  v_responsiveUV += boxOrigin * (responsiveBoxScale - 1.);
  v_responsiveUV += graphicOffset;
  v_responsiveUV /= u_scale;
  v_responsiveUV.x *= responsiveRatio;
  v_responsiveUV = graphicRotation * v_responsiveUV;
  v_responsiveUV.x /= responsiveRatio;

  // ===================================================

  float patternBoxRatio = givenBoxSize.x / givenBoxSize.y;
  vec2 patternBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );
  patternBoxRatio = patternBoxGivenSize.x / patternBoxGivenSize.y;

  vec3 boxSizeData = getBoxSize(patternBoxRatio, patternBoxGivenSize);
  v_patternBoxSize = boxSizeData.xy;
  float patternBoxNoFitBoxWidth = boxSizeData.z;
  vec2 patternBoxScale = u_resolution.xy / v_patternBoxSize;

  v_patternUV = uv;
  v_patternUV += graphicOffset / patternBoxScale;
  v_patternUV += boxOrigin;
  v_patternUV -= boxOrigin / patternBoxScale;
  v_patternUV *= u_resolution.xy;
  v_patternUV /= u_pixelRatio;
  if (u_fit > 0.) {
    v_patternUV *= (patternBoxNoFitBoxWidth / v_patternBoxSize.x);
  }
  v_patternUV /= u_scale;
  v_patternUV = graphicRotation * v_patternUV;
  v_patternUV += boxOrigin / patternBoxScale;
  v_patternUV -= boxOrigin;
  // x100 is a default multiplier between vertex and fragmant shaders
  // we use it to avoid UV presision issues
  v_patternUV *= .01;

  // ===================================================

  vec2 imageBoxSize;
  if (u_fit == 1.) { // contain
    imageBoxSize.x = min(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;
  } else if (u_fit == 2.) { // cover
    imageBoxSize.x = max(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;
  } else {
    imageBoxSize.x = min(10.0, 10.0 / u_imageAspectRatio * u_imageAspectRatio);
  }
  imageBoxSize.y = imageBoxSize.x / u_imageAspectRatio;
  vec2 imageBoxScale = u_resolution.xy / imageBoxSize;

  v_imageUV = uv;
  v_imageUV *= imageBoxScale;
  v_imageUV += boxOrigin * (imageBoxScale - 1.);
  v_imageUV += graphicOffset;
  v_imageUV /= u_scale;
  v_imageUV.x *= u_imageAspectRatio;
  v_imageUV = graphicRotation * v_imageUV;
  v_imageUV.x /= u_imageAspectRatio;

  v_imageUV += .5;
  v_imageUV.y = 1. - v_imageUV.y;
}`
  var Ve = 1920 * 1080 * 4,
    T = class {
      constructor(t, o, r, i, n = 0, a = 0, s = 2, c = Ve, l = []) {
        m(this, 'parentElement')
        m(this, 'canvasElement')
        m(this, 'gl')
        m(this, 'program', null)
        m(this, 'uniformLocations', {})
        m(this, 'fragmentShader')
        m(this, 'rafId', null)
        m(this, 'lastRenderTime', 0)
        m(this, 'currentFrame', 0)
        m(this, 'speed', 0)
        m(this, 'currentSpeed', 0)
        m(this, 'providedUniforms')
        m(this, 'mipmaps', [])
        m(this, 'hasBeenDisposed', !1)
        m(this, 'resolutionChanged', !0)
        m(this, 'textures', new Map())
        m(this, 'minPixelRatio')
        m(this, 'maxPixelCount')
        m(this, 'isSafari', yt())
        m(this, 'uniformCache', {})
        m(this, 'textureUnitMap', new Map())
        m(this, 'ownerDocument')
        m(this, 'initProgram', () => {
          let t = _t(this.gl, Pe, this.fragmentShader)
          t && (this.program = t)
        })
        m(this, 'setupPositionAttribute', () => {
          let t = this.gl.getAttribLocation(this.program, 'a_position'), o = this.gl.createBuffer()
          this.gl.bindBuffer(this.gl.ARRAY_BUFFER, o)
          let r = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]
          this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(r), this.gl.STATIC_DRAW),
            this.gl.enableVertexAttribArray(t),
            this.gl.vertexAttribPointer(t, 2, this.gl.FLOAT, !1, 0, 0)
        })
        m(this, 'setupUniforms', () => {
          let t = {
            u_time: this.gl.getUniformLocation(this.program, 'u_time'),
            u_pixelRatio: this.gl.getUniformLocation(this.program, 'u_pixelRatio'),
            u_resolution: this.gl.getUniformLocation(this.program, 'u_resolution')
          }
          Object.entries(this.providedUniforms).forEach(([o, r]) => {
            if (t[o] = this.gl.getUniformLocation(this.program, o), r instanceof HTMLImageElement) {
              let i = `${o}AspectRatio`
              t[i] = this.gl.getUniformLocation(this.program, i)
            }
          }), this.uniformLocations = t
        })
        m(this, 'renderScale', 1)
        m(this, 'parentWidth', 0)
        m(this, 'parentHeight', 0)
        m(this, 'parentDevicePixelWidth', 0)
        m(this, 'parentDevicePixelHeight', 0)
        m(this, 'devicePixelsSupported', !1)
        m(this, 'resizeObserver', null)
        m(this, 'setupResizeObserver', () => {
          this.resizeObserver = new ResizeObserver(([t]) => {
            if (t?.borderBoxSize[0]) {
              let o = t.devicePixelContentBoxSize?.[0]
              o !== void 0 &&
              (this.devicePixelsSupported = !0,
                this.parentDevicePixelWidth = o.inlineSize,
                this.parentDevicePixelHeight = o.blockSize),
                this.parentWidth = t.borderBoxSize[0].inlineSize,
                this.parentHeight = t.borderBoxSize[0].blockSize
            }
            this.handleResize()
          }), this.resizeObserver.observe(this.parentElement)
        })
        m(this, 'handleVisualViewportChange', () => {
          this.resizeObserver?.disconnect(), this.setupResizeObserver()
        })
        m(this, 'handleResize', () => {
          let t = 0, o = 0, r = Math.max(1, window.devicePixelRatio), i = visualViewport?.scale ?? 1
          if (this.devicePixelsSupported) {
            let d = Math.max(1, this.minPixelRatio / r)
            t = this.parentDevicePixelWidth * d * i, o = this.parentDevicePixelHeight * d * i
          } else {
            let d = Math.max(r, this.minPixelRatio) * i
            if (this.isSafari) {
              let p = Rt(this.ownerDocument)
              d *= Math.max(1, p)
            }
            t = Math.round(this.parentWidth) * d, o = Math.round(this.parentHeight) * d
          }
          let n = Math.sqrt(this.maxPixelCount) / Math.sqrt(t * o),
            a = Math.min(1, n),
            s = Math.round(t * a),
            c = Math.round(o * a),
            l = s / Math.round(this.parentWidth)
          ;(this.canvasElement.width !== s || this.canvasElement.height !== c || this.renderScale !== l) &&
            (this.renderScale = l,
              this.canvasElement.width = s,
              this.canvasElement.height = c,
              this.resolutionChanged = !0,
              this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height),
              this.render(performance.now()))
        })
        m(this, 'render', t => {
          if (this.hasBeenDisposed) return
          if (this.program === null) {
            console.warn('Tried to render before program or gl was initialized')
            return
          }
          let o = t - this.lastRenderTime
          this.lastRenderTime = t,
            this.currentSpeed !== 0 && (this.currentFrame += o * this.currentSpeed),
            this.gl.clear(this.gl.COLOR_BUFFER_BIT),
            this.gl.useProgram(this.program),
            this.gl.uniform1f(this.uniformLocations.u_time, this.currentFrame * .001),
            this.resolutionChanged &&
            (this.gl.uniform2f(this.uniformLocations.u_resolution, this.gl.canvas.width, this.gl.canvas.height),
              this.gl.uniform1f(this.uniformLocations.u_pixelRatio, this.renderScale),
              this.resolutionChanged = !1),
            this.gl.drawArrays(this.gl.TRIANGLES, 0, 6),
            this.currentSpeed !== 0 ? this.requestRender() : this.rafId = null
        })
        m(this, 'requestRender', () => {
          this.rafId !== null && cancelAnimationFrame(this.rafId), this.rafId = requestAnimationFrame(this.render)
        })
        m(this, 'setTextureUniform', (t, o) => {
          if (!o.complete || o.naturalWidth === 0) {
            throw new Error(`Paper Shaders: image for uniform ${t} must be fully loaded`)
          }
          let r = this.textures.get(t)
          r && this.gl.deleteTexture(r),
            this.textureUnitMap.has(t) || this.textureUnitMap.set(t, this.textureUnitMap.size)
          let i = this.textureUnitMap.get(t)
          this.gl.activeTexture(this.gl.TEXTURE0 + i)
          let n = this.gl.createTexture()
          this.gl.bindTexture(this.gl.TEXTURE_2D, n),
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE),
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE),
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR),
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR),
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, o),
            this.mipmaps.includes(t) &&
            (this.gl.generateMipmap(this.gl.TEXTURE_2D),
              this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_LINEAR))
          let a = this.gl.getError()
          if (a !== this.gl.NO_ERROR || n === null) {
            console.error('Paper Shaders: WebGL error when uploading texture:', a)
            return
          }
          this.textures.set(t, n)
          let s = this.uniformLocations[t]
          if (s) {
            this.gl.uniform1i(s, i)
            let c = `${t}AspectRatio`, l = this.uniformLocations[c]
            if (l) {
              let d = o.naturalWidth / o.naturalHeight
              this.gl.uniform1f(l, d)
            }
          }
        })
        m(
          this,
          'areUniformValuesEqual',
          (t, o) =>
            t === o
              ? !0
              : Array.isArray(t) && Array.isArray(o) && t.length === o.length
              ? t.every((r, i) => this.areUniformValuesEqual(r, o[i]))
              : !1
        )
        m(this, 'setUniformValues', t => {
          this.gl.useProgram(this.program),
            Object.entries(t).forEach(([o, r]) => {
              let i = r
              if (
                r instanceof HTMLImageElement && (i = `${r.src.slice(0, 200)}|${r.naturalWidth}x${r.naturalHeight}`),
                  this.areUniformValuesEqual(this.uniformCache[o], i)
              ) return
              this.uniformCache[o] = i
              let n = this.uniformLocations[o]
              if (!n) {
                console.warn(`Uniform location for ${o} not found`)
                return
              }
              if (r instanceof HTMLImageElement) this.setTextureUniform(o, r)
              else if (Array.isArray(r)) {
                let a = null, s = null
                if (r[0] !== void 0 && Array.isArray(r[0])) {
                  let c = r[0].length
                  if (r.every(l => l.length === c)) a = r.flat(), s = c
                  else {
                    console.warn(`All child arrays must be the same length for ${o}`)
                    return
                  }
                } else a = r, s = a.length
                switch (s) {
                  case 2:
                    this.gl.uniform2fv(n, a)
                    break
                  case 3:
                    this.gl.uniform3fv(n, a)
                    break
                  case 4:
                    this.gl.uniform4fv(n, a)
                    break
                  case 9:
                    this.gl.uniformMatrix3fv(n, !1, a)
                    break
                  case 16:
                    this.gl.uniformMatrix4fv(n, !1, a)
                    break
                  default:
                    console.warn(`Unsupported uniform array length: ${s}`)
                }
              } else {typeof r == 'number'
                  ? this.gl.uniform1f(n, r)
                  : typeof r == 'boolean'
                  ? this.gl.uniform1i(n, r ? 1 : 0)
                  : console.warn(`Unsupported uniform type for ${o}: ${typeof r}`)}
            })
        })
        m(this, 'getCurrentFrame', () => this.currentFrame)
        m(this, 'setFrame', t => {
          this.currentFrame = t, this.lastRenderTime = performance.now(), this.render(performance.now())
        })
        m(this, 'setSpeed', (t = 1) => {
          this.speed = t, this.setCurrentSpeed(this.ownerDocument.hidden ? 0 : t)
        })
        m(this, 'setCurrentSpeed', t => {
          this.currentSpeed = t,
            this.rafId === null && t !== 0 &&
            (this.lastRenderTime = performance.now(), this.rafId = requestAnimationFrame(this.render)),
            this.rafId !== null && t === 0 && (cancelAnimationFrame(this.rafId), this.rafId = null)
        })
        m(this, 'setMaxPixelCount', (t = Ve) => {
          this.maxPixelCount = t, this.handleResize()
        })
        m(this, 'setMinPixelRatio', (t = 2) => {
          this.minPixelRatio = t, this.handleResize()
        })
        m(this, 'setUniforms', t => {
          this.setUniformValues(t),
            this.providedUniforms = { ...this.providedUniforms, ...t },
            this.render(performance.now())
        })
        m(this, 'handleDocumentVisibilityChange', () => {
          this.setCurrentSpeed(this.ownerDocument.hidden ? 0 : this.speed)
        })
        m(this, 'dispose', () => {
          this.hasBeenDisposed = !0,
            this.rafId !== null && (cancelAnimationFrame(this.rafId), this.rafId = null),
            this.gl && this.program && (this.textures.forEach(t => {
              this.gl.deleteTexture(t)
            }),
              this.textures.clear(),
              this.gl.deleteProgram(this.program),
              this.program = null,
              this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null),
              this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null),
              this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, null),
              this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null),
              this.gl.getError()),
            this.resizeObserver && (this.resizeObserver.disconnect(), this.resizeObserver = null),
            visualViewport?.removeEventListener('resize', this.handleVisualViewportChange),
            this.ownerDocument.removeEventListener('visibilitychange', this.handleDocumentVisibilityChange),
            this.uniformLocations = {},
            this.canvasElement.remove(),
            delete this.parentElement.paperShaderMount
        })
        if (t?.nodeType === 1) this.parentElement = t
        else throw new Error('Paper Shaders: parent element must be an HTMLElement')
        if (this.ownerDocument = t.ownerDocument, !this.ownerDocument.querySelector('style[data-paper-shader]')) {
          let h = this.ownerDocument.createElement('style')
          h.innerHTML = Mt, h.setAttribute('data-paper-shader', ''), this.ownerDocument.head.prepend(h)
        }
        let d = this.ownerDocument.createElement('canvas')
        this.canvasElement = d,
          this.parentElement.prepend(d),
          this.fragmentShader = o,
          this.providedUniforms = r,
          this.mipmaps = l,
          this.currentFrame = a,
          this.minPixelRatio = s,
          this.maxPixelCount = c
        let p = d.getContext('webgl2', i)
        if (!p) throw new Error('Paper Shaders: WebGL is not supported in this browser')
        this.gl = p,
          this.initProgram(),
          this.setupPositionAttribute(),
          this.setupUniforms(),
          this.setUniformValues(this.providedUniforms),
          this.setupResizeObserver(),
          visualViewport?.addEventListener('resize', this.handleVisualViewportChange),
          this.setSpeed(n),
          this.parentElement.setAttribute('data-paper-shader', ''),
          this.parentElement.paperShaderMount = this,
          this.ownerDocument.addEventListener('visibilitychange', this.handleDocumentVisibilityChange)
      }
    }
  function Te(e, t, o) {
    let r = e.createShader(t)
    return r
      ? (e.shaderSource(r, o),
        e.compileShader(r),
        e.getShaderParameter(r, e.COMPILE_STATUS)
          ? r
          : (console.error('An error occurred compiling the shaders: ' + e.getShaderInfoLog(r)),
            e.deleteShader(r),
            null))
      : null
  }
  function _t(e, t, o) {
    let r = e.getShaderPrecisionFormat(e.FRAGMENT_SHADER, e.MEDIUM_FLOAT), i = r ? r.precision : null
    i && i < 23 &&
      (t = t.replace(/precision\s+(lowp|mediump)\s+float;/g, 'precision highp float;'),
        o = o.replace(/precision\s+(lowp|mediump)\s+float/g, 'precision highp float').replace(
          /\b(uniform|varying|attribute)\s+(lowp|mediump)\s+(\w+)/g,
          '$1 highp $3'
        ))
    let n = Te(e, e.VERTEX_SHADER, t), a = Te(e, e.FRAGMENT_SHADER, o)
    if (!n || !a) return null
    let s = e.createProgram()
    return s
      ? (e.attachShader(s, n),
        e.attachShader(s, a),
        e.linkProgram(s),
        e.getProgramParameter(s, e.LINK_STATUS)
          ? (e.detachShader(s, n), e.detachShader(s, a), e.deleteShader(n), e.deleteShader(a), s)
          : (console.error('Unable to initialize the shader program: ' + e.getProgramInfoLog(s)),
            e.deleteProgram(s),
            e.deleteShader(n),
            e.deleteShader(a),
            null))
      : null
  }
  var Mt = `@layer paper-shaders {
  :where([data-paper-shader]) {
    isolation: isolate;
    position: relative;

    & canvas {
      contain: strict;
      display: block;
      position: absolute;
      inset: 0;
      z-index: -1;
      width: 100%;
      height: 100%;
      border-radius: inherit;
      corner-shape: inherit;
    }
  }
}`
  function yt() {
    let e = navigator.userAgent.toLowerCase()
    return e.includes('safari') && !e.includes('chrome') && !e.includes('android')
  }
  function Rt(e) {
    let t = visualViewport?.scale ?? 1,
      o = visualViewport?.width ?? window.innerWidth,
      r = window.innerWidth - e.documentElement.clientWidth,
      i = t * o + r,
      n = outerWidth / i,
      a = Math.round(100 * n)
    return a % 5 === 0 ? a / 100 : a === 33 ? 1 / 3 : a === 67 ? 2 / 3 : a === 133 ? 4 / 3 : n
  }
  var z = { none: 0, contain: 1, cover: 2 }
  var ze = `
#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846
`,
    Oe = `
vec2 rotate(vec2 uv, float th) {
  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}
`
  var Le = `
  color += 1. / 256. * (fract(sin(dot(.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123) - .5);
`,
    Ae = `
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
    -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
      dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`
  var ie = `#version 300 es
precision mediump float;

uniform sampler2D u_image;
uniform float u_imageAspectRatio;

uniform vec2 u_resolution;
uniform float u_time;

uniform vec4 u_colorBack;
uniform vec4 u_colorTint;

uniform float u_softness;
uniform float u_repetition;
uniform float u_shiftRed;
uniform float u_shiftBlue;
uniform float u_distortion;
uniform float u_contour;
uniform float u_angle;

uniform float u_shape;
uniform bool u_isImage;

in vec2 v_objectUV;
in vec2 v_responsiveUV;
in vec2 v_responsiveBoxGivenSize;
in vec2 v_imageUV;

out vec4 fragColor;

${ze}
${Oe}
${Ae}

float getColorChanges(float c1, float c2, float stripe_p, vec3 w, float blur, float bump, float tint) {

  float ch = mix(c2, c1, smoothstep(.0, 2. * blur, stripe_p));

  float border = w[0];
  ch = mix(ch, c2, smoothstep(border, border + 2. * blur, stripe_p));

  if (u_isImage == true) {
    bump = smoothstep(.2, .8, bump);
  }
  border = w[0] + .4 * (1. - bump) * w[1];
  ch = mix(ch, c1, smoothstep(border, border + 2. * blur, stripe_p));

  border = w[0] + .5 * (1. - bump) * w[1];
  ch = mix(ch, c2, smoothstep(border, border + 2. * blur, stripe_p));

  border = w[0] + w[1];
  ch = mix(ch, c1, smoothstep(border, border + 2. * blur, stripe_p));

  float gradient_t = (stripe_p - w[0] - w[1]) / w[2];
  float gradient = mix(c1, c2, smoothstep(0., 1., gradient_t));
  ch = mix(ch, gradient, smoothstep(border, border + .5 * blur, stripe_p));

  // Tint color is applied with color burn blending
  ch = mix(ch, 1. - min(1., (1. - ch) / max(tint, 0.0001)), u_colorTint.a);
  return ch;
}

float getImgFrame(vec2 uv, float th) {
  float frame = 1.;
  frame *= smoothstep(0., th, uv.y);
  frame *= 1.0 - smoothstep(1. - th, 1., uv.y);
  frame *= smoothstep(0., th, uv.x);
  frame *= 1.0 - smoothstep(1. - th, 1., uv.x);
  return frame;
}

float blurEdge3x3(sampler2D tex, vec2 uv, vec2 dudx, vec2 dudy, float radius, float centerSample) {
  vec2 texel = 1.0 / vec2(textureSize(tex, 0));
  vec2 r = radius * texel;

  float w1 = 1.0, w2 = 2.0, w4 = 4.0;
  float norm = 16.0;
  float sum = w4 * centerSample;

  sum += w2 * textureGrad(tex, uv + vec2(0.0, -r.y), dudx, dudy).r;
  sum += w2 * textureGrad(tex, uv + vec2(0.0, r.y), dudx, dudy).r;
  sum += w2 * textureGrad(tex, uv + vec2(-r.x, 0.0), dudx, dudy).r;
  sum += w2 * textureGrad(tex, uv + vec2(r.x, 0.0), dudx, dudy).r;

  sum += w1 * textureGrad(tex, uv + vec2(-r.x, -r.y), dudx, dudy).r;
  sum += w1 * textureGrad(tex, uv + vec2(r.x, -r.y), dudx, dudy).r;
  sum += w1 * textureGrad(tex, uv + vec2(-r.x, r.y), dudx, dudy).r;
  sum += w1 * textureGrad(tex, uv + vec2(r.x, r.y), dudx, dudy).r;

  return sum / norm;
}

float lst(float edge0, float edge1, float x) {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}

void main() {

  const float firstFrameOffset = 2.8;
  float t = .3 * (u_time + firstFrameOffset);

  vec2 uv = v_imageUV;
  vec2 dudx = dFdx(v_imageUV);
  vec2 dudy = dFdy(v_imageUV);
  vec4 img = textureGrad(u_image, uv, dudx, dudy);

  if (u_isImage == false) {
    uv = v_objectUV + .5;
    uv.y = 1. - uv.y;
  }

  float cycleWidth = u_repetition;
  float edge = 0.;
  float contOffset = 1.;

  vec2 rotatedUV = uv - vec2(.5);
  float angle = (-u_angle + 70.) * PI / 180.;
  float cosA = cos(angle);
  float sinA = sin(angle);
  rotatedUV = vec2(
  rotatedUV.x * cosA - rotatedUV.y * sinA,
  rotatedUV.x * sinA + rotatedUV.y * cosA
  ) + vec2(.5);

  if (u_isImage == true) {
    float edgeRaw = img.r;
    edge = blurEdge3x3(u_image, uv, dudx, dudy, 6., edgeRaw);
    edge = pow(edge, 1.6);
    edge *= mix(0.0, 1.0, smoothstep(0.0, 0.4, u_contour));
  } else {
    if (u_shape < 1.) {
      // full-fill on canvas
      vec2 borderUV = v_responsiveUV + .5;
      float ratio = v_responsiveBoxGivenSize.x / v_responsiveBoxGivenSize.y;
      vec2 mask = min(borderUV, 1. - borderUV);
      vec2 pixel_thickness = min(250. / v_responsiveBoxGivenSize, vec2(.5));
      float maskX = smoothstep(0.0, pixel_thickness.x, mask.x);
      float maskY = smoothstep(0.0, pixel_thickness.y, mask.y);
      maskX = pow(maskX, .25);
      maskY = pow(maskY, .25);
      edge = clamp(1. - maskX * maskY, 0., 1.);

      uv = v_responsiveUV;
      if (ratio > 1.) {
        uv.y /= ratio;
      } else {
        uv.x *= ratio;
      }
      uv += .5;
      uv.y = 1. - uv.y;

      cycleWidth *= 2.;
      contOffset = 1.5;

    } else if (u_shape < 2.) {
      // circle
      vec2 shapeUV = uv - .5;
      shapeUV *= .67;
      edge = pow(clamp(3. * length(shapeUV), 0., 1.), 18.);
    } else if (u_shape < 3.) {
      // daisy
      vec2 shapeUV = uv - .5;
      shapeUV *= 1.68;

      float r = length(shapeUV) * 2.;
      float a = atan(shapeUV.y, shapeUV.x) + .2;
      r *= (1. + .05 * sin(3. * a + 2. * t));
      float f = abs(cos(a * 3.));
      edge = smoothstep(f, f + .7, r);
      edge *= edge;

      uv *= .8;
      cycleWidth *= 1.6;

    } else if (u_shape < 4.) {
      // diamond
      vec2 shapeUV = uv - .5;
      shapeUV = rotate(shapeUV, .25 * PI);
      shapeUV *= 1.42;
      shapeUV += .5;
      vec2 mask = min(shapeUV, 1. - shapeUV);
      vec2 pixel_thickness = vec2(.15);
      float maskX = smoothstep(0.0, pixel_thickness.x, mask.x);
      float maskY = smoothstep(0.0, pixel_thickness.y, mask.y);
      maskX = pow(maskX, .25);
      maskY = pow(maskY, .25);
      edge = clamp(1. - maskX * maskY, 0., 1.);
    } else if (u_shape < 5.) {
      // metaballs
      vec2 shapeUV = uv - .5;
      shapeUV *= 1.3;
      edge = 0.;
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float speed = 1.5 + 2./3. * sin(fi * 12.345);
        float angle = -fi * 1.5;
        vec2 dir1 = vec2(cos(angle), sin(angle));
        vec2 dir2 = vec2(cos(angle + 1.57), sin(angle + 1.));
        vec2 traj = .4 * (dir1 * sin(t * speed + fi * 1.23) + dir2 * cos(t * (speed * 0.7) + fi * 2.17));
        float d = length(shapeUV + traj);
        edge += pow(1.0 - clamp(d, 0.0, 1.0), 4.0);
      }
      edge = 1. - smoothstep(.65, .9, edge);
      edge = pow(edge, 4.);
    }

    edge = mix(smoothstep(.9 - 2. * fwidth(edge), .9, edge), edge, smoothstep(0.0, 0.4, u_contour));

  }

  float opacity = 0.;
  if (u_isImage == true) {
    opacity = img.g;
    float frame = getImgFrame(v_imageUV, 0.);
    opacity *= frame;
  } else {
    opacity = 1. - smoothstep(.9 - 2. * fwidth(edge), .9, edge);
    if (u_shape < 2.) {
      edge = 1.2 * edge;
    } else if (u_shape < 5.) {
      edge = 1.8 * pow(edge, 1.5);
    }
  }

  float diagBLtoTR = rotatedUV.x - rotatedUV.y;
  float diagTLtoBR = rotatedUV.x + rotatedUV.y;

  vec3 color = vec3(0.);
  vec3 color1 = vec3(.98, 0.98, 1.);
  vec3 color2 = vec3(.1, .1, .1 + .1 * smoothstep(.7, 1.3, diagTLtoBR));

  vec2 grad_uv = uv - .5;

  float dist = length(grad_uv + vec2(0., .2 * diagBLtoTR));
  grad_uv = rotate(grad_uv, (.25 - .2 * diagBLtoTR) * PI);
  float direction = grad_uv.x;

  float bump = pow(1.8 * dist, 1.2);
  bump = 1. - bump;
  bump *= pow(uv.y, .3);


  float thin_strip_1_ratio = .12 / cycleWidth * (1. - .4 * bump);
  float thin_strip_2_ratio = .07 / cycleWidth * (1. + .4 * bump);
  float wide_strip_ratio = (1. - thin_strip_1_ratio - thin_strip_2_ratio);

  float thin_strip_1_width = cycleWidth * thin_strip_1_ratio;
  float thin_strip_2_width = cycleWidth * thin_strip_2_ratio;

  float noise = snoise(uv - t);

  edge += (1. - edge) * u_distortion * noise;

  direction += diagBLtoTR;
  float contour = 0.;
  direction -= 2. * noise * diagBLtoTR * (smoothstep(0., 1., edge) * (1.0 - smoothstep(0., 1., edge)));
  direction *= mix(1., 1. - edge, smoothstep(.5, 1., u_contour));
  direction -= 1.7 * edge * smoothstep(.5, 1., u_contour);
  direction += .2 * pow(u_contour, 4.) * (1.0 - smoothstep(0., 1., edge));

  bump *= clamp(pow(uv.y, .1), .3, 1.);
  direction *= (.1 + (1.1 - edge) * bump);

  direction *= (.4 + .6 * (1.0 - smoothstep(.5, 1., edge)));
  direction += .18 * (smoothstep(.1, .2, uv.y) * (1.0 - smoothstep(.2, .4, uv.y)));
  direction += .03 * (smoothstep(.1, .2, 1. - uv.y) * (1.0 - smoothstep(.2, .4, 1. - uv.y)));

  direction *= (.5 + .5 * pow(uv.y, 2.));
  direction *= cycleWidth;
  direction -= t;


  float colorDispersion = (1. - bump);
  colorDispersion = clamp(colorDispersion, 0., 1.);
  float dispersionRed = colorDispersion;
  dispersionRed += .03 * bump * noise;
  dispersionRed += 5. * (smoothstep(-.1, .2, uv.y) * (1.0 - smoothstep(.1, .5, uv.y))) * (smoothstep(.4, .6, bump) * (1.0 - smoothstep(.4, 1., bump)));
  dispersionRed -= diagBLtoTR;

  float dispersionBlue = colorDispersion;
  dispersionBlue *= 1.3;
  dispersionBlue += (smoothstep(0., .4, uv.y) * (1.0 - smoothstep(.1, .8, uv.y))) * (smoothstep(.4, .6, bump) * (1.0 - smoothstep(.4, .8, bump)));
  dispersionBlue -= .2 * edge;

  dispersionRed *= (u_shiftRed / 20.);
  dispersionBlue *= (u_shiftBlue / 20.);

  float blur = 0.;
  float rExtraBlur = 0.;
  float gExtraBlur = 0.;
  if (u_isImage == true) {
    float softness = 0.05 * u_softness;
    blur = softness + .5 * smoothstep(1., 10., u_repetition) * smoothstep(.0, 1., edge);
    float smallCanvasT = 1.0 - smoothstep(100., 500., min(u_resolution.x, u_resolution.y));
    blur += smallCanvasT * smoothstep(.0, 1., edge);
    rExtraBlur = softness * (0.05 + .1 * (u_shiftRed / 20.) * bump);
    gExtraBlur = softness * 0.05 / max(0.001, abs(1. - diagBLtoTR));
  } else {
    blur = u_softness / 15. + .3 * contour;
  }

  vec3 w = vec3(thin_strip_1_width, thin_strip_2_width, wide_strip_ratio);
  w[1] -= .02 * smoothstep(.0, 1., edge + bump);
  float stripe_r = fract(direction + dispersionRed);
  float r = getColorChanges(color1.r, color2.r, stripe_r, w, blur + fwidth(stripe_r) + rExtraBlur, bump, u_colorTint.r);
  float stripe_g = fract(direction);
  float g = getColorChanges(color1.g, color2.g, stripe_g, w, blur + fwidth(stripe_g) + gExtraBlur, bump, u_colorTint.g);
  float stripe_b = fract(direction - dispersionBlue);
  float b = getColorChanges(color1.b, color2.b, stripe_b, w, blur + fwidth(stripe_b), bump, u_colorTint.b);

  color = vec3(r, g, b);
  color *= opacity;

  vec3 bgColor = u_colorBack.rgb * u_colorBack.a;
  color = color + bgColor * (1. - opacity);
  opacity = opacity + u_colorBack.a * (1. - opacity);

  ${Le}

  fragColor = vec4(color, opacity);
}
`
  var O = { none: 0, circle: 1, daisy: 2, diamond: 3, metaballs: 4 }
  function L(e) {
    if (Array.isArray(e)) return e.length === 4 ? e : e.length === 3 ? [...e, 1] : ne
    if (typeof e != 'string') return ne
    let t, o, r, i = 1
    if (e.startsWith('#')) [t, o, r, i] = wt(e)
    else if (e.startsWith('rgb')) [t, o, r, i] = Ct(e)
    else if (e.startsWith('hsl')) [t, o, r, i] = Et(Ft(e))
    else return console.error('Unsupported color format', e), ne
    return [N(t, 0, 1), N(o, 0, 1), N(r, 0, 1), N(i, 0, 1)]
  }
  function wt(e) {
    e = e.replace(/^#/, ''),
      e.length === 3 && (e = e.split('').map(n => n + n).join('')),
      e.length === 6 && (e = e + 'ff')
    let t = parseInt(e.slice(0, 2), 16) / 255,
      o = parseInt(e.slice(2, 4), 16) / 255,
      r = parseInt(e.slice(4, 6), 16) / 255,
      i = parseInt(e.slice(6, 8), 16) / 255
    return [t, o, r, i]
  }
  function Ct(e) {
    let t = e.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)$/i)
    return t
      ? [
        parseInt(t[1] ?? '0') / 255,
        parseInt(t[2] ?? '0') / 255,
        parseInt(t[3] ?? '0') / 255,
        t[4] === void 0 ? 1 : parseFloat(t[4])
      ]
      : [0, 0, 0, 1]
  }
  function Ft(e) {
    let t = e.match(/^hsla?\s*\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*(?:,\s*([0-9.]+))?\s*\)$/i)
    return t
      ? [parseInt(t[1] ?? '0'), parseInt(t[2] ?? '0'), parseInt(t[3] ?? '0'), t[4] === void 0 ? 1 : parseFloat(t[4])]
      : [0, 0, 0, 1]
  }
  function Et(e) {
    let [t, o, r, i] = e, n = t / 360, a = o / 100, s = r / 100, c, l, d
    if (o === 0) c = l = d = s
    else {
      let p = (
          g,
          v,
          f
        ) => (f < 0 && (f += 1),
          f > 1 && (f -= 1),
          f < .16666666666666666
            ? g + (v - g) * 6 * f
            : f < .5
            ? v
            : f < .6666666666666666
            ? g + (v - g) * (.6666666666666666 - f) * 6
            : g),
        h = s < .5 ? s * (1 + a) : s + a - s * a,
        u = 2 * s - h
      c = p(u, h, n + 1 / 3), l = p(u, h, n), d = p(u, h, n - 1 / 3)
    }
    return [c, l, d, i]
  }
  var N = (e, t, o) => Math.min(Math.max(e, t), o), ne = [0, 0, 0, 1]
  var ke = (e, t, o, r, i) => {
    let n = t.mount.canvasElement.width / t.width
    e.ctx.drawImage(t.mount.canvasElement, o * n, o * n, r * n, i * n, 0, 0, r, i)
  }
  var He = 2048 * 2048,
    It = .24,
    Bt = 320,
    ae = {
      u_angle: 138,
      u_colorTint: L('#ffffff'),
      u_contour: .68,
      u_distortion: 1,
      u_fit: z.contain,
      u_imageAspectRatio: 1,
      u_isImage: !1,
      u_offsetX: 0,
      u_offsetY: 0,
      u_originX: .5,
      u_originY: .5,
      u_repetition: 2.36,
      u_rotation: 45,
      u_scale: 1.42,
      u_shape: O.diamond,
      u_shiftBlue: .3,
      u_shiftRed: 0,
      u_softness: 1,
      u_worldHeight: 0,
      u_worldWidth: 0
    },
    De = null,
    Ne = (e, t) => {
      let o = Ot(e)
      if (!o) return !1
      zt(e), Lt(e, o)
      let r = e.isStatic ? 0 : (t + (e.motionOffset || 0) * 1e3) * It
      return o.mount.setFrame(r),
        e.isFullscreen ? (At(e, o), !0) : (e.ctx.drawImage(o.mount.canvasElement, 0, 0, e.width, e.height), !0)
    },
    Ut = e => L(e === 'light' ? '#868986' : '#101112'),
    Pt = e => L(e === 'light' ? '#d4d2c5' : '#d8d7ca'),
    Vt = () => {
      let e = document.createElement('div')
      return e.setAttribute('aria-hidden', 'true'),
        Object.assign(e.style, {
          height: '1px',
          left: '-10000px',
          opacity: '0',
          overflow: 'hidden',
          pointerEvents: 'none',
          position: 'fixed',
          top: '0',
          width: '1px'
        }),
        document.body.appendChild(e),
        e
    },
    Tt = () => document.body ? (De ?? (De = Vt()), De) : null,
    We = e => {
      let t = !!e.isFullscreen
      return {
        ...ae,
        u_colorBack: Ut(e.mode),
        u_colorTint: Pt(e.mode),
        u_fit: t ? z.cover : z.contain,
        u_rotation: t ? 0 : ae.u_rotation,
        u_scale: t ? 1 : ae.u_scale,
        u_shape: t ? O.none : O.diamond
      }
    },
    Ge = e => {
      let t = Math.max(1, Math.round(e.width)), o = Math.max(1, Math.round(e.height)), r = e.isFullscreen ? Bt : 0
      return { bleed: r, height: o, renderHeight: o + r * 2, renderWidth: t + r * 2, width: t }
    },
    zt = e => {
      let t = e.paperMetalShader
      if (!t) return
      let { renderWidth: o, renderHeight: r } = Ge(e), i = Math.min(He, Math.max(1, Math.round(o * r * e.dpr ** 2)))
      t.width === o && t.height === r && t.dpr === e.dpr && t.pixelCount === i ||
        (t.width = o,
          t.height = r,
          t.dpr = e.dpr,
          t.pixelCount = i,
          t.host.style.width = `${o}px`,
          t.host.style.height = `${r}px`,
          t.mount.setMinPixelRatio(Math.max(1, e.dpr)),
          t.mount.setMaxPixelCount(i),
          t.mount.parentWidth = o,
          t.mount.parentHeight = r,
          t.mount.devicePixelsSupported = !1,
          t.mount.handleResize())
    },
    Ot = e => {
      if (e.paperMetalFailed) return null
      if (e.paperMetalShader) return e.paperMetalShader
      let t = Tt()
      if (!t) return null
      let o = document.createElement('div')
      o.style.width = '1px', o.style.height = '1px', o.style.borderRadius = 'inherit', t.appendChild(o)
      try {
        let r = new T(
          o,
          ie,
          We(e),
          { alpha: !0, antialias: !0, depth: !1, premultipliedAlpha: !0, preserveDrawingBuffer: !0, stencil: !1 },
          0,
          0,
          Math.max(1, e.dpr),
          He
        )
        e.paperMetalShader = {
          dpr: 0,
          fullscreen: !!e.isFullscreen,
          height: 0,
          host: o,
          mode: e.mode,
          mount: r,
          pixelCount: 0,
          width: 0
        }
      } catch (r) {
        return o.remove(),
          e.paperMetalFailed = !0,
          console.warn('Paper Liquid Metal shader unavailable; using canvas fallback.', r),
          null
      }
      return e.paperMetalShader
    },
    Lt = (e, t) => {
      let o = !!e.isFullscreen
      t.mode === e.mode && t.fullscreen === o || (t.mode = e.mode, t.fullscreen = o, t.mount.setUniforms(We(e)))
    },
    At = (e, t) => {
      let { bleed: o, height: r, width: i } = Ge(e)
      ke(e, t, o, i, r)
    }
  var $e = (e, t) => {
      let { ctx: o, height: r, mode: i, theme: n, width: a } = e
      if (e.backgroundStyle !== 'transparent') {
        if (e.backgroundStyle === 'solid') {
          o.fillStyle = Ce(n, i), o.fillRect(0, 0, a, r)
          return
        }
        if (n === 'industrial') {
          let s = o.createLinearGradient(0, 0, a, r)
          i === 'light'
            ? (s.addColorStop(0, '#fff8f2'), s.addColorStop(.56, '#fff1e7'), s.addColorStop(1, '#ffe2cf'))
            : (s.addColorStop(0, '#160b07'), s.addColorStop(.56, '#090706'), s.addColorStop(1, '#1b0d08')),
            o.fillStyle = s,
            o.fillRect(0, 0, a, r)
          return
        }
        if (n === 'matrix') {
          o.fillStyle = i === 'light' ? '#f7fff9' : '#000000', o.fillRect(0, 0, a, r)
          return
        }
        if (n === 'metal') {
          kt(e, t)
          return
        }
        o.fillStyle = i === 'light' ? '#ffffff' : '#050505', o.fillRect(0, 0, a, r)
      }
    },
    kt = (e, t) => {
      if (Ne(e, t)) return
      let { ctx: o, height: r, mode: i, width: n } = e, a = o.createLinearGradient(0, 0, 0, r)
      i === 'light'
        ? (a.addColorStop(0, '#dcddd8'),
          a.addColorStop(.36, '#8e9792'),
          a.addColorStop(.68, '#ecece6'),
          a.addColorStop(1, '#7f8985'))
        : (a.addColorStop(0, '#050607'),
          a.addColorStop(.38, '#343a39'),
          a.addColorStop(.68, '#0d0f10'),
          a.addColorStop(1, '#626b68')),
        o.fillStyle = a,
        o.fillRect(0, 0, n, r)
    }
  var je = (e, t, o) => {
      let { ctx: r, height: i, mode: n, theme: a, width: s } = e,
        c = Math.min(s, i) / 1024,
        l = (s - 1024 * c) / 2,
        d = (i - 1024 * c) / 2
      r.save(), r.translate(l, d), r.scale(c, c), r.lineJoin = 'round', r.lineWidth = .9 / c
      for (let p of o) Dt(e, p, t)
      r.restore()
    },
    Dt = (e, t, o) => {
      let r = t.points[0]
      if (!r) return
      let i = we(e.theme, e.mode, t.depth, t.u, t.v, o * .001)
      e.ctx.fillStyle = i, e.ctx.strokeStyle = i, e.ctx.beginPath(), e.ctx.moveTo(r.x, r.y)
      for (let n = 1; n < t.points.length; n += 1) {
        let a = t.points[n]
        a && e.ctx.lineTo(a.x, a.y)
      }
      e.ctx.closePath(), e.ctx.fill(), e.ctx.stroke()
    }
  var Ht = ['metal', 'industrial', 'matrix'],
    Nt = ['light', 'dark'],
    Wt = ['system', 'light', 'dark'],
    Gt = [{ theme: 'industrial', primaryColor: '#E23F12' }, { theme: 'metal', primaryColor: '#3F7E8F' }, {
      theme: 'matrix',
      primaryColor: '#00B454'
    }],
    $t = 'metal',
    le = 'dark',
    jt = 'system'
  var Qo = Gt[0].primaryColor
  var ce = (e, t) => e.includes(t),
    W = e => ce(Ht, e) ? e : $t,
    G = e => ce(Nt, e) ? e : le,
    Xe = e => ce(Wt, e) ? e : jt
  var Xt = e => {
      let t = e.getContext('2d')
      if (!t) throw new Error('Unable to create a 2D canvas context for the OneWorks icon renderer.')
      return t
    },
    Yt = e => e === 'none' || e === 'transparent' ? 'transparent' : e === 'solid' ? 'solid' : 'textured',
    qt = ({ backgroundStyle: e, datasetBackground: t, noBackground: o }) =>
      e ?? (o != null ? o ? 'transparent' : 'textured' : Yt(t)),
    Ye = (e, t, o = {}) => {
      let r = o.theme ?? W(t.dataset.theme),
        i = o.mode ?? G(t.dataset.mode),
        n = o.static ?? t.dataset.static === 'true',
        a = qt({
          backgroundStyle: o.backgroundStyle,
          datasetBackground: t.dataset.background,
          noBackground: o.noBackground
        }),
        s = a === 'transparent'
      return {
        ...e.createMotionSource(),
        backgroundStyle: a,
        baseBackgroundStyle: a,
        baseNoBackground: s,
        baseStatic: n,
        canvas: t,
        ctx: Xt(t),
        dpr: 1,
        heatCellSize: 14,
        heatCells: [],
        heatCols: 0,
        heatRows: 0,
        height: 0,
        isFullscreen: o.fullscreen ?? !1,
        isStatic: n,
        mode: i,
        nextHeatUpdate: 0,
        noBackground: s,
        noShadow: o.shadow === !1,
        rainColumns: [],
        rainFontSize: 13,
        root: t.closest('.mobiusLoader'),
        theme: r,
        width: 0
      }
    }
  var qe = e => {
      e.paperMetalShader?.mount.dispose(), e.paperMetalShader?.host.remove(), e.paperMetalShader = void 0
    },
    de = (e, t) => {
      e.resetMotionSource(t), $(e, t)
    },
    $ = (e, t) => {
      t.theme === 'matrix' && t.width > 0 && Ie(e, t), t.theme === 'industrial' && t.width > 0 && Be(e, t)
    },
    ue = (e, t) => {
      let o = t.canvas.getBoundingClientRect(),
        r = Math.max(1, Math.round(o.width)),
        i = Math.max(1, Math.round(o.height)),
        n = r * i,
        a = n > 62e4 ? 1 : n > 26e4 ? 1.5 : 2,
        s = Math.min(window.devicePixelRatio || 1, a)
      r === t.width && i === t.height && s === t.dpr && t.canvas.width === Math.round(r * s) ||
        (t.width = r,
          t.height = i,
          t.dpr = s,
          t.canvas.width = Math.round(r * s),
          t.canvas.height = Math.round(i * s),
          t.ctx.setTransform(s, 0, 0, s, 0, 0),
          $(e, t))
    },
    Qe = (e, t, o, r) => {
      ue(e, t), Qt(e, t, o, r)
    },
    Qt = (e, t, o, r) => {
      let { ctx: i, height: n, width: a } = t
      i.setTransform(t.dpr, 0, 0, t.dpr, 0, 0), i.clearRect(0, 0, a, n), $e(t, o), Ue(e, t, o), je(t, o, r)
    }
  var Ze = e => window.requestAnimationFrame?.(e) ?? window.setTimeout(() => e(performance.now()), 16),
    Je = e => {
      window.cancelAnimationFrame ? window.cancelAnimationFrame(e) : window.clearTimeout(e)
    },
    Zt = e => e === !1 || e === 'transparent' ? 'transparent' : e === 'solid' ? 'solid' : 'textured',
    me = e => e === 'transparent' ? 'none' : e === 'solid' ? 'solid' : 'tile',
    he = e => {
      let t = Zt(e.background)
      return {
        appearance: Xe(e.appearance),
        autoStart: e.autoStart ?? !0,
        background: t !== 'transparent',
        backgroundStyle: t,
        canvasClassName: e.canvasClassName ?? 'oneworks-icon-loader__canvas',
        className: e.className ?? 'oneworks-icon-loader',
        fullscreen: e.fullscreen ?? !1,
        mode: e.mode == null ? void 0 : G(e.mode),
        motion: e.motion ?? !0,
        random: e.random ?? e.seed == null,
        respectReducedMotion: e.respectReducedMotion ?? !0,
        seed: I(e.seed),
        shadow: e.shadow ?? !0,
        size: e.size,
        theme: W(e.theme)
      }
    },
    pe = e => typeof window > 'u' || !window.matchMedia ? null : window.matchMedia(e),
    j = (e, t) =>
      e.mode ? e.mode : e.appearance === 'light' || e.appearance === 'dark' ? e.appearance : t?.matches ? 'dark' : le,
    X = (e, t) => e.motion && (!e.respectReducedMotion || !t?.matches),
    fe = (e, t) => {
      if (t == null) return
      let o = typeof t == 'number' ? `${t}px` : t
      e.style.width = o, e.style.height = o
    },
    Y = (e, t, o, r, i, n) => {
      let a = r.theme !== i.theme, s = r.mode !== n
      r.theme = i.theme,
        r.mode = n,
        r.isStatic = !i.motion,
        r.backgroundStyle = i.backgroundStyle,
        r.noBackground = i.backgroundStyle === 'transparent',
        r.noShadow = !i.shadow,
        r.isFullscreen = i.fullscreen,
        o.dataset.theme = i.theme,
        o.dataset.mode = n,
        o.dataset.background = me(i.backgroundStyle),
        o.dataset.static = String(!i.motion),
        Jt(t, r),
        (a || s) && r.width > 0 && $(e, r)
    },
    Jt = (e, t) => {
      e.classList.remove(
        'metal',
        'industrial',
        'matrix',
        'mode-light',
        'mode-dark',
        'no-bg',
        'no-shadow',
        'fullscreen'
      ),
        e.classList.add(t.theme, `mode-${t.mode}`),
        e.classList.toggle('no-bg', t.noBackground),
        e.classList.toggle('no-shadow', t.noShadow),
        e.classList.toggle('fullscreen', t.isFullscreen)
    }
  var Kt = 1e3 / 24,
    eo = (e, t = {}) => {
      let o = he(t),
        r = pe('(prefers-reduced-motion: reduce)'),
        i = pe('(prefers-color-scheme: dark)'),
        n = o.random ? R() : o.seed ?? R(),
        a = Ee(n),
        s = document.createElement('canvas'),
        c = j(o, i)
      s.className = o.canvasClassName,
        s.dataset.theme = o.theme,
        s.dataset.mode = c,
        s.dataset.background = me(o.backgroundStyle),
        s.dataset.static = String(!o.motion),
        e.classList.add(o.className, 'mobiusLoader'),
        fe(e, o.size),
        e.appendChild(s)
      let l = Ye(a, s, to(o, c))
      Y(a, e, s, l, o, c)
      let d = !1,
        p = null,
        h = -1 / 0,
        u = b => {
          let w = X(o, r), k = b * .001
          l.isStatic = !w
          let xe = l.isStatic ? 0 : 1, tt = l.isStatic ? a.staticMesh : a.buildMesh(k, xe, a.getMotionState(k, xe, l))
          Qe(a, l, l.isStatic ? 0 : b, tt)
        },
        g = () => {
          d || p != null || (p = Ze(v))
        },
        v = b => {
          p = null, (b - h >= Kt || h < 0) && (h = b, u(b)), X(o, r) && g()
        },
        f = (b = performance.now()) => {
          h = b, u(b), X(o, r) && g()
        },
        x = () => {
          p != null && (Je(p), p = null)
        },
        C = () => {
          d || f()
        },
        U = b => {
          if (d) return
          let w = o
          o = he({ ...o, background: o.backgroundStyle, ...b }),
            et(w, o, b),
            fe(e, o.size),
            Y(a, e, s, l, o, j(o, i)),
            f()
        },
        ge = () => {
          d || (ue(a, l), f())
        },
        A = () => {
          d || (Y(a, e, s, l, o, j(o, i)), f())
        }
      window.addEventListener('resize', ge), r?.addEventListener?.('change', A), i?.addEventListener?.('change', A)
      let Ke = () => {
          d ||
            (d = !0,
              x(),
              window.removeEventListener('resize', ge),
              r?.removeEventListener?.('change', A),
              i?.removeEventListener?.('change', A),
              qe(l),
              s.remove())
        },
        et = (b, w, k) => {
          k.random === !0 && !b.random
            ? (a.resetSeed(R()), de(a, l))
            : w.seed && w.seed !== a.seed && w.random === !1 && (a.resetSeed(w.seed), de(a, l))
        }
      return o.autoStart && C(), {
        get seed() {
          return a.seed
        },
        canvas: s,
        core: a,
        dispose: Ke,
        redraw: f,
        renderer: l,
        start: C,
        stop: x,
        update: U
      }
    },
    to = (e, t) => ({
      backgroundStyle: e.backgroundStyle,
      fullscreen: e.fullscreen,
      mode: t,
      shadow: e.shadow,
      static: !e.motion,
      theme: e.theme
    })
  return lt(oo)
})()
