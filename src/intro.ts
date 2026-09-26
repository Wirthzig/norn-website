// the intro. the night lifts, NORN rises, a streak of light rams through the O and
// cuts it into the norn mark, the impact leaves dust that drifts on.
// the rare first time tier of the animate skill, the one place a long animation is
// right. it plays once per arrival, skips on any input and stays calm under
// reduced motion.

import { EASE_OUT_CSS, clamp01 } from "./easing";
import { ParticleField } from "./particles";

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
  const field = new ParticleField(canvas);
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
    const normalX = -Math.sin(CUT_ANGLE);
    const normalY = Math.cos(CUT_ANGLE);
    upperHalf.setAttribute("transform", `translate(${-normalX * offset} ${-normalY * offset})`);
    lowerHalf.setAttribute("transform", `translate(${normalX * offset} ${normalY * offset})`);
  };

  // position of the cut, -reach is an uncut disc, +reach the finished mark
  const setCut = (position: number) => {
    const cut = Math.max(-CUT_REACH, Math.min(CUT_REACH, position));
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
  let line = geometry();

  const finish = () => {
    if (!playing) return;
    playing = false;
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
    field.draw();
    if (visible && !document.hidden) frame = requestAnimationFrame(tick);
  };

  const resume = () => {
    if (frame || frozen || mode === "calm") return;
    last = 0;
    frame = requestAnimationFrame(tick);
  };

  new ResizeObserver(() => {
    field.resize();
    line = geometry();
    if (mode === "calm" || frozen) field.draw();
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
  hero.querySelectorAll(".intro-after").forEach((element, index) => {
    animate(
      element,
      [
        { opacity: 0, transform: `${element.classList.contains("hero-cue") ? "translateX(-50%) " : ""}translateY(8px)` },
        { opacity: 1, transform: `${element.classList.contains("hero-cue") ? "translateX(-50%) " : ""}translateY(0)` },
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
    field.draw();
    return;
  }

  frame = requestAnimationFrame(tick);
}
