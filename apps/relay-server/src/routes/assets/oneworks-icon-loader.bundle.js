"use strict";
var OneWorksIconLoader = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // packages/icon/src/loader.ts
  var loader_exports = {};
  __export(loader_exports, {
    mountOneWorksIconLoader: () => mountOneWorksIconLoader
  });

  // packages/icon/src/core-constants.ts
  var VIEW = 1024;
  var MOTION_LOOP_SECONDS = 10.24;
  var MOBIUS_A = 2.75;
  var MOBIUS_B = 1.35;
  var MOBIUS_Z = 0.76;
  var MOBIUS_W = 0.46;
  var MOBIUS_U_SEGMENTS = 118;
  var MOBIUS_V_SEGMENTS = 12;
  var MOBIUS_PARAM_PHASE = 0;
  var MOBIUS_UP = [0, 0, 1];

  // packages/icon/src/core-motion.ts
  var makeMotionWave = (random, minAmp, maxAmp, uFreqs, timeFreqs) => ({
    amp: random.signedRandomRange(minAmp, maxAmp),
    phase: random.randomRange(0, Math.PI * 2),
    timeFreq: random.randomChoice(timeFreqs),
    uFreq: random.randomChoice(uFreqs)
  });
  var createMotionCycle = (random) => ({
    shape: {
      depthScale: random.signedRandomRange(0.08, 0.22),
      diagonal: random.signedRandomRange(0.04, 0.12),
      lobeBalance: random.signedRandomRange(0.08, 0.2),
      phaseDrift: random.signedRandomRange(0.03, 0.09),
      waist: random.signedRandomRange(0.08, 0.2),
      xScale: random.signedRandomRange(0.08, 0.18),
      yScale: random.signedRandomRange(0.1, 0.22)
    },
    twist: [
      makeMotionWave(random, 0.1, 0.18, [1, 2, 3], [1, 2]),
      makeMotionWave(random, 0.04, 0.09, [2, 3, 4], [2, 3])
    ],
    warpX: [
      makeMotionWave(random, 0.02, 0.05, [1, 2], [1, 2]),
      makeMotionWave(random, 0.01, 0.025, [3, 4], [2, 3])
    ],
    warpY: [
      makeMotionWave(random, 0.018, 0.04, [1, 2], [1, 2]),
      makeMotionWave(random, 0.01, 0.02, [3, 4], [2, 3])
    ],
    warpZ: [
      makeMotionWave(random, 0.055, 0.12, [1, 2, 3], [1, 2]),
      makeMotionWave(random, 0.025, 0.055, [2, 3, 4], [2, 3])
    ],
    width: [
      makeMotionWave(random, 0.035, 0.06, [2, 3, 4], [1, 2]),
      makeMotionWave(random, 0.015, 0.03, [3, 4, 5], [2, 3])
    ]
  });
  var createMotionStatePhase = (time, motionAmount, motionOffset, loopSeconds = MOTION_LOOP_SECONDS) => {
    const localTime = time + motionOffset;
    const cycleIndex = Math.floor(localTime / loopSeconds);
    const phase = (localTime % loopSeconds + loopSeconds) % loopSeconds / loopSeconds;
    const envelope = Math.sin(Math.PI * phase) ** 2;
    return { cycleIndex, envelope: envelope * motionAmount, phase };
  };

  // packages/icon/src/core-random.ts
  var normalizeSeed = (value) => {
    const seed = String(value ?? "").trim().replace(/[^\w-]/g, "").slice(0, 64);
    return seed || null;
  };
  var createSessionSeed = () => {
    const values = new Uint32Array(2);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(values);
    } else {
      values[0] = Math.floor(Math.random() * 4294967295);
      values[1] = Date.now() >>> 0;
    }
    return normalizeSeed(`${values[0].toString(36)}${values[1].toString(36)}`) ?? "oneworks";
  };
  var hashSeed = (seed) => {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };
  var createSeededRandom = (seed) => {
    let state = hashSeed(seed) || 2654435769;
    return () => {
      state += 1831565813;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  };

  // packages/icon/src/core-surface.ts
  var motionWaveValue = (waves, u, phase) => {
    const t = Math.PI * 2 * phase;
    return waves.reduce((sum, wave) => sum + wave.amp * Math.sin(wave.uFreq * u + wave.timeFreq * t + wave.phase), 0);
  };
  var center = (u, motionState) => {
    const { shape } = motionState.cycle;
    const envelope = motionState.envelope || 0;
    const phase = Math.PI * 2 * (motionState.phase || 0);
    const shiftedU = u + envelope * shape.phaseDrift * Math.sin(phase);
    const sinU = Math.sin(shiftedU);
    const cosU = Math.cos(shiftedU);
    const lobeSide = Math.tanh(1.8 * sinU);
    const waist = 1 - envelope * shape.waist * Math.cos(2 * shiftedU) ** 2;
    const lobeScale = 1 + envelope * shape.lobeBalance * lobeSide;
    const xScale = 1 + envelope * shape.xScale;
    const yScale = 1 + envelope * shape.yScale * Math.sin(phase + 0.8);
    const zScale = 1 + envelope * shape.depthScale * Math.cos(phase + 0.35);
    const diagonal = envelope * shape.diagonal;
    return [
      MOBIUS_A * xScale * lobeScale * waist * sinU + diagonal * Math.sin(3 * shiftedU + phase),
      MOBIUS_B * yScale * Math.sin(2 * shiftedU) * (1 - 0.16 * envelope * lobeSide),
      MOBIUS_Z * zScale * cosU + envelope * 0.08 * Math.sin(3 * shiftedU - phase)
    ];
  };
  var dcenter = (u, motionState) => {
    const epsilon = 1e-3;
    const before = center(u - epsilon, motionState);
    const after = center(u + epsilon, motionState);
    return [
      (after[0] - before[0]) / (2 * epsilon),
      (after[1] - before[1]) / (2 * epsilon),
      (after[2] - before[2]) / (2 * epsilon)
    ];
  };
  var add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  var mul = (a, scale) => [a[0] * scale, a[1] * scale, a[2] * scale];
  var cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  var norm = (vector) => {
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
    return [vector[0] / length, vector[1] / length, vector[2] / length];
  };
  var buildPoints = (motionAmount, motionState) => {
    const rows = [];
    const surfaceRoll = motionAmount ? Math.PI * 2 * motionState.phase * motionAmount : 0;
    for (let i = 0; i < MOBIUS_U_SEGMENTS; i += 1) {
      const u = MOBIUS_PARAM_PHASE + 2 * Math.PI * i / MOBIUS_U_SEGMENTS;
      const c = center(u, motionState);
      const tangent = norm(dcenter(u, motionState));
      let normal = cross(MOBIUS_UP, tangent);
      normal = normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2 < 1e-6 ? [1, 0, 0] : norm(normal);
      const binormal = norm(cross(tangent, normal));
      const twist = motionState.envelope * motionWaveValue(motionState.cycle.twist, u, motionState.phase);
      const widthPulse = 1 + motionState.envelope * motionWaveValue(motionState.cycle.width, u, motionState.phase) + motionState.envelope * motionState.cycle.shape.waist * 0.28 * Math.sin(2 * u + Math.PI * 2 * motionState.phase);
      const phi = u / 2 + Math.PI * 0.1 + twist + surfaceRoll;
      const widthVector = add(mul(normal, Math.cos(phi)), mul(binormal, Math.sin(phi)));
      const centerWarp = [
        motionState.envelope * motionWaveValue(motionState.cycle.warpX, u, motionState.phase),
        motionState.envelope * motionWaveValue(motionState.cycle.warpY, u, motionState.phase),
        motionState.envelope * motionWaveValue(motionState.cycle.warpZ, u, motionState.phase)
      ];
      const animatedCenter = add(c, centerWarp);
      const row = [];
      for (let j = 0; j <= MOBIUS_V_SEGMENTS; j += 1) {
        const v = -MOBIUS_W + 2 * MOBIUS_W * j / MOBIUS_V_SEGMENTS;
        const p = add(animatedCenter, mul(widthVector, v * widthPulse));
        row.push({ u, v, x: p[0], y: p[1], z: p[2] });
      }
      rows.push(row);
    }
    return rows;
  };
  var createProjection = (points) => {
    const flat = points.flat();
    const minX = Math.min(...flat.map((point) => point.x));
    const maxX = Math.max(...flat.map((point) => point.x));
    const minY = Math.min(...flat.map((point) => point.y));
    const maxY = Math.max(...flat.map((point) => point.y));
    const scale = Math.min(820 / (maxX - minX), 610 / (maxY - minY));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    return (point) => ({
      u: point.u,
      v: point.v,
      x: 512 + (point.x - centerX) * scale,
      y: 512 - ((point.y - centerY) * scale + point.z * scale * 0.045),
      z: point.z
    });
  };
  var buildMesh = (motionAmount, motionState, project) => {
    const points = buildPoints(motionAmount, motionState);
    const mesh = [];
    for (let i = 0; i < MOBIUS_U_SEGMENTS; i += 1) {
      const nextI = (i + 1) % MOBIUS_U_SEGMENTS;
      const isClosingBand = nextI === 0;
      for (let j = 0; j < MOBIUS_V_SEGMENTS; j += 1) {
        const quad = buildQuad(points, project, i, j, nextI, isClosingBand);
        if (!quad) continue;
        const depth = quad.reduce((sum, point) => sum + point.z, 0) / 4;
        const u = MOBIUS_PARAM_PHASE + 2 * Math.PI * (i + 0.5) / MOBIUS_U_SEGMENTS;
        const v = -MOBIUS_W + 2 * MOBIUS_W * (j + 0.5) / MOBIUS_V_SEGMENTS;
        mesh.push({
          depth,
          outlinePoints: quad,
          points: expandedQuad(quad, 0.82),
          sortDepth: depth + 0.11 * Math.cos(u),
          u,
          v
        });
      }
    }
    return mesh.sort((a, b) => a.sortDepth - b.sortDepth || a.u - b.u || a.v - b.v);
  };
  var buildQuad = (points, project, i, j, nextI, isClosingBand) => {
    const nextJ = isClosingBand ? MOBIUS_V_SEGMENTS - j : j;
    const nextJ1 = isClosingBand ? MOBIUS_V_SEGMENTS - j - 1 : j + 1;
    const row = points[i];
    const nextRow = points[nextI];
    const currentPoint = row?.[j];
    const nextPoint = nextRow?.[nextJ];
    const nextPoint1 = nextRow?.[nextJ1];
    const currentPoint1 = row?.[j + 1];
    return currentPoint && nextPoint && nextPoint1 && currentPoint1 ? [project(currentPoint), project(nextPoint), project(nextPoint1), project(currentPoint1)] : null;
  };
  var expandedQuad = (quad, amount) => {
    const centerX = quad.reduce((sum, point) => sum + point.x, 0) / quad.length;
    const centerY = quad.reduce((sum, point) => sum + point.y, 0) / quad.length;
    return quad.map((point) => {
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      const length = Math.hypot(dx, dy) || 1;
      return { ...point, x: point.x + amount * dx / length, y: point.y + amount * dy / length };
    });
  };

  // packages/icon/src/core-color.ts
  var themeFill = (theme, mode, depth, u, v, time) => {
    const over = 0.5 + 0.5 * (depth / (MOBIUS_Z + MOBIUS_W));
    const twistLight = 0.5 + 0.5 * Math.cos(u - 0.55);
    const rim = Math.abs(v) / MOBIUS_W;
    const pulse = 0.5 + 0.5 * Math.cos(u + time * 0.68);
    if (theme === "industrial") {
      const emphasis2 = clamp(0.74 * over + 0.14 * twistLight + 0.08 * rim + 0.04 * pulse);
      const palette = mode === "light" ? [[255, 230, 202], [255, 146, 58], [229, 58, 18], [82, 21, 9]] : [[20, 9, 6], [108, 22, 12], [226, 63, 18], [255, 145, 35]];
      if (emphasis2 < 0.44) return rgb(mixColor(palette[0], palette[1], emphasis2 / 0.44));
      if (emphasis2 < 0.78) return rgb(mixColor(palette[1], palette[2], (emphasis2 - 0.44) / 0.34));
      return rgb(mixColor(palette[2], palette[3], (emphasis2 - 0.78) / 0.22));
    }
    if (theme === "matrix") {
      const emphasis2 = clamp(0.76 * over + 0.12 * twistLight + 0.08 * rim + 0.04 * pulse);
      const palette = mode === "light" ? [[212, 255, 226], [38, 226, 112], [0, 146, 70], [0, 72, 40]] : [[2, 18, 10], [0, 86, 44], [0, 214, 96], [168, 255, 198]];
      if (emphasis2 < 0.36) return rgb(mixColor(palette[0], palette[1], emphasis2 / 0.36));
      if (emphasis2 < 0.78) return rgb(mixColor(palette[1], palette[2], (emphasis2 - 0.36) / 0.42));
      return rgb(mixColor(palette[2], palette[3], (emphasis2 - 0.78) / 0.22));
    }
    if (theme === "metal") {
      const edgeReflection = rim ** 1.6;
      const longReflection = 0.5 + 0.5 * Math.cos(u * 2.1 - 0.72);
      const hardHighlight = Math.max(0, Math.cos(u * 3.2 + v * 2.4 - 1.1)) ** 10;
      const hairline = 0.025 * Math.sin(u * 54 + v * 18);
      const emphasis2 = clamp(
        0.62 * over + 0.14 * twistLight + 0.12 * edgeReflection + 0.08 * longReflection + 0.13 * hardHighlight + hairline
      );
      const palette = mode === "light" ? [[34, 39, 42], [79, 88, 90], [159, 165, 162], [250, 248, 236], [72, 78, 79]] : [[8, 10, 11], [42, 47, 49], [139, 148, 147], [248, 247, 238], [82, 89, 91]];
      if (emphasis2 < 0.34) return rgb(mixColor(palette[0], palette[1], emphasis2 / 0.34));
      if (emphasis2 < 0.62) return rgb(mixColor(palette[1], palette[2], (emphasis2 - 0.34) / 0.28));
      if (emphasis2 < 0.82) return rgb(mixColor(palette[2], palette[3], (emphasis2 - 0.62) / 0.2));
      return rgb(mixColor(palette[3], palette[4], (emphasis2 - 0.82) / 0.18));
    }
    if (theme === "linear") {
      return mode === "light" ? "rgb(20,29,36)" : "rgb(226,235,242)";
    }
    const emphasis = clamp(0.82 * over + 0.1 * twistLight + 0.08 * rim);
    const shade = mode === "dark" ? Math.max(18, Math.min(242, Math.round(14 + 226 * emphasis))) : Math.max(18, Math.min(246, Math.round(248 - 226 * emphasis)));
    return `rgb(${shade},${shade},${shade})`;
  };
  var themeSolidBackgroundFill = (theme, mode) => {
    if (theme === "industrial") return mode === "light" ? "#FFF1E8" : "#180804";
    if (theme === "matrix") return mode === "light" ? "#E9FFF1" : "#001B0D";
    if (theme === "metal") return mode === "light" ? "#F2F4F0" : "#111615";
    if (theme === "linear") return mode === "light" ? "#F8FAFC" : "#080A0D";
    return mode === "light" ? "#F3F5F2" : "#111514";
  };
  var themeLinearBorder = (mode) => mode === "light" ? "rgba(248,250,252,0.9)" : "rgba(8,10,13,0.9)";
  var clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  var mixChannel = (start, end, amount) => Math.round(start + (end - start) * clamp(amount));
  var mixColor = (start, end, amount) => [
    mixChannel(start[0], end[0], amount),
    mixChannel(start[1], end[1], amount),
    mixChannel(start[2], end[2], amount)
  ];
  var rgb = (color) => `rgb(${color[0]},${color[1]},${color[2]})`;
  var rgba = (color, alpha) => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;

  // packages/icon/src/core.ts
  var createMobiusCore = (seed = createSessionSeed()) => {
    let currentSeed = normalizeSeed(seed) ?? createSessionSeed();
    let random = createSeededRandom(currentSeed);
    let randomTools = createRandomTools(random);
    let baseMotionCycle = createMotionCycle(randomTools);
    const resetSeed = (nextSeed = createSessionSeed()) => {
      currentSeed = normalizeSeed(nextSeed) ?? createSessionSeed();
      random = createSeededRandom(currentSeed);
      randomTools = createRandomTools(random);
      baseMotionCycle = createMotionCycle(randomTools);
      return currentSeed;
    };
    const getMotionState = (time, motionAmount, source) => {
      const cycle = source?.motionCycle ?? baseMotionCycle;
      if (motionAmount === 0) {
        return { cycle, envelope: 0, phase: 0 };
      }
      const phaseState = createMotionStatePhase(time, motionAmount, source?.motionOffset ?? 0, source?.motionLoopSeconds);
      if (source && source.motionCycleIndex < 0) {
        source.motionCycleIndex = phaseState.cycleIndex;
      }
      return { cycle, envelope: phaseState.envelope, phase: phaseState.phase };
    };
    const createCoreMotionCycle = () => createMotionCycle(randomTools);
    const staticMotionState = { cycle: baseMotionCycle, envelope: 0, phase: 0 };
    const project = createProjection(buildPoints(0, staticMotionState));
    const buildMesh2 = (time, motionAmount, motionState = getMotionState(time, motionAmount)) => buildMesh(motionAmount, motionState, project);
    const createMotionSource = () => ({
      motionCycle: createCoreMotionCycle(),
      motionCycleIndex: -1,
      motionLoopSeconds: MOTION_LOOP_SECONDS,
      motionOffset: randomTools.randomRange(0, MOTION_LOOP_SECONDS)
    });
    const resetMotionSource = (source) => {
      source.motionCycleIndex = -1;
      source.motionCycle = createCoreMotionCycle();
      source.motionOffset = randomTools.randomRange(0, MOTION_LOOP_SECONDS);
      source.motionLoopSeconds = MOTION_LOOP_SECONDS;
    };
    return {
      get seed() {
        return currentSeed;
      },
      buildMesh: buildMesh2,
      createMotionCycle: createCoreMotionCycle,
      createMotionSource,
      getMotionState,
      random: () => random(),
      randomRange: (min, max) => randomTools.randomRange(min, max),
      resetMotionSource,
      resetSeed,
      staticMesh: buildMesh2(0, 0)
    };
  };
  var createRandomTools = (random) => {
    const randomRange = (min, max) => min + random() * (max - min);
    const randomChoice = (values) => values[Math.floor(random() * values.length)] ?? values[0] ?? 0;
    const signedRandomRange = (min, max) => randomRange(min, max) * (random() < 0.5 ? -1 : 1);
    return { random, randomChoice, randomRange, signedRandomRange };
  };

  // packages/icon/src/canvas-atmosphere.ts
  var resetRain = (core, renderer) => {
    const fontSize = renderer.width < 210 ? 11 : 13;
    const count = Math.ceil(renderer.width / fontSize) + 1;
    renderer.rainFontSize = fontSize;
    renderer.rainColumns = Array.from({ length: count }, (_, index) => ({
      seed: core.randomRange(0, renderer.height + fontSize * 18),
      speed: core.randomRange(22, 58),
      length: Math.round(core.randomRange(7, 15)),
      alpha: core.randomRange(0.2, 0.72),
      x: index * fontSize + fontSize / 2
    }));
  };
  var resetHeatmap = (core, renderer) => {
    const cellSize = renderer.width < 170 ? 12 : 15;
    const cols = Math.ceil(renderer.width / cellSize);
    const rows = Math.ceil(renderer.height / cellSize);
    renderer.heatCellSize = cellSize;
    renderer.heatCols = cols;
    renderer.heatRows = rows;
    renderer.nextHeatUpdate = 0;
    renderer.heatCells = Array.from({ length: cols * rows }, (_, index) => createHeatCell(core, cols, rows, index));
  };
  var drawAtmosphere = (core, renderer, time) => {
    if (renderer.backgroundStyle !== "textured") return;
    if (renderer.theme === "matrix") {
      drawMatrixRain(renderer, time);
      return;
    }
    if (renderer.theme === "industrial") drawIndustrialHeatmap(core, renderer, time);
  };
  var createHeatCell = (core, cols, rows, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = (col + 0.5) / cols;
    const y = (row + 0.5) / rows;
    const value = clamp(heatSeedValue(x, y) + core.randomRange(-0.18, 0.18));
    return { speed: core.randomRange(0.035, 0.085), target: value, value };
  };
  var heatSeedValue = (x, y) => {
    const leftHot = Math.exp(-((x - 0.34) ** 2 / 0.035 + (y - 0.52) ** 2 / 0.055));
    const rightHot = Math.exp(-((x - 0.66) ** 2 / 0.032 + (y - 0.42) ** 2 / 0.05));
    const lowerWarm = Math.exp(-((x - 0.54) ** 2 / 0.06 + (y - 0.68) ** 2 / 0.04));
    const diagonal = Math.max(0, 1 - Math.abs(y - (0.82 - x * 0.62)) * 3.8);
    return clamp(0.08 + leftHot * 0.46 + rightHot * 0.42 + lowerWarm * 0.22 + diagonal * 0.16);
  };
  var drawMatrixRain = (renderer, time) => {
    const { ctx, height, mode, rainColumns, rainFontSize, width } = renderer;
    const isLight = mode === "light";
    const glow = ctx.createRadialGradient(width * 0.54, height * 0.47, 0, width * 0.54, height * 0.47, width * 0.52);
    glow.addColorStop(0, isLight ? "rgba(0,180,84,0.09)" : "rgba(0,255,118,0.12)");
    glow.addColorStop(0.55, isLight ? "rgba(0,180,84,0.035)" : "rgba(0,255,118,0.045)");
    glow.addColorStop(1, "rgba(0,255,118,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.font = `${rainFontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const column of rainColumns) {
      drawRainColumn(renderer, column.x, column.length, column.seed, column.speed, column.alpha, time);
    }
    ctx.restore();
  };
  var drawRainColumn = (renderer, x, length, seed, speed, alphaSeed, time) => {
    const { ctx, height, mode, rainFontSize } = renderer;
    const loopHeight = height + length * rainFontSize;
    const head = (time * 1e-3 * speed + seed) % loopHeight - length * rainFontSize;
    for (let i = 0; i < length; i += 1) {
      const y = head - i * rainFontSize;
      if (y < -rainFontSize || y > height + rainFontSize) continue;
      const fade = 1 - i / length;
      const glyphSeed = Math.sin(x * 12.9898 + i * 78.233 + Math.floor(time * 6e-3) * 18.97);
      const color = mode === "light" ? i === 0 ? [0, 116, 58] : [0, 148, 72] : i === 0 ? [215, 255, 226] : [116, 255, 168];
      const alpha = alphaSeed * fade * (i === 0 ? 0.74 : 0.42) * (mode === "light" ? 0.52 : 1);
      ctx.fillStyle = rgba(color, alpha);
      ctx.fillText(glyphSeed > 0 ? "1" : "0", x, y);
    }
  };
  var drawIndustrialHeatmap = (core, renderer, time) => {
    if (renderer.heatCells.length === 0) return;
    updateHeatmap(core, renderer, time);
    const { ctx, heatCellSize, heatCols, heatRows, mode } = renderer;
    const gap = Math.max(1, Math.round(heatCellSize * 0.14));
    const size = heatCellSize - gap;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    for (let row = 0; row < heatRows; row += 1) {
      for (let col = 0; col < heatCols; col += 1) {
        const cell = renderer.heatCells[row * heatCols + col];
        if (!cell) continue;
        if (!renderer.isStatic) cell.value += (cell.target - cell.value) * cell.speed;
        const value = clamp(cell.value);
        ctx.fillStyle = rgba(heatColor(mode, value), mode === "light" ? 0.22 + value * 0.48 : 0.18 + value * 0.64);
        ctx.fillRect(col * heatCellSize + gap / 2, row * heatCellSize + gap / 2, size, size);
      }
    }
    ctx.restore();
  };
  var updateHeatmap = (core, renderer, time) => {
    if (renderer.isStatic || time < renderer.nextHeatUpdate) return;
    renderer.nextHeatUpdate = time + core.randomRange(90, 170);
    for (const cell of renderer.heatCells) {
      if (core.random() >= 0.28) continue;
      cell.target = clamp(cell.target + core.randomRange(-0.42, 0.42));
      cell.speed = core.randomRange(0.045, 0.12);
    }
  };
  var heatColor = (mode, value) => {
    const cool = mode === "light" ? [255, 239, 221] : [31, 12, 7];
    const warm = mode === "light" ? [255, 156, 55] : [124, 24, 12];
    const hot = mode === "light" ? [223, 54, 16] : [255, 98, 24];
    const peak = mode === "light" ? [96, 24, 10] : [255, 178, 56];
    if (value < 0.42) return mixColor(cool, warm, value / 0.42);
    if (value < 0.76) return mixColor(warm, hot, (value - 0.42) / 0.34);
    return mixColor(hot, peak, (value - 0.76) / 0.24);
  };

  // ../../../../../../private/tmp/oneworks-brand-bundle-87485/node_modules/@paper-design/shaders/dist/vertex-shader.js
  var vertexShaderSource = `#version 300 es
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
}`;

  // ../../../../../../private/tmp/oneworks-brand-bundle-87485/node_modules/@paper-design/shaders/dist/shader-mount.js
  var DEFAULT_MAX_PIXEL_COUNT = 1920 * 1080 * 4;
  var ShaderMount = class {
    parentElement;
    canvasElement;
    gl;
    program = null;
    uniformLocations = {};
    /** The fragment shader that we are using */
    fragmentShader;
    /** Stores the RAF for the render loop */
    rafId = null;
    /** Time of the last rendered frame */
    lastRenderTime = 0;
    /** Total time that we have played any animation, passed as a uniform to the shader for time-based VFX */
    currentFrame = 0;
    /** The speed that we progress through animation time (multiplies by delta time every update). Allows negatives to play in reverse. If set to 0, rAF will stop entirely so static shaders have no recurring performance costs */
    speed = 0;
    /** Actual speed used that accounts for document visibility (we pause the shader if the tab is hidden) */
    currentSpeed = 0;
    /** Uniforms that are provided by the user for the specific shader being mounted (not including uniforms that this Mount adds, like time and resolution) */
    providedUniforms;
    /** Names of the uniforms that should have mipmaps generated for them */
    mipmaps = [];
    /** Just a sanity check to make sure frames don't run after we're disposed */
    hasBeenDisposed = false;
    /** If the resolution of the canvas has changed since the last render */
    resolutionChanged = true;
    /** Store textures that are provided by the user */
    textures = /* @__PURE__ */ new Map();
    minPixelRatio;
    maxPixelCount;
    isSafari = isSafari();
    uniformCache = {};
    textureUnitMap = /* @__PURE__ */ new Map();
    ownerDocument;
    constructor(parentElement, fragmentShader, uniforms, webGlContextAttributes, speed = 0, frame = 0, minPixelRatio = 2, maxPixelCount = DEFAULT_MAX_PIXEL_COUNT, mipmaps = []) {
      if (parentElement?.nodeType === 1) {
        this.parentElement = parentElement;
      } else {
        throw new Error("Paper Shaders: parent element must be an HTMLElement");
      }
      this.ownerDocument = parentElement.ownerDocument;
      if (!this.ownerDocument.querySelector("style[data-paper-shader]")) {
        const styleElement = this.ownerDocument.createElement("style");
        styleElement.innerHTML = defaultStyle;
        styleElement.setAttribute("data-paper-shader", "");
        this.ownerDocument.head.prepend(styleElement);
      }
      const canvasElement = this.ownerDocument.createElement("canvas");
      this.canvasElement = canvasElement;
      this.parentElement.prepend(canvasElement);
      this.fragmentShader = fragmentShader;
      this.providedUniforms = uniforms;
      this.mipmaps = mipmaps;
      this.currentFrame = frame;
      this.minPixelRatio = minPixelRatio;
      this.maxPixelCount = maxPixelCount;
      const gl = canvasElement.getContext("webgl2", webGlContextAttributes);
      if (!gl) {
        throw new Error("Paper Shaders: WebGL is not supported in this browser");
      }
      this.gl = gl;
      this.initProgram();
      this.setupPositionAttribute();
      this.setupUniforms();
      this.setUniformValues(this.providedUniforms);
      this.setupResizeObserver();
      visualViewport?.addEventListener("resize", this.handleVisualViewportChange);
      this.setSpeed(speed);
      this.parentElement.setAttribute("data-paper-shader", "");
      this.parentElement.paperShaderMount = this;
      this.ownerDocument.addEventListener("visibilitychange", this.handleDocumentVisibilityChange);
    }
    initProgram = () => {
      const program = createProgram(this.gl, vertexShaderSource, this.fragmentShader);
      if (!program) return;
      this.program = program;
    };
    setupPositionAttribute = () => {
      const positionAttributeLocation = this.gl.getAttribLocation(this.program, "a_position");
      const positionBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
      const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
      this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(positions), this.gl.STATIC_DRAW);
      this.gl.enableVertexAttribArray(positionAttributeLocation);
      this.gl.vertexAttribPointer(positionAttributeLocation, 2, this.gl.FLOAT, false, 0, 0);
    };
    setupUniforms = () => {
      const uniformLocations = {
        u_time: this.gl.getUniformLocation(this.program, "u_time"),
        u_pixelRatio: this.gl.getUniformLocation(this.program, "u_pixelRatio"),
        u_resolution: this.gl.getUniformLocation(this.program, "u_resolution")
      };
      Object.entries(this.providedUniforms).forEach(([key, value]) => {
        uniformLocations[key] = this.gl.getUniformLocation(this.program, key);
        if (value instanceof HTMLImageElement) {
          const aspectRatioUniformName = `${key}AspectRatio`;
          uniformLocations[aspectRatioUniformName] = this.gl.getUniformLocation(this.program, aspectRatioUniformName);
        }
      });
      this.uniformLocations = uniformLocations;
    };
    /**
     * The scale that we should render at.
     * - Used to target 2x rendering even on 1x screens for better antialiasing
     * - Prevents the virtual resolution from going beyond the maximum resolution
     * - Accounts for the page zoom level so we render in physical device pixels rather than CSS pixels
     */
    renderScale = 1;
    parentWidth = 0;
    parentHeight = 0;
    parentDevicePixelWidth = 0;
    parentDevicePixelHeight = 0;
    devicePixelsSupported = false;
    resizeObserver = null;
    setupResizeObserver = () => {
      this.resizeObserver = new ResizeObserver(([entry]) => {
        if (entry?.borderBoxSize[0]) {
          const physicalPixelSize = entry.devicePixelContentBoxSize?.[0];
          if (physicalPixelSize !== void 0) {
            this.devicePixelsSupported = true;
            this.parentDevicePixelWidth = physicalPixelSize.inlineSize;
            this.parentDevicePixelHeight = physicalPixelSize.blockSize;
          }
          this.parentWidth = entry.borderBoxSize[0].inlineSize;
          this.parentHeight = entry.borderBoxSize[0].blockSize;
        }
        this.handleResize();
      });
      this.resizeObserver.observe(this.parentElement);
    };
    // Visual viewport resize handler, mainly used to react to browser zoom changes.
    // Resize observer by itself does not react to pinch zoom, and although it usually
    // reacts to classic browser zoom, it's not guaranteed in edge cases.
    // Since timing between visual viewport changes and resize observer is complex
    // and because we'd like to know the device pixel sizes of elements, we just restart
    // the observer to get a guaranteed fresh callback regardless if it would have triggered or not.
    handleVisualViewportChange = () => {
      this.resizeObserver?.disconnect();
      this.setupResizeObserver();
    };
    /** Resize handler for when the container div changes size or the max pixel count changes and we want to resize our canvas to match */
    handleResize = () => {
      let targetPixelWidth = 0;
      let targetPixelHeight = 0;
      const dpr = Math.max(1, window.devicePixelRatio);
      const pinchZoom = visualViewport?.scale ?? 1;
      if (this.devicePixelsSupported) {
        const scaleToMeetMinPixelRatio = Math.max(1, this.minPixelRatio / dpr);
        targetPixelWidth = this.parentDevicePixelWidth * scaleToMeetMinPixelRatio * pinchZoom;
        targetPixelHeight = this.parentDevicePixelHeight * scaleToMeetMinPixelRatio * pinchZoom;
      } else {
        let targetRenderScale = Math.max(dpr, this.minPixelRatio) * pinchZoom;
        if (this.isSafari) {
          const zoomLevel = bestGuessBrowserZoom(this.ownerDocument);
          targetRenderScale *= Math.max(1, zoomLevel);
        }
        targetPixelWidth = Math.round(this.parentWidth) * targetRenderScale;
        targetPixelHeight = Math.round(this.parentHeight) * targetRenderScale;
      }
      const maxPixelCountHeadroom = Math.sqrt(this.maxPixelCount) / Math.sqrt(targetPixelWidth * targetPixelHeight);
      const scaleToMeetMaxPixelCount = Math.min(1, maxPixelCountHeadroom);
      const newWidth = Math.round(targetPixelWidth * scaleToMeetMaxPixelCount);
      const newHeight = Math.round(targetPixelHeight * scaleToMeetMaxPixelCount);
      const newRenderScale = newWidth / Math.round(this.parentWidth);
      if (this.canvasElement.width !== newWidth || this.canvasElement.height !== newHeight || this.renderScale !== newRenderScale) {
        this.renderScale = newRenderScale;
        this.canvasElement.width = newWidth;
        this.canvasElement.height = newHeight;
        this.resolutionChanged = true;
        this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
        this.render(performance.now());
      }
    };
    render = (currentTime) => {
      if (this.hasBeenDisposed) return;
      if (this.program === null) {
        console.warn("Tried to render before program or gl was initialized");
        return;
      }
      const dt = currentTime - this.lastRenderTime;
      this.lastRenderTime = currentTime;
      if (this.currentSpeed !== 0) {
        this.currentFrame += dt * this.currentSpeed;
      }
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      this.gl.useProgram(this.program);
      this.gl.uniform1f(this.uniformLocations.u_time, this.currentFrame * 1e-3);
      if (this.resolutionChanged) {
        this.gl.uniform2f(this.uniformLocations.u_resolution, this.gl.canvas.width, this.gl.canvas.height);
        this.gl.uniform1f(this.uniformLocations.u_pixelRatio, this.renderScale);
        this.resolutionChanged = false;
      }
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
      if (this.currentSpeed !== 0) {
        this.requestRender();
      } else {
        this.rafId = null;
      }
    };
    requestRender = () => {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
      }
      this.rafId = requestAnimationFrame(this.render);
    };
    /** Creates a texture from an image and sets it into a uniform value */
    setTextureUniform = (uniformName, image) => {
      if (!image.complete || image.naturalWidth === 0) {
        throw new Error(`Paper Shaders: image for uniform ${uniformName} must be fully loaded`);
      }
      const existingTexture = this.textures.get(uniformName);
      if (existingTexture) {
        this.gl.deleteTexture(existingTexture);
      }
      if (!this.textureUnitMap.has(uniformName)) {
        this.textureUnitMap.set(uniformName, this.textureUnitMap.size);
      }
      const textureUnit = this.textureUnitMap.get(uniformName);
      this.gl.activeTexture(this.gl.TEXTURE0 + textureUnit);
      const texture = this.gl.createTexture();
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image);
      if (this.mipmaps.includes(uniformName)) {
        this.gl.generateMipmap(this.gl.TEXTURE_2D);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_LINEAR);
      }
      const error = this.gl.getError();
      if (error !== this.gl.NO_ERROR || texture === null) {
        console.error("Paper Shaders: WebGL error when uploading texture:", error);
        return;
      }
      this.textures.set(uniformName, texture);
      const location = this.uniformLocations[uniformName];
      if (location) {
        this.gl.uniform1i(location, textureUnit);
        const aspectRatioUniformName = `${uniformName}AspectRatio`;
        const aspectRatioLocation = this.uniformLocations[aspectRatioUniformName];
        if (aspectRatioLocation) {
          const aspectRatio = image.naturalWidth / image.naturalHeight;
          this.gl.uniform1f(aspectRatioLocation, aspectRatio);
        }
      }
    };
    /** Utility: recursive equality test for all the uniforms */
    areUniformValuesEqual = (a, b) => {
      if (a === b) return true;
      if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
        return a.every((val, i) => this.areUniformValuesEqual(val, b[i]));
      }
      return false;
    };
    /** Sets the provided uniform values into the WebGL program, can be a partial list of uniforms that have changed */
    setUniformValues = (updatedUniforms) => {
      this.gl.useProgram(this.program);
      Object.entries(updatedUniforms).forEach(([key, value]) => {
        let cacheValue = value;
        if (value instanceof HTMLImageElement) {
          cacheValue = `${value.src.slice(0, 200)}|${value.naturalWidth}x${value.naturalHeight}`;
        }
        if (this.areUniformValuesEqual(this.uniformCache[key], cacheValue)) return;
        this.uniformCache[key] = cacheValue;
        const location = this.uniformLocations[key];
        if (!location) {
          console.warn(`Uniform location for ${key} not found`);
          return;
        }
        if (value instanceof HTMLImageElement) {
          this.setTextureUniform(key, value);
        } else if (Array.isArray(value)) {
          let flatArray = null;
          let valueLength = null;
          if (value[0] !== void 0 && Array.isArray(value[0])) {
            const firstChildLength = value[0].length;
            if (value.every((arr) => arr.length === firstChildLength)) {
              flatArray = value.flat();
              valueLength = firstChildLength;
            } else {
              console.warn(`All child arrays must be the same length for ${key}`);
              return;
            }
          } else {
            flatArray = value;
            valueLength = flatArray.length;
          }
          switch (valueLength) {
            case 2:
              this.gl.uniform2fv(location, flatArray);
              break;
            case 3:
              this.gl.uniform3fv(location, flatArray);
              break;
            case 4:
              this.gl.uniform4fv(location, flatArray);
              break;
            case 9:
              this.gl.uniformMatrix3fv(location, false, flatArray);
              break;
            case 16:
              this.gl.uniformMatrix4fv(location, false, flatArray);
              break;
            default:
              console.warn(`Unsupported uniform array length: ${valueLength}`);
          }
        } else if (typeof value === "number") {
          this.gl.uniform1f(location, value);
        } else if (typeof value === "boolean") {
          this.gl.uniform1i(location, value ? 1 : 0);
        } else {
          console.warn(`Unsupported uniform type for ${key}: ${typeof value}`);
        }
      });
    };
    /** Gets the current total animation time from 0ms */
    getCurrentFrame = () => {
      return this.currentFrame;
    };
    /** Set a frame to get a deterministic result, frames are literally just milliseconds from zero since the animation started */
    setFrame = (newFrame) => {
      this.currentFrame = newFrame;
      this.lastRenderTime = performance.now();
      this.render(performance.now());
    };
    /** Set an animation speed (or 0 to stop animation) */
    setSpeed = (newSpeed = 1) => {
      this.speed = newSpeed;
      this.setCurrentSpeed(this.ownerDocument.hidden ? 0 : newSpeed);
    };
    setCurrentSpeed = (newSpeed) => {
      this.currentSpeed = newSpeed;
      if (this.rafId === null && newSpeed !== 0) {
        this.lastRenderTime = performance.now();
        this.rafId = requestAnimationFrame(this.render);
      }
      if (this.rafId !== null && newSpeed === 0) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    };
    /** Set the maximum pixel count for the shader, this will limit the number of pixels that will be rendered */
    setMaxPixelCount = (newMaxPixelCount = DEFAULT_MAX_PIXEL_COUNT) => {
      this.maxPixelCount = newMaxPixelCount;
      this.handleResize();
    };
    /** Set the minimum pixel ratio for the shader */
    setMinPixelRatio = (newMinPixelRatio = 2) => {
      this.minPixelRatio = newMinPixelRatio;
      this.handleResize();
    };
    /** Update the uniforms that are provided by the outside shader, can be a partial set with only the uniforms that have changed */
    setUniforms = (newUniforms) => {
      this.setUniformValues(newUniforms);
      this.providedUniforms = { ...this.providedUniforms, ...newUniforms };
      this.render(performance.now());
    };
    handleDocumentVisibilityChange = () => {
      this.setCurrentSpeed(this.ownerDocument.hidden ? 0 : this.speed);
    };
    /** Dispose of the shader mount, cleaning up all of the WebGL resources */
    dispose = () => {
      this.hasBeenDisposed = true;
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this.gl && this.program) {
        this.textures.forEach((texture) => {
          this.gl.deleteTexture(texture);
        });
        this.textures.clear();
        this.gl.deleteProgram(this.program);
        this.program = null;
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);
        this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, null);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.getError();
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      visualViewport?.removeEventListener("resize", this.handleVisualViewportChange);
      this.ownerDocument.removeEventListener("visibilitychange", this.handleDocumentVisibilityChange);
      this.uniformLocations = {};
      this.canvasElement.remove();
      delete this.parentElement.paperShaderMount;
    };
  };
  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("An error occurred compiling the shaders: " + gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
  function createProgram(gl, vertexShaderSource2, fragmentShaderSource) {
    const format = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT);
    const precision = format ? format.precision : null;
    if (precision && precision < 23) {
      vertexShaderSource2 = vertexShaderSource2.replace(/precision\s+(lowp|mediump)\s+float;/g, "precision highp float;");
      fragmentShaderSource = fragmentShaderSource.replace(/precision\s+(lowp|mediump)\s+float/g, "precision highp float").replace(/\b(uniform|varying|attribute)\s+(lowp|mediump)\s+(\w+)/g, "$1 highp $3");
    }
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource2);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Unable to initialize the shader program: " + gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return null;
    }
    gl.detachShader(program, vertexShader);
    gl.detachShader(program, fragmentShader);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return program;
  }
  var defaultStyle = `@layer paper-shaders {
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
}`;
  function isSafari() {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes("safari") && !ua.includes("chrome") && !ua.includes("android");
  }
  function bestGuessBrowserZoom(doc) {
    const viewportScale = visualViewport?.scale ?? 1;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const scrollbarWidth = window.innerWidth - doc.documentElement.clientWidth;
    const innerWidth = viewportScale * viewportWidth + scrollbarWidth;
    const ratio = outerWidth / innerWidth;
    const zoomPercentageRounded = Math.round(100 * ratio);
    if (zoomPercentageRounded % 5 === 0) {
      return zoomPercentageRounded / 100;
    }
    if (zoomPercentageRounded === 33) {
      return 1 / 3;
    }
    if (zoomPercentageRounded === 67) {
      return 2 / 3;
    }
    if (zoomPercentageRounded === 133) {
      return 4 / 3;
    }
    return ratio;
  }

  // ../../../../../../private/tmp/oneworks-brand-bundle-87485/node_modules/@paper-design/shaders/dist/shader-sizing.js
  var ShaderFitOptions = {
    none: 0,
    contain: 1,
    cover: 2
  };

  // ../../../../../../private/tmp/oneworks-brand-bundle-87485/node_modules/@paper-design/shaders/dist/shader-utils.js
  var declarePI = `
#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846
`;
  var rotation2 = `
vec2 rotate(vec2 uv, float th) {
  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}
`;
  var colorBandingFix = `
  color += 1. / 256. * (fract(sin(dot(.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123) - .5);
`;
  var simplexNoise = `
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
`;

  // ../../../../../../private/tmp/oneworks-brand-bundle-87485/node_modules/@paper-design/shaders/dist/shaders/liquid-metal.js
  var liquidMetalFragmentShader = `#version 300 es
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

${declarePI}
${rotation2}
${simplexNoise}

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

  ${colorBandingFix}

  fragColor = vec4(color, opacity);
}
`;
  var LiquidMetalShapes = {
    none: 0,
    circle: 1,
    daisy: 2,
    diamond: 3,
    metaballs: 4
  };

  // ../../../../../../private/tmp/oneworks-brand-bundle-87485/node_modules/@paper-design/shaders/dist/get-shader-color-from-string.js
  function getShaderColorFromString(colorString) {
    if (Array.isArray(colorString)) {
      if (colorString.length === 4) return colorString;
      if (colorString.length === 3) return [...colorString, 1];
      return fallbackColor;
    }
    if (typeof colorString !== "string") {
      return fallbackColor;
    }
    let r, g, b, a = 1;
    if (colorString.startsWith("#")) {
      [r, g, b, a] = hexToRgba(colorString);
    } else if (colorString.startsWith("rgb")) {
      [r, g, b, a] = parseRgba(colorString);
    } else if (colorString.startsWith("hsl")) {
      [r, g, b, a] = hslaToRgba(parseHsla(colorString));
    } else {
      console.error("Unsupported color format", colorString);
      return fallbackColor;
    }
    return [clamp2(r, 0, 1), clamp2(g, 0, 1), clamp2(b, 0, 1), clamp2(a, 0, 1)];
  }
  function hexToRgba(hex) {
    hex = hex.replace(/^#/, "");
    if (hex.length === 3) {
      hex = hex.split("").map((char) => char + char).join("");
    }
    if (hex.length === 6) {
      hex = hex + "ff";
    }
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const a = parseInt(hex.slice(6, 8), 16) / 255;
    return [r, g, b, a];
  }
  function parseRgba(rgba2) {
    const match = rgba2.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)$/i);
    if (!match) return [0, 0, 0, 1];
    return [
      parseInt(match[1] ?? "0") / 255,
      parseInt(match[2] ?? "0") / 255,
      parseInt(match[3] ?? "0") / 255,
      match[4] === void 0 ? 1 : parseFloat(match[4])
    ];
  }
  function parseHsla(hsla) {
    const match = hsla.match(/^hsla?\s*\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*(?:,\s*([0-9.]+))?\s*\)$/i);
    if (!match) return [0, 0, 0, 1];
    return [
      parseInt(match[1] ?? "0"),
      parseInt(match[2] ?? "0"),
      parseInt(match[3] ?? "0"),
      match[4] === void 0 ? 1 : parseFloat(match[4])
    ];
  }
  function hslaToRgba(hsla) {
    const [h, s, l, a] = hsla;
    const hDecimal = h / 360;
    const sDecimal = s / 100;
    const lDecimal = l / 100;
    let r, g, b;
    if (s === 0) {
      r = g = b = lDecimal;
    } else {
      const hue2rgb = (p2, q2, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p2 + (q2 - p2) * 6 * t;
        if (t < 1 / 2) return q2;
        if (t < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - t) * 6;
        return p2;
      };
      const q = lDecimal < 0.5 ? lDecimal * (1 + sDecimal) : lDecimal + sDecimal - lDecimal * sDecimal;
      const p = 2 * lDecimal - q;
      r = hue2rgb(p, q, hDecimal + 1 / 3);
      g = hue2rgb(p, q, hDecimal);
      b = hue2rgb(p, q, hDecimal - 1 / 3);
    }
    return [r, g, b, a];
  }
  var clamp2 = (n, min, max) => Math.min(Math.max(n, min), max);
  var fallbackColor = [0, 0, 0, 1];

  // packages/icon/src/canvas-paper-metal-draw.ts
  var drawPaperMetalImage = (renderer, shader, bleed, width, height) => {
    const renderScale = shader.mount.canvasElement.width / shader.width;
    renderer.ctx.drawImage(
      shader.mount.canvasElement,
      bleed * renderScale,
      bleed * renderScale,
      width * renderScale,
      height * renderScale,
      0,
      0,
      width,
      height
    );
  };

  // packages/icon/src/canvas-paper-metal.ts
  var MAX_PIXEL_COUNT = 2048 * 2048;
  var SPEED = 0.24;
  var FULLSCREEN_BLEED = 320;
  var COMMON_UNIFORMS = {
    u_angle: 138,
    u_colorTint: getShaderColorFromString("#ffffff"),
    u_contour: 0.68,
    u_distortion: 1,
    u_fit: ShaderFitOptions.contain,
    u_imageAspectRatio: 1,
    u_isImage: false,
    u_offsetX: 0,
    u_offsetY: 0,
    u_originX: 0.5,
    u_originY: 0.5,
    u_repetition: 2.36,
    u_rotation: 45,
    u_scale: 1.42,
    u_shape: LiquidMetalShapes.diamond,
    u_shiftBlue: 0.3,
    u_shiftRed: 0,
    u_softness: 1,
    u_worldHeight: 0,
    u_worldWidth: 0
  };
  var paperMetalHost = null;
  var drawPaperMetalBackground = (renderer, time) => {
    const shader = ensurePaperMetalShader(renderer);
    if (!shader) return false;
    syncPaperMetalSize(renderer);
    syncPaperMetalUniforms(renderer, shader);
    const frame = renderer.isStatic ? 0 : (time + (renderer.motionOffset || 0) * 1e3) * SPEED;
    shader.mount.setFrame(frame);
    if (renderer.isFullscreen) {
      drawFullscreenShader(renderer, shader);
      return true;
    }
    renderer.ctx.drawImage(shader.mount.canvasElement, 0, 0, renderer.width, renderer.height);
    return true;
  };
  var metalColorBack = (mode) => getShaderColorFromString(mode === "light" ? "#868986" : "#101112");
  var metalColorTint = (mode) => getShaderColorFromString(mode === "light" ? "#d4d2c5" : "#d8d7ca");
  var createPaperMetalHost = () => {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, {
      height: "1px",
      left: "-10000px",
      opacity: "0",
      overflow: "hidden",
      pointerEvents: "none",
      position: "fixed",
      top: "0",
      width: "1px"
    });
    document.body.appendChild(host);
    return host;
  };
  var ensurePaperMetalHost = () => {
    if (!document.body) return null;
    paperMetalHost ??= createPaperMetalHost();
    return paperMetalHost;
  };
  var createPaperMetalUniforms = (renderer) => {
    const isFullscreen = Boolean(renderer.isFullscreen);
    return {
      ...COMMON_UNIFORMS,
      u_colorBack: metalColorBack(renderer.mode),
      u_colorTint: metalColorTint(renderer.mode),
      u_fit: isFullscreen ? ShaderFitOptions.cover : ShaderFitOptions.contain,
      u_rotation: isFullscreen ? 0 : COMMON_UNIFORMS.u_rotation,
      u_scale: isFullscreen ? 1 : COMMON_UNIFORMS.u_scale,
      u_shape: isFullscreen ? LiquidMetalShapes.none : LiquidMetalShapes.diamond
    };
  };
  var paperMetalRenderSize = (renderer) => {
    const width = Math.max(1, Math.round(renderer.width));
    const height = Math.max(1, Math.round(renderer.height));
    const bleed = renderer.isFullscreen ? FULLSCREEN_BLEED : 0;
    return { bleed, height, renderHeight: height + bleed * 2, renderWidth: width + bleed * 2, width };
  };
  var syncPaperMetalSize = (renderer) => {
    const shader = renderer.paperMetalShader;
    if (!shader) return;
    const { renderWidth, renderHeight } = paperMetalRenderSize(renderer);
    const pixelCount = Math.min(MAX_PIXEL_COUNT, Math.max(1, Math.round(renderWidth * renderHeight * renderer.dpr ** 2)));
    if (shader.width === renderWidth && shader.height === renderHeight && shader.dpr === renderer.dpr && shader.pixelCount === pixelCount) {
      return;
    }
    shader.width = renderWidth;
    shader.height = renderHeight;
    shader.dpr = renderer.dpr;
    shader.pixelCount = pixelCount;
    shader.host.style.width = `${renderWidth}px`;
    shader.host.style.height = `${renderHeight}px`;
    shader.mount.setMinPixelRatio(Math.max(1, renderer.dpr));
    shader.mount.setMaxPixelCount(pixelCount);
    shader.mount.parentWidth = renderWidth;
    shader.mount.parentHeight = renderHeight;
    shader.mount.devicePixelsSupported = false;
    shader.mount.handleResize();
  };
  var ensurePaperMetalShader = (renderer) => {
    if (renderer.paperMetalFailed) return null;
    if (renderer.paperMetalShader) return renderer.paperMetalShader;
    const host = ensurePaperMetalHost();
    if (!host) return null;
    const shaderHost = document.createElement("div");
    shaderHost.style.width = "1px";
    shaderHost.style.height = "1px";
    shaderHost.style.borderRadius = "inherit";
    host.appendChild(shaderHost);
    try {
      const mount = new ShaderMount(
        shaderHost,
        liquidMetalFragmentShader,
        createPaperMetalUniforms(renderer),
        {
          alpha: true,
          antialias: true,
          depth: false,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
          stencil: false
        },
        0,
        0,
        Math.max(1, renderer.dpr),
        MAX_PIXEL_COUNT
      );
      renderer.paperMetalShader = {
        dpr: 0,
        fullscreen: Boolean(renderer.isFullscreen),
        height: 0,
        host: shaderHost,
        mode: renderer.mode,
        mount,
        pixelCount: 0,
        width: 0
      };
    } catch (error) {
      shaderHost.remove();
      renderer.paperMetalFailed = true;
      console.warn("Paper Liquid Metal shader unavailable; using canvas fallback.", error);
      return null;
    }
    return renderer.paperMetalShader;
  };
  var syncPaperMetalUniforms = (renderer, shader) => {
    const isFullscreen = Boolean(renderer.isFullscreen);
    if (shader.mode === renderer.mode && shader.fullscreen === isFullscreen) return;
    shader.mode = renderer.mode;
    shader.fullscreen = isFullscreen;
    shader.mount.setUniforms(createPaperMetalUniforms(renderer));
  };
  var drawFullscreenShader = (renderer, shader) => {
    const { bleed, height, width } = paperMetalRenderSize(renderer);
    drawPaperMetalImage(renderer, shader, bleed, width, height);
  };

  // packages/icon/src/canvas-background.ts
  var drawCanvasBackground = (renderer, time) => {
    const { ctx, height, mode, theme, width } = renderer;
    if (renderer.backgroundStyle === "transparent") return;
    if (renderer.backgroundStyle === "solid") {
      ctx.fillStyle = themeSolidBackgroundFill(theme, mode);
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (theme === "industrial") {
      const base = ctx.createLinearGradient(0, 0, width, height);
      if (mode === "light") {
        base.addColorStop(0, "#fff8f2");
        base.addColorStop(0.56, "#fff1e7");
        base.addColorStop(1, "#ffe2cf");
      } else {
        base.addColorStop(0, "#160b07");
        base.addColorStop(0.56, "#090706");
        base.addColorStop(1, "#1b0d08");
      }
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (theme === "matrix") {
      ctx.fillStyle = mode === "light" ? "#f7fff9" : "#000000";
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (theme === "linear") {
      ctx.fillStyle = mode === "light" ? "#F8FAFC" : "#080A0D";
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (theme === "metal") {
      drawMetalBackground(renderer, time);
      return;
    }
    ctx.fillStyle = mode === "light" ? "#ffffff" : "#050505";
    ctx.fillRect(0, 0, width, height);
  };
  var drawMetalBackground = (renderer, time) => {
    if (drawPaperMetalBackground(renderer, time)) return;
    const { ctx, height, mode, width } = renderer;
    const base = ctx.createLinearGradient(0, 0, 0, height);
    if (mode === "light") {
      base.addColorStop(0, "#dcddd8");
      base.addColorStop(0.36, "#8e9792");
      base.addColorStop(0.68, "#ecece6");
      base.addColorStop(1, "#7f8985");
    } else {
      base.addColorStop(0, "#050607");
      base.addColorStop(0.38, "#343a39");
      base.addColorStop(0.68, "#0d0f10");
      base.addColorStop(1, "#626b68");
    }
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);
  };

  // packages/icon/src/linear-ribbon.ts
  var getVIndex = (quad) => {
    const vStep = MOBIUS_W * 2 / MOBIUS_V_SEGMENTS;
    return Math.round((quad.v + MOBIUS_W) / vStep - 0.5);
  };
  var interpolatePoint = (start, end, amount) => ({
    ...start,
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
    z: start.z + (end.z - start.z) * amount
  });
  var getLinearRibbonBorderQuad = (quad) => {
    const [lowerStart, lowerEnd, upperEnd, upperStart] = quad.outlinePoints ?? quad.points;
    const vIndex = getVIndex(quad);
    if (lowerStart == null || lowerEnd == null || upperEnd == null || upperStart == null) return null;
    if (vIndex === 0) {
      return [
        lowerStart,
        lowerEnd,
        interpolatePoint(lowerEnd, upperEnd, 0.42),
        interpolatePoint(lowerStart, upperStart, 0.42)
      ];
    }
    if (vIndex === MOBIUS_V_SEGMENTS - 1) {
      return [
        upperStart,
        upperEnd,
        interpolatePoint(upperEnd, lowerEnd, 0.42),
        interpolatePoint(upperStart, lowerStart, 0.42)
      ];
    }
    return null;
  };
  var overlapLinearRibbonBorderQuad = (points, amount) => {
    const [outerStart, outerEnd, innerEnd, innerStart] = points;
    if (outerStart == null || outerEnd == null || innerEnd == null || innerStart == null) return points;
    const extend = (start, end, direction) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy) || 1;
      return {
        ...start,
        x: start.x + direction * (dx / length) * amount,
        y: start.y + direction * (dy / length) * amount
      };
    };
    return [
      extend(outerStart, outerEnd, -1),
      extend(outerEnd, outerStart, -1),
      extend(innerEnd, innerStart, -1),
      extend(innerStart, innerEnd, -1)
    ];
  };

  // packages/icon/src/canvas-surface.ts
  var drawSurface = (renderer, time, mesh) => {
    const { ctx, height, width } = renderer;
    const scale = Math.min(width, height) / VIEW;
    const offsetX = (width - VIEW * scale) / 2;
    const offsetY = (height - VIEW * scale) / 2;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.9 / scale;
    for (const quad of mesh) {
      drawQuad(renderer, quad, time, scale);
      if (renderer.theme === "linear") drawLinearRibbonBorder(renderer, quad, scale);
    }
    ctx.restore();
  };
  var drawQuad = (renderer, quad, time, scale) => {
    const points = renderer.theme === "linear" ? quad.outlinePoints ?? quad.points : quad.points;
    const first = points[0];
    if (!first) return;
    const fill = themeFill(renderer.theme, renderer.mode, quad.depth, quad.u, quad.v, time * 1e-3);
    renderer.ctx.fillStyle = fill;
    renderer.ctx.strokeStyle = fill;
    renderer.ctx.lineWidth = (renderer.theme === "linear" ? 0.4 : 0.9) / scale;
    renderer.ctx.beginPath();
    renderer.ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      if (point) renderer.ctx.lineTo(point.x, point.y);
    }
    renderer.ctx.closePath();
    renderer.ctx.fill();
    renderer.ctx.stroke();
  };
  var drawLinearRibbonBorder = (renderer, quad, scale) => {
    const borderQuad = getLinearRibbonBorderQuad(quad);
    if (borderQuad == null) return;
    const { ctx } = renderer;
    const [first, ...rest] = overlapLinearRibbonBorderQuad(borderQuad, 0.6 / scale);
    if (first == null) return;
    ctx.fillStyle = themeLinearBorder(renderer.mode);
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const point of rest) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fill();
  };

  // packages/icon/brand-profile.json
  var brand_profile_default = {
    schemaVersion: 1,
    defaultTheme: "linear",
    defaultAppearance: "system",
    defaultMode: "dark",
    surfaceRecipes: {
      content: "transparent",
      application: "solid",
      social: "composition"
    },
    relayProfiles: {
      cloudflare: "industrial",
      vercel: "matrix"
    }
  };

  // packages/icon/src/brand-profile.ts
  var ONEWORKS_BRAND_PROFILE = brand_profile_default;
  var DEFAULT_BRAND_THEME = ONEWORKS_BRAND_PROFILE.defaultTheme;
  var DEFAULT_BRAND_APPEARANCE = ONEWORKS_BRAND_PROFILE.defaultAppearance;
  var DEFAULT_BRAND_MODE = ONEWORKS_BRAND_PROFILE.defaultMode;
  var ONEWORKS_RELAY_BRAND_THEMES = ONEWORKS_BRAND_PROFILE.relayProfiles;

  // packages/icon/src/presets.ts
  var ONEWORKS_ICON_THEMES = [
    "linear",
    "industrial",
    "metal",
    "matrix"
  ];
  var ONEWORKS_ICON_MODES = ["light", "dark"];
  var ONEWORKS_ICON_APPEARANCES = [
    "system",
    "light",
    "dark"
  ];
  var ONEWORKS_THEME_COLOR_PRESETS = [
    {
      theme: "industrial",
      primaryColor: "#E23F12"
    },
    {
      theme: "metal",
      primaryColor: "#3F7E8F"
    },
    {
      theme: "matrix",
      primaryColor: "#00B454"
    },
    {
      theme: "linear",
      primaryColor: "#7C8A96"
    }
  ];
  var DEFAULT_ICON_THEME = DEFAULT_BRAND_THEME;
  var DEFAULT_ICON_MODE = DEFAULT_BRAND_MODE;
  var DEFAULT_ICON_APPEARANCE = DEFAULT_BRAND_APPEARANCE;
  var DEFAULT_THEME_PRIMARY_COLOR = ONEWORKS_THEME_COLOR_PRESETS.find((preset) => preset.theme === DEFAULT_ICON_THEME)?.primaryColor ?? ONEWORKS_THEME_COLOR_PRESETS[0].primaryColor;
  var isStringIn = (values, value) => values.includes(value);
  var normalizeIconTheme = (value) => isStringIn(ONEWORKS_ICON_THEMES, value) ? value : DEFAULT_ICON_THEME;
  var normalizeIconMode = (value) => isStringIn(ONEWORKS_ICON_MODES, value) ? value : DEFAULT_ICON_MODE;
  var normalizeIconAppearance = (value) => isStringIn(ONEWORKS_ICON_APPEARANCES, value) ? value : DEFAULT_ICON_APPEARANCE;

  // packages/icon/src/canvas.ts
  var getCanvasContext = (canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to create a 2D canvas context for the OneWorks icon renderer.");
    return ctx;
  };
  var normalizeBackgroundStyle = (value) => {
    if (value === "none" || value === "transparent") return "transparent";
    if (value === "solid") return "solid";
    return "textured";
  };
  var resolveBackgroundStyle = ({
    backgroundStyle,
    datasetBackground,
    noBackground
  }) => {
    if (backgroundStyle != null) return backgroundStyle;
    if (noBackground != null) return noBackground ? "transparent" : "textured";
    return normalizeBackgroundStyle(datasetBackground);
  };
  var createCanvasRenderer = (core, canvas, options = {}) => {
    const theme = options.theme ?? normalizeIconTheme(canvas.dataset.theme);
    const mode = options.mode ?? normalizeIconMode(canvas.dataset.mode);
    const baseStatic = options.static ?? canvas.dataset.static === "true";
    const baseBackgroundStyle = resolveBackgroundStyle({
      backgroundStyle: options.backgroundStyle,
      datasetBackground: canvas.dataset.background,
      noBackground: options.noBackground
    });
    const baseNoBackground = baseBackgroundStyle === "transparent";
    return {
      ...core.createMotionSource(),
      backgroundStyle: baseBackgroundStyle,
      baseBackgroundStyle,
      baseNoBackground,
      baseStatic,
      canvas,
      ctx: getCanvasContext(canvas),
      dpr: 1,
      heatCellSize: 14,
      heatCells: [],
      heatCols: 0,
      heatRows: 0,
      height: 0,
      isFullscreen: options.fullscreen ?? false,
      isStatic: baseStatic,
      mode,
      nextHeatUpdate: 0,
      noBackground: baseNoBackground,
      noShadow: options.shadow === false,
      rainColumns: [],
      rainFontSize: 13,
      root: canvas.closest(".mobiusLoader"),
      theme,
      width: 0
    };
  };
  var disposeRenderer = (renderer) => {
    renderer.paperMetalShader?.mount.dispose();
    renderer.paperMetalShader?.host.remove();
    renderer.paperMetalShader = void 0;
  };
  var resetRendererRandom = (core, renderer) => {
    core.resetMotionSource(renderer);
    resetRendererAtmosphere(core, renderer);
  };
  var resetRendererAtmosphere = (core, renderer) => {
    if (renderer.theme === "matrix" && renderer.width > 0) resetRain(core, renderer);
    if (renderer.theme === "industrial" && renderer.width > 0) resetHeatmap(core, renderer);
  };
  var resizeRenderer = (core, renderer) => {
    const rect = renderer.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const pixelArea = width * height;
    const maxDpr = pixelArea > 62e4 ? 1 : pixelArea > 26e4 ? 1.5 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    if (width === renderer.width && height === renderer.height && dpr === renderer.dpr && renderer.canvas.width === Math.round(width * dpr)) {
      return;
    }
    renderer.width = width;
    renderer.height = height;
    renderer.dpr = dpr;
    renderer.canvas.width = Math.round(width * dpr);
    renderer.canvas.height = Math.round(height * dpr);
    renderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    resetRendererAtmosphere(core, renderer);
  };
  var drawRenderer = (core, renderer, time, mesh) => {
    resizeRenderer(core, renderer);
    drawRendererFrame(core, renderer, time, mesh);
  };
  var drawRendererFrame = (core, renderer, time, mesh) => {
    const { ctx, height, width } = renderer;
    ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawCanvasBackground(renderer, time);
    drawAtmosphere(core, renderer, time);
    drawSurface(renderer, time, mesh);
  };

  // packages/icon/src/loader-utils.ts
  var scheduleFrame = (callback) => window.requestAnimationFrame?.(callback) ?? window.setTimeout(() => callback(performance.now()), 16);
  var cancelFrame = (handle) => {
    if (window.cancelAnimationFrame) {
      window.cancelAnimationFrame(handle);
    } else {
      window.clearTimeout(handle);
    }
  };
  var normalizeBackgroundStyle2 = (value) => {
    if (value === false || value === "transparent") return "transparent";
    if (value === "solid") return "solid";
    return "textured";
  };
  var toDatasetBackground = (backgroundStyle) => {
    if (backgroundStyle === "transparent") return "none";
    if (backgroundStyle === "solid") return "solid";
    return "tile";
  };
  var normalizeLoaderOptions = (options) => {
    const backgroundStyle = normalizeBackgroundStyle2(options.background);
    return {
      appearance: normalizeIconAppearance(options.appearance),
      autoStart: options.autoStart ?? true,
      background: backgroundStyle !== "transparent",
      backgroundStyle,
      canvasClassName: options.canvasClassName ?? "oneworks-icon-loader__canvas",
      className: options.className ?? "oneworks-icon-loader",
      fullscreen: options.fullscreen ?? false,
      mode: options.mode == null ? void 0 : normalizeIconMode(options.mode),
      motion: options.motion ?? true,
      random: options.random ?? options.seed == null,
      respectReducedMotion: options.respectReducedMotion ?? true,
      seed: normalizeSeed(options.seed),
      shadow: options.shadow ?? true,
      size: options.size,
      theme: normalizeIconTheme(options.theme)
    };
  };
  var createMediaQuery = (query) => typeof window === "undefined" || !window.matchMedia ? null : window.matchMedia(query);
  var resolveMode = (options, prefersDark) => {
    if (options.mode) return options.mode;
    if (options.appearance === "light" || options.appearance === "dark") return options.appearance;
    return prefersDark?.matches ? "dark" : DEFAULT_ICON_MODE;
  };
  var shouldAnimate = (options, prefersReducedMotion) => options.motion && (!options.respectReducedMotion || !prefersReducedMotion?.matches);
  var applySize = (host, size) => {
    if (size == null) return;
    const value = typeof size === "number" ? `${size}px` : size;
    host.style.width = value;
    host.style.height = value;
  };
  var syncRendererOptions = (core, host, canvas, renderer, options, mode) => {
    const themeChanged = renderer.theme !== options.theme;
    const modeChanged = renderer.mode !== mode;
    renderer.theme = options.theme;
    renderer.mode = mode;
    renderer.isStatic = !options.motion;
    renderer.backgroundStyle = options.backgroundStyle;
    renderer.noBackground = options.backgroundStyle === "transparent";
    renderer.noShadow = !options.shadow;
    renderer.isFullscreen = options.fullscreen;
    canvas.dataset.theme = options.theme;
    canvas.dataset.mode = mode;
    canvas.dataset.background = toDatasetBackground(options.backgroundStyle);
    canvas.dataset.static = String(!options.motion);
    syncClasses(host, renderer);
    if ((themeChanged || modeChanged) && renderer.width > 0) {
      resetRendererAtmosphere(core, renderer);
    }
  };
  var syncClasses = (host, renderer) => {
    host.classList.remove(
      "metal",
      "industrial",
      "matrix",
      "linear",
      "mode-light",
      "mode-dark",
      "no-bg",
      "no-shadow",
      "fullscreen"
    );
    host.classList.add(renderer.theme, `mode-${renderer.mode}`);
    host.classList.toggle("no-bg", renderer.noBackground);
    host.classList.toggle("no-shadow", renderer.noShadow);
    host.classList.toggle("fullscreen", renderer.isFullscreen);
  };

  // packages/icon/src/loader.ts
  var TARGET_FRAME_MS = 1e3 / 24;
  var mountOneWorksIconLoader = (host, initialOptions = {}) => {
    let options = normalizeLoaderOptions(initialOptions);
    const prefersReducedMotion = createMediaQuery("(prefers-reduced-motion: reduce)");
    const prefersDark = createMediaQuery("(prefers-color-scheme: dark)");
    const seed = options.random ? createSessionSeed() : options.seed ?? createSessionSeed();
    const core = createMobiusCore(seed);
    const canvas = document.createElement("canvas");
    const mode = resolveMode(options, prefersDark);
    canvas.className = options.canvasClassName;
    canvas.dataset.theme = options.theme;
    canvas.dataset.mode = mode;
    canvas.dataset.background = toDatasetBackground(options.backgroundStyle);
    canvas.dataset.static = String(!options.motion);
    host.classList.add(options.className, "mobiusLoader");
    applySize(host, options.size);
    host.appendChild(canvas);
    const renderer = createCanvasRenderer(core, canvas, createRendererOptions(options, mode));
    syncRendererOptions(core, host, canvas, renderer, options, mode);
    let disposed = false;
    let frameHandle = null;
    let lastDrawTime = -Infinity;
    const drawAll = (time) => {
      const animationEnabled = shouldAnimate(options, prefersReducedMotion);
      const seconds = time * 1e-3;
      renderer.isStatic = !animationEnabled;
      const motionAmount = renderer.isStatic ? 0 : 1;
      const mesh = renderer.isStatic ? core.staticMesh : core.buildMesh(seconds, motionAmount, core.getMotionState(seconds, motionAmount, renderer));
      drawRenderer(core, renderer, renderer.isStatic ? 0 : time, mesh);
    };
    const requestFrame = () => {
      if (disposed || frameHandle != null) return;
      frameHandle = scheduleFrame(drawFrame);
    };
    const drawFrame = (time) => {
      frameHandle = null;
      if (time - lastDrawTime >= TARGET_FRAME_MS || lastDrawTime < 0) {
        lastDrawTime = time;
        drawAll(time);
      }
      if (shouldAnimate(options, prefersReducedMotion)) requestFrame();
    };
    const redraw = (time = performance.now()) => {
      lastDrawTime = time;
      drawAll(time);
      if (shouldAnimate(options, prefersReducedMotion)) requestFrame();
    };
    const stop = () => {
      if (frameHandle == null) return;
      cancelFrame(frameHandle);
      frameHandle = null;
    };
    const start = () => {
      if (!disposed) redraw();
    };
    const update = (nextOptions) => {
      if (disposed) return;
      const previous = options;
      options = normalizeLoaderOptions({ ...options, background: options.backgroundStyle, ...nextOptions });
      resetSeedIfNeeded(previous, options, nextOptions);
      applySize(host, options.size);
      syncRendererOptions(core, host, canvas, renderer, options, resolveMode(options, prefersDark));
      redraw();
    };
    const handleResize = () => {
      if (disposed) return;
      resizeRenderer(core, renderer);
      redraw();
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(handleResize);
    resizeObserver?.observe(host);
    const handleMediaChange = () => {
      if (disposed) return;
      syncRendererOptions(core, host, canvas, renderer, options, resolveMode(options, prefersDark));
      redraw();
    };
    window.addEventListener("resize", handleResize);
    prefersReducedMotion?.addEventListener?.("change", handleMediaChange);
    prefersDark?.addEventListener?.("change", handleMediaChange);
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      stop();
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      prefersReducedMotion?.removeEventListener?.("change", handleMediaChange);
      prefersDark?.removeEventListener?.("change", handleMediaChange);
      disposeRenderer(renderer);
      canvas.remove();
    };
    const resetSeedIfNeeded = (previous, current, nextOptions) => {
      if (nextOptions.random === true && !previous.random) {
        core.resetSeed(createSessionSeed());
        resetRendererRandom(core, renderer);
      } else if (current.seed && current.seed !== core.seed && current.random === false) {
        core.resetSeed(current.seed);
        resetRendererRandom(core, renderer);
      }
    };
    if (options.autoStart) start();
    return {
      get seed() {
        return core.seed;
      },
      canvas,
      core,
      dispose,
      redraw,
      renderer,
      start,
      stop,
      update
    };
  };
  var createRendererOptions = (options, mode) => ({
    backgroundStyle: options.backgroundStyle,
    fullscreen: options.fullscreen,
    mode,
    shadow: options.shadow,
    static: !options.motion,
    theme: options.theme
  });
  return __toCommonJS(loader_exports);
})();
