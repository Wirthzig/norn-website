// the intro. the night lifts, NORN rises, a streak of light rams through the O and
// cuts it into the norn mark, the impact leaves dust that drifts on.
// the rare first time tier of the animate skill, the one place a long animation is
// right. it plays once per arrival, skips on any input and stays calm under
// reduced motion.

import { EASE_OUT_CSS, clamp01, easeOut } from "./easing";
import { ParticleField } from "./particles";
import { LensPass, type Lens } from "./post";

// milliseconds from the start
const LIFT_START = 150;
const LIFT_DURATION = 1400;
const CHARGE_DURATION = 300;
const STREAK_START = 1850;
// free flight from the screen edge to the first touch of the disc
const APPROACH = 160;
const IMPACT = STREAK_START + APPROACH;
const BEAM_HOLD = 220;
const BEAM_FADE = 900;
const UI_START = 2900;
const UI_DURATION = 700;
const UI_STAGGER = 90;
const END = 4000;

// the disc brakes the streak. at the middle of the O it runs at half speed and it
// leaves a little slower than it came, the energy went into the cut
const BRAKE_DEPTH = 0.5;
const EXIT_LOSS = 0.18;
// how far the halves spring apart when the ram goes through, in wordmark units
const RECOIL = 6;

// where the cut runs through the O, in wordmark units. measured from the mark's
// pixels, a line through the gap between the two halves
const CUT_CENTER_X = 417.4;
const CUT_CENTER_Y = 147.7;
const CUT_ANGLE = (-38 * Math.PI) / 180;
const CUT_REACH = 175;
// half the chord the cut line makes through the disc
const DISC_HALF_CHORD = 134;

type Mode = "play" | "done" | "calm";

export function startIntro() {
  const root = document.documentElement;
  const hero = document.getElementById("hero");
  const canvas = hero?.querySelector<HTMLCanvasElement>(".hero-canvas");
  const wordmark = hero?.querySelector<SVGSVGElement>(".wordmark");
  const cover = document.getElementById("o-cover");
  const tips = document.getElementById("tips-rect");
  const upperHalf = document.getElementById("o-upper");
  const lowerHalf = document.getElementById("o-lower");
  const glow = hero?.querySelector<HTMLElement>(".hero-glow");
  const flash = hero?.querySelector<HTMLElement>(".hero-flash");
  const skip = hero?.querySelector<HTMLButtonElement>(".intro-skip");
  if (!hero || !canvas || !wordmark || !cover || !tips || !upperHalf || !lowerHalf || !glow || !flash || !skip) return;

  const mode = (root.dataset.intro as Mode) || "done";
  // with webgl the scene is painted offscreen, wordmark included, and filmed through
  // the lens. without it the canvas holds only the light and the svg stays on top
  const lens = mode === "calm" ? null : LensPass.create(canvas);
  const field = new ParticleField(lens ? document.createElement("canvas") : canvas, 2);
  const canvasWordmark = !!lens && mode === "play";
  // milliseconds into the intro, or null once the page is at rest
  let clock: number | null = mode === "play" ? 0 : null;
  let cutPosition = CUT_REACH;
  let recoilOffset = 0;
  const pathOf = (element: Element | null) => new Path2D(element?.getAttribute("d") ?? "");
  const lettersPath = pathOf(wordmark.querySelector("path:not([id])"));
  const upperPath = pathOf(upperHalf);
  const lowerPath = pathOf(lowerHalf);
  const tipsPath = pathOf(wordmark.querySelector("g[clip-path] path"));
  const animations: Animation[] = [];
  let playing = mode === "play";
  let burstDone = false;
  let frame = 0;
  let last = 0;
  let start = 0;
  let visible = true;
  let frozen = false;
  // the streak's flight, integrated so the braking in the disc is real motion
  let head = 0;
  let lastElapsed = 0;
  let entered = false;
  let centerAt = -1;
  let exited = false;

  // the halves spring apart along the cut's normal and settle back
  const setRecoil = (offset: number) => {
    recoilOffset = offset;
    const normalX = -Math.sin(CUT_ANGLE);
    const normalY = Math.cos(CUT_ANGLE);
    upperHalf.setAttribute("transform", `translate(${-normalX * offset} ${-normalY * offset})`);
    lowerHalf.setAttribute("transform", `translate(${normalX * offset} ${normalY * offset})`);
  };

  // position of the cut, -reach is an uncut disc, +reach the finished mark
  const setCut = (position: number) => {
    const cut = Math.max(-CUT_REACH, Math.min(CUT_REACH, position));
    cutPosition = cut;
    cover.setAttribute("x", String(cut));
    cover.setAttribute("width", String(Math.max(0, CUT_REACH - cut)));
    tips.setAttribute("width", String(Math.max(0, cut + 400)));
  };

  // the cut line in canvas pixels, recomputed on every resize
  const geometry = () => {
    const matrix = wordmark.getScreenCTM();
    const heroRect = hero.getBoundingClientRect();
    const scale = matrix ? matrix.a : 1;
    const centerX = (matrix ? matrix.a * CUT_CENTER_X + matrix.e : 0) - heroRect.left;
    const centerY = (matrix ? matrix.d * CUT_CENTER_Y + matrix.f : 0) - heroRect.top;
    const directionX = Math.cos(CUT_ANGLE);
    const directionY = Math.sin(CUT_ANGLE);
    // distance back to where the line enters the screen, and on to where it leaves
    const toEdge = (sign: number, margin = 60) => {
      const limits: number[] = [];
      const stepX = directionX * sign;
      const stepY = directionY * sign;
      if (stepX > 0) limits.push((field.width + margin - centerX) / stepX);
      if (stepX < 0) limits.push((-margin - centerX) / stepX);
      if (stepY > 0) limits.push((field.height + margin - centerY) / stepY);
      if (stepY < 0) limits.push((-margin - centerY) / stepY);
      return Math.min(...limits);
    };
    const back = toEdge(-1);
    const forward = toEdge(1);
    const visibleBack = toEdge(-1, -14);
    return {
      originX: (matrix ? matrix.e : 0) - heroRect.left,
      originY: (matrix ? matrix.f : 0) - heroRect.top,
      chargeX: centerX - directionX * visibleBack,
      chargeY: centerY - directionY * visibleBack,
      scale,
      centerX,
      centerY,
      directionX,
      directionY,
      startX: centerX - directionX * back,
      startY: centerY - directionY * back,
      impactDistance: back,
      length: back + forward,
    };
  };
  const resizeAll = () => {
    const rect = hero.getBoundingClientRect();
    field.resize(rect.width, rect.height);
    if (lens) {
      canvas.width = field.canvas.width;
      canvas.height = field.canvas.height;
    }
  };
  resizeAll();
  let line = geometry();

  // the wordmark painted into the scene, the same paths and the same cut as the svg
  // painted opaque on its own layer and faded as one, overlapping shapes at half
  // opacity would show their seams
  const wordmarkLayer = document.createElement("canvas");
  const paintWordmark = (target: CanvasRenderingContext2D, alpha: number) => {
    if (alpha <= 0) return;
    if (wordmarkLayer.width !== field.canvas.width || wordmarkLayer.height !== field.canvas.height) {
      wordmarkLayer.width = field.canvas.width;
      wordmarkLayer.height = field.canvas.height;
    }
    const context = wordmarkLayer.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, wordmarkLayer.width, wordmarkLayer.height);
    context.setTransform(field.ratio, 0, 0, field.ratio, 0, 0);
    const normalX = -Math.sin(CUT_ANGLE);
    const normalY = Math.cos(CUT_ANGLE);
    context.save();
    context.fillStyle = "#f5f5f5";
    context.translate(line.originX, line.originY);
    context.scale(line.scale, line.scale);
    context.fill(lettersPath, "evenodd");
    context.save();
    context.translate(-normalX * recoilOffset, -normalY * recoilOffset);
    context.fill(upperPath, "evenodd");
    context.restore();
    context.save();
    context.translate(normalX * recoilOffset, normalY * recoilOffset);
    context.fill(lowerPath, "evenodd");
    context.restore();
    // the spindle tips show behind the cut, the cover hides the gap ahead of it
    context.save();
    context.translate(CUT_CENTER_X, CUT_CENTER_Y);
    context.rotate(CUT_ANGLE);
    context.beginPath();
    context.rect(-400, -60, cutPosition + 400, 120);
    context.rotate(-CUT_ANGLE);
    context.translate(-CUT_CENTER_X, -CUT_CENTER_Y);
    context.clip();
    context.fill(tipsPath, "evenodd");
    context.restore();
    if (cutPosition < CUT_REACH) {
      context.save();
      context.beginPath();
      context.arc(408.25, 135.84, 135.04, 0, Math.PI * 2);
      context.clip();
      context.translate(CUT_CENTER_X, CUT_CENTER_Y);
      context.rotate(CUT_ANGLE);
      context.fillRect(cutPosition, -13, CUT_REACH - cutPosition, 26);
      context.restore();
    }
    context.restore();
    target.save();
    target.globalAlpha = alpha;
    target.drawImage(wordmarkLayer, 0, 0, field.width, field.height);
    target.restore();
  };

  // the cut stays hot for a moment after the ram, white cooling to blue
  const paintWound = (context: CanvasRenderingContext2D, now: number) => {
    if (centerAt < 0) return;
    const heat = Math.exp(-(now - centerAt) / 450);
    if (heat < 0.02) return;
    const entry = line.impactDistance - DISC_HALF_CHORD * line.scale;
    const exit = Math.min(head, line.impactDistance + DISC_HALF_CHORD * line.scale);
    const fromX = line.startX + line.directionX * entry;
    const fromY = line.startY + line.directionY * entry;
    const toX = line.startX + line.directionX * exit;
    const toY = line.startY + line.directionY * exit;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    const strokes: Array<[number, string]> = [
      [5 * line.scale, `rgba(190, 210, 255, ${0.25 * heat})`],
      [1.8 * line.scale, `rgba(255, 255, 255, ${0.9 * heat})`],
    ];
    for (const [width, colour] of strokes) {
      context.strokeStyle = colour;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(fromX, fromY);
      context.lineTo(toX, toY);
      context.stroke();
    }
    context.restore();
  };

  // the ground, the night lifting to near black with a faint light behind the name
  const paintBehind = (context: CanvasRenderingContext2D) => {
    const now = clock;
    const lift = now === null ? 1 : easeOut(clamp01((now - LIFT_START) / LIFT_DURATION));
    context.fillStyle = `rgb(${10 * lift}, ${10 * lift}, ${11 * lift})`;
    context.fillRect(0, 0, field.width, field.height);
    context.save();
    context.translate(field.width / 2, field.height / 2);
    context.scale(field.width * 0.6, field.height * 0.45);
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, `rgba(255, 255, 255, ${0.045 * lift})`);
    glow.addColorStop(0.7, "rgba(255, 255, 255, 0)");
    context.fillStyle = glow;
    context.fillRect(-2, -2, 4, 4);
    context.restore();
    if (canvasWordmark && now !== null) {
      const rise = easeOut(clamp01((now - LIFT_START - 100) / LIFT_DURATION));
      const handover = 1 - clamp01((now - (END - 400)) / 400);
      paintWordmark(context, rise * handover);
      paintWound(context, now);
    }
  };

  // what the lens does at this moment. at rest it only adds grain, a vignette, a
  // little bloom and a trace of colour fringing
  const lensAt = (): Lens => {
    const rest: Lens = {
      centerX: line.centerX / field.width,
      centerY: line.centerY / field.height,
      shockRadius: 0,
      shockWidth: 0.05,
      shockStrength: 0,
      aberration: 0,
      zoomBlur: 0,
      exposure: 0,
      bloom: 0.04,
      defocus: 0,
      zoom: 1,
      shakeX: 0,
      shakeY: 0,
      time: field.time,
    };
    if (clock === null || !canvasWordmark) return rest;
    const now = clock;
    const since = now - IMPACT;
    const hit = since >= 0;
    const decay = (tau: number) => (hit ? Math.exp(-since / tau) : 0);
    const attack = hit ? Math.min(1, since / 25) : 0;
    const charge = hit ? 0 : clamp01((now - (STREAK_START - CHARGE_DURATION)) / CHARGE_DURATION);
    // a rumble while the light gathers, then the hit
    const rumble = (1.6 * charge * charge + 18 * attack * decay(170)) * (0.6 + 0.4 * field.motionScale);
    const wave = clamp01(since / 1000);
    return {
      ...rest,
      shockRadius: hit ? 1.4 * easeOut(wave) : 0,
      shockWidth: 0.04 + 0.06 * wave,
      shockStrength: hit ? 0.035 * (1 - wave) ** 2 : 0,
      aberration: 0.008 * attack * decay(200),
      zoomBlur: 0.1 * attack * decay(120),
      exposure: 0.6 * attack * decay(80),
      bloom: 0.04 + 0.35 * attack * decay(160) + (field.beam && !hit ? 0.05 : 0),
      defocus: 1 - easeOut(clamp01((now - LIFT_START - 100) / LIFT_DURATION)),
      zoom: 1.06 - 0.06 * easeOut(clamp01(now / STREAK_START)) + 0.045 * attack * decay(200),
      shakeX: (rumble * (Math.sin(now * 0.093) + 0.6 * Math.sin(now * 0.221 + 1.3))) / 1.6 / field.width,
      shakeY: (rumble * (Math.sin(now * 0.117 + 0.7) + 0.6 * Math.sin(now * 0.187 + 2.1))) / 1.6 / field.height,
    };
  };

  const render = () => {
    if (!lens) {
      field.draw();
      return;
    }
    field.draw(paintBehind);
    lens.render(field.canvas, lensAt());
  };

  const finish = () => {
    if (!playing) return;
    playing = false;
    clock = null;
    for (const animation of animations) animation.finish();
    for (const animation of animations) animation.cancel();
    animations.length = 0;
    setCut(CUT_REACH);
    setRecoil(0);
    field.beam = null;
    field.charge = null;
    if (!burstDone) {
      burstDone = true;
      field.seed(field.budget());
    }
    // not "done", that value fades the logo in for someone arriving from inside the site
    root.dataset.intro = "finished";
    skip.remove();
    removeSkipListeners();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Tab" || event.key === "Shift") return;
    finish();
  };
  const skipEvents: Array<[EventTarget, string, EventListener]> = [
    [hero, "pointerdown", finish],
    [window, "wheel", finish],
    [window, "touchmove", finish],
    [window, "keydown", onKey as EventListener],
  ];
  const removeSkipListeners = () => {
    for (const [target, name, listener] of skipEvents) target.removeEventListener(name, listener);
  };

  const animate = (
    element: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) => {
    const animation = element.animate(keyframes, { fill: "both", ...options });
    // every animation counts from the same zero as the canvas
    animation.startTime = start;
    animations.push(animation);
    return animation;
  };

  // speed of the streak as a share of its free flight speed, by where the head is
  const speedFactor = (along: number) => {
    const inside = Math.abs(along) < DISC_HALF_CHORD;
    const grind = inside ? Math.cos(((Math.PI / 2) * along) / DISC_HALF_CHORD) ** 2 : 0;
    const base = along <= 0 ? 1 : 1 - EXIT_LOSS * Math.min(1, along / DISC_HALF_CHORD);
    return { factor: base - BRAKE_DEPTH * grind, grind };
  };

  const sprayFromCut = (from: number, to: number, speed: number) => {
    // sparks per pixel of cut, so a phone and a monitor get the same density
    const perPixel = (field.budget() * 1.1) / (2 * DISC_HALF_CHORD * line.scale);
    const count = Math.round((to - from) * perPixel);
    const normalX = -line.directionY;
    const normalY = line.directionX;
    for (let index = 0; index < count; index++) {
      const at = from + Math.random() * (to - from);
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = line.startX + line.directionX * at + normalX * side * 8 * line.scale;
      const y = line.startY + line.directionY * at + normalY * side * 8 * line.scale;
      const outward = 120 + Math.random() * 680;
      const dragged = (0.05 + Math.random() * 0.25) * speed * 1000;
      field.emit(
        x,
        y,
        normalX * side * outward + line.directionX * dragged + (Math.random() - 0.5) * 120,
        normalY * side * outward + line.directionY * dragged + (Math.random() - 0.5) * 120,
      );
    }
  };

  const jet = (along: number, count: number, direction: 1 | -1, spread: number, low: number, high: number) => {
    const x = line.startX + line.directionX * along;
    const y = line.startY + line.directionY * along;
    const heading = Math.atan2(line.directionY * direction, line.directionX * direction);
    for (let index = 0; index < count; index++) {
      const angle = heading + (Math.random() - 0.5) * spread;
      const speed = low + Math.random() * (high - low);
      field.emit(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed);
    }
  };

  // everything the canvas, the cut and the halves show at a moment of the intro
  const advance = (elapsed: number) => {
    clock = elapsed;
    const delta = Math.max(0, elapsed - lastElapsed);
    lastElapsed = elapsed;
    const discEntry = line.impactDistance - DISC_HALF_CHORD * line.scale;
    const freeSpeed = discEntry / APPROACH;

    if (elapsed < STREAK_START) {
      const charge = clamp01((elapsed - (STREAK_START - CHARGE_DURATION)) / CHARGE_DURATION);
      field.charge = charge > 0 ? { x: line.chargeX, y: line.chargeY, amount: charge * charge } : null;
      setCut(-CUT_REACH);
      return;
    }
    field.charge = null;

    // small steps, the speed changes fast inside the disc
    let grind = 0;
    let speed = freeSpeed;
    const previous = head;
    const flown = Math.min(delta, elapsed - STREAK_START);
    for (let step = 0; step < flown; step += 1) {
      const along = (head - line.impactDistance) / line.scale;
      const current = speedFactor(along);
      grind = current.grind;
      speed = freeSpeed * current.factor;
      head += speed * Math.min(1, flown - step);
    }

    field.wake(line.startX, line.startY, line.directionX, line.directionY, previous - 40, head);
    const along = (head - line.impactDistance) / line.scale;
    if (!entered && along >= -DISC_HALF_CHORD) {
      entered = true;
      jet(discEntry, Math.round(field.budget() * 0.2), -1, 1.6, 120, 520);
    }
    if (entered && !exited) {
      const inFrom = Math.max(previous, discEntry);
      const inTo = Math.min(head, line.impactDistance + DISC_HALF_CHORD * line.scale);
      if (inTo > inFrom) sprayFromCut(inFrom, inTo, speed);
    }
    if (centerAt < 0 && along >= 0) {
      centerAt = elapsed;
      burstDone = true;
      field.burst(line.centerX, line.centerY, line.directionX, line.directionY, Math.round(field.budget() * 0.35));
      field.shock(line.centerX, line.centerY);
    }
    if (!exited && along >= DISC_HALF_CHORD) {
      exited = true;
      // what the ram carries out of the O, a jet along its path
      jet(line.impactDistance + DISC_HALF_CHORD * line.scale, Math.round(field.budget() * 0.45), 1, 0.7, 400, 1600);
    }

    if (centerAt >= 0) {
      const since = elapsed - centerAt;
      const open = 50;
      const offset =
        since < open
          ? RECOIL * (since / open)
          : RECOIL * Math.exp(-(since - open) / 200) * Math.cos((2 * Math.PI * (since - open)) / 320);
      setRecoil(offset);
    }

    const exitTime = elapsed - (head - line.length) / Math.max(speed, 0.001);
    const tailLength = line.impactDistance * 0.9;
    // before the impact the streak has a fixed tail, after it the line stays lit
    const tailEnd = head < line.impactDistance ? head - tailLength : line.impactDistance - tailLength;
    field.beam = {
      startX: line.startX,
      startY: line.startY,
      directionX: line.directionX,
      directionY: line.directionY,
      length: line.length,
      head,
      tail: head - tailEnd,
      fade: head > line.length ? clamp01((elapsed - exitTime - BEAM_HOLD) / BEAM_FADE) : 0,
      friction: grind,
    };
    // the cut follows the head of the streak exactly, in wordmark units
    setCut(along);
  };

  const tick = (now: number) => {
    frame = 0;
    const deltaSeconds = last ? (now - last) / 1000 : 0;
    last = now;
    if (playing) {
      const elapsed = now - start;
      advance(elapsed);
      if (elapsed >= END) finish();
    }
    field.step(deltaSeconds);
    render();
    if (visible && !document.hidden) frame = requestAnimationFrame(tick);
  };

  const resume = () => {
    if (frame || frozen || mode === "calm") return;
    last = 0;
    frame = requestAnimationFrame(tick);
  };

  new ResizeObserver(() => {
    resizeAll();
    line = geometry();
    if (mode === "calm" || frozen) render();
  }).observe(hero);

  // the drift only runs while someone can see it
  new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible) resume();
  }).observe(hero);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) resume();
  });

  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    window.addEventListener("pointermove", (event) => {
      const rect = hero.getBoundingClientRect();
      field.pointer(event.clientX - rect.left, event.clientY - rect.top);
    });
  }

  if (mode === "calm") {
    // reduced motion, the finished logo and a still field of dust, nothing travels
    setCut(CUT_REACH);
    field.seed(field.budget());
    field.draw();
    return;
  }

  if (mode === "done") {
    setCut(CUT_REACH);
    burstDone = true;
    field.seed(field.budget());
    resume();
    return;
  }

  // play
  setCut(-CUT_REACH);
  for (const [target, name, listener] of skipEvents) target.addEventListener(name, listener, { passive: true });
  skip.addEventListener("click", finish);
  field.ambient(Math.round(field.budget() * 0.3), LIFT_DURATION / 1000);

  start = document.timeline.currentTime as number;
  const at = (milliseconds: number) => ({ delay: milliseconds });

  if (lens) {
    // the canvas paints the wordmark through the intro, the svg takes over at the end
    animate(wordmark, [{ opacity: 0 }, { opacity: 1 }], { ...at(END - 400), duration: 400, easing: "ease" });
  } else {
    animate(hero, [{ backgroundColor: "#000000" }, { backgroundColor: "#0a0a0b" }], {
      ...at(LIFT_START),
      duration: LIFT_DURATION,
      easing: "ease",
    });
    animate(glow, [{ opacity: 0 }, { opacity: 1 }], { ...at(LIFT_START), duration: LIFT_DURATION, easing: EASE_OUT_CSS });
    animate(
      wordmark,
      [
        { opacity: 0, filter: "blur(14px)", transform: "scale(0.97)" },
        { opacity: 1, filter: "blur(0px)", transform: "scale(1)" },
      ],
      { ...at(LIFT_START + 100), duration: LIFT_DURATION, easing: EASE_OUT_CSS },
    );
    // the impact, a white out that falls away, a glow left on the letters
    animate(
      flash,
      [
        { opacity: 0, easing: "linear" },
        { opacity: 0.7, offset: 0.06, easing: EASE_OUT_CSS },
        { opacity: 0 },
      ],
      { ...at(IMPACT - 10), duration: 560 },
    );
    // the hit shakes the frame, hard at first and dying out. a fixed pattern, so every
    // visit feels the same
    const title = hero.querySelector(".hero-title");
    const amplitude = Math.min(10, field.width / 110);
    const pattern = [
      [0.9, -0.5], [-0.8, 0.7], [0.6, 0.9], [-0.9, -0.3], [0.4, -0.8],
      [-0.5, 0.5], [0.6, 0.2], [-0.3, -0.4], [0.2, 0.3], [0, 0],
    ];
    const shake = (scalePunch: boolean): Keyframe[] => [
      { transform: "translate(0, 0) scale(1)" },
      ...pattern.map(([x, y], index) => {
        const decay = (1 - index / pattern.length) ** 2;
        const punch = scalePunch ? 1 + 0.02 * decay : 1;
        return { transform: `translate(${x * amplitude * decay}px, ${y * amplitude * decay}px) scale(${punch})` };
      }),
    ];
    if (title) animate(title, shake(true), { ...at(IMPACT), duration: 520, easing: "linear", fill: "none" });
    animate(canvas, shake(false), { ...at(IMPACT), duration: 520, easing: "linear", fill: "none" });
    animate(
      wordmark,
      [{ filter: "drop-shadow(0 0 10px rgba(220, 230, 255, 0.8))" }, { filter: "drop-shadow(0 0 0 rgba(220, 230, 255, 0))" }],
      { ...at(IMPACT), duration: 1200, easing: EASE_OUT_CSS, fill: "none" },
    );
  }
  hero.querySelectorAll(".intro-after").forEach((element, index) => {
    animate(
      element,
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { ...at(UI_START + index * UI_STAGGER), duration: UI_DURATION, easing: EASE_OUT_CSS },
    );
  });
  animate(skip, [{ opacity: 1 }, { opacity: 0 }], { ...at(END - 400), duration: 300, easing: EASE_OUT_CSS });

  // development only, ?at=1800 freezes the intro at that millisecond for screenshots
  const frozenAt = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get("at")) : NaN;
  if (Number.isFinite(frozenAt) && frozenAt > 0) {
    frozen = true;
    playing = false;
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = frozenAt;
    }
    for (let elapsed = 0; elapsed <= frozenAt; elapsed += 1000 / 60) {
      advance(elapsed);
      field.step(1 / 60);
    }
    render();
    return;
  }

  frame = requestAnimationFrame(tick);
}
