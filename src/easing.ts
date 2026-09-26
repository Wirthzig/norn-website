// the design system names its curves as css cubic beziers. the canvas needs the same
// curves in javascript, so this solves a bezier instead of approximating it

export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const coordinate = (t: number, a: number, b: number) =>
    3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
  const slope = (t: number, a: number, b: number) =>
    3 * a * (1 - t) * (1 - t) + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;

  return (progress: number) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let t = progress;
    for (let step = 0; step < 6; step++) {
      const error = coordinate(t, x1, x2) - progress;
      const derivative = slope(t, x1, x2);
      if (Math.abs(error) < 1e-5) return coordinate(t, y1, y2);
      if (Math.abs(derivative) < 1e-6) break;
      t -= error / derivative;
    }
    // newton can wander on steep curves, bisection always lands
    let low = 0;
    let high = 1;
    t = progress;
    for (let step = 0; step < 24; step++) {
      const value = coordinate(t, x1, x2);
      if (Math.abs(value - progress) < 1e-5) break;
      if (value < progress) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return coordinate(t, y1, y2);
  };
}

// the same values as --ease-out and --ease-in-out in norn-tokens.css
export const EASE_OUT_CSS = "cubic-bezier(0.23, 1, 0.32, 1)";
export const easeOut = cubicBezier(0.23, 1, 0.32, 1);

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
