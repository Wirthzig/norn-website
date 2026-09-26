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
const STREAK_START = 1500;
const IMPACT = 1760;
const BEAM_HOLD = 180;
const BEAM_FADE = 800;
const UI_START = 2500;
const UI_DURATION = 700;
const UI_STAGGER = 90;
const END = 3600;

// where the cut runs through the O, in wordmark units. measured from the mark's
// pixels, a line through the gap between the two halves
const CUT_CENTER_X = 417.4;
const CUT_CENTER_Y = 147.7;
const CUT_ANGLE = (-38 * Math.PI) / 180;
const CUT_REACH = 175;

type Mode = "play" | "done" | "calm";

export function startIntro() {
  const root = document.documentElement;
  const hero = document.getElementById("hero");
  const canvas = hero?.querySelector<HTMLCanvasElement>(".hero-canvas");
  const wordmark = hero?.querySelector<SVGSVGElement>(".wordmark");
  const cover = document.getElementById("o-cover");
  const tips = document.getElementById("tips-rect");
  const glow = hero?.querySelector<HTMLElement>(".hero-glow");
  const flash = hero?.querySelector<HTMLElement>(".hero-flash");
  const skip = hero?.querySelector<HTMLButtonElement>(".intro-skip");
  if (!hero || !canvas || !wordmark || !cover || !tips || !glow || !flash || !skip) return;

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
    const margin = 60;
    // distance back to where the line enters the screen, and on to where it leaves
    const toEdge = (sign: number) => {
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
    return {
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
    field.beam = null;
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

  // everything the canvas and the cut show at a moment of the intro
  const advance = (elapsed: number) => {
    const speed = line.impactDistance / (IMPACT - STREAK_START);
    if (elapsed >= STREAK_START) {
      const head = (elapsed - STREAK_START) * speed;
      const exitTime = STREAK_START + line.length / speed;
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
        fade: clamp01((elapsed - exitTime - BEAM_HOLD) / BEAM_FADE),
      };
      // the cut follows the head of the streak exactly, in wordmark units
      setCut((head - line.impactDistance) / line.scale);
    } else {
      setCut(-CUT_REACH);
    }
    if (!burstDone && elapsed >= IMPACT) {
      burstDone = true;
      field.burst(line.centerX, line.centerY, line.directionX, line.directionY, Math.round(field.budget() * 1.2));
      field.shock(line.centerX, line.centerY);
    }
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
      { opacity: 0.85, offset: 0.05, easing: EASE_OUT_CSS },
      { opacity: 0 },
    ],
    { ...at(IMPACT - 20), duration: 900 },
  );
  animate(
    wordmark,
    [{ filter: "drop-shadow(0 0 18px rgba(220, 230, 255, 0.85))" }, { filter: "drop-shadow(0 0 0 rgba(220, 230, 255, 0))" }],
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
