// the dust of the impact. particles fly out hot, lose their speed and settle into a
// slow constant drift that keeps going behind the hero for as long as it is on screen

import { clamp01, easeOut } from "./easing";

type Particle = {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  driftX: number;
  driftY: number;
  size: number;
  alpha: number;
  depth: number;
  phase: number;
  twinkle: number;
  heat: number;
  cool: boolean;
  shocked: boolean;
  born: number;
  fadeIn: number;
};

type Shockwave = { x: number; y: number; born: number; reach: number };

export type Beam = {
  startX: number;
  startY: number;
  directionX: number;
  directionY: number;
  length: number;
  head: number;
  tail: number;
  fade: number;
};

const MAX_PIXEL_RATIO = 2;
// how fast burst speed decays toward the drift, per second
const DRAG = 2.4;
const SHOCK_DURATION = 1.1;
const FLARE_DURATION = 0.6;

export class ParticleField {
  private context: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private shockwaves: Shockwave[] = [];
  private flareAt = -1;
  private flareX = 0;
  private flareY = 0;
  width = 0;
  height = 0;
  time = 0;
  beam: Beam | null = null;
  private pointerTargetX = 0;
  private pointerTargetY = 0;
  private pointerX = 0;
  private pointerY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d canvas");
    this.context = context;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * ratio);
    this.canvas.height = Math.round(rect.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  // scales with the screen so a phone is not a snow globe and a monitor not empty
  budget() {
    return Math.round(Math.min(420, Math.max(120, (this.width * this.height) / 4000)));
  }

  private make(x: number, y: number): Particle {
    const depth = 0.35 + Math.random() * 0.65;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
    const speed = (3 + Math.random() * 11) * depth;
    return {
      x,
      y,
      velocityX: 0,
      velocityY: 0,
      driftX: Math.cos(angle) * speed,
      driftY: Math.sin(angle) * speed,
      size: (0.5 + Math.random() * 1.3) * (0.6 + depth * 0.6),
      alpha: 0.18 + Math.random() * 0.55 * depth,
      depth,
      phase: Math.random() * Math.PI * 2,
      twinkle: 0.4 + Math.random() * 1.2,
      heat: 0,
      cool: Math.random() < 0.35,
      shocked: false,
      born: this.time,
      fadeIn: 0,
    };
  }

  // faint dust that is already there when the dark lifts
  ambient(count: number, fadeIn: number) {
    for (let index = 0; index < count; index++) {
      const particle = this.make(Math.random() * this.width, Math.random() * this.height);
      particle.alpha *= 0.55;
      particle.fadeIn = fadeIn;
      this.particles.push(particle);
    }
  }

  // the finished state, used when the intro is skipped or does not play
  seed(count: number) {
    for (let index = 0; index < count; index++) {
      this.particles.push(this.make(Math.random() * this.width, Math.random() * this.height));
    }
  }

  burst(x: number, y: number, directionX: number, directionY: number, count: number) {
    const along = Math.atan2(directionY, directionX);
    for (let index = 0; index < count; index++) {
      const particle = this.make(x + (Math.random() - 0.5) * 24, y + (Math.random() - 0.5) * 24);
      const roll = Math.random();
      let angle: number;
      let speed: number;
      if (roll < 0.45) {
        // carried on by the ram, a narrow cone forward
        angle = along + (Math.random() - 0.5) * 0.9;
        speed = 280 + Math.random() * 900;
      } else if (roll < 0.6) {
        // kicked back out of the entry side
        angle = along + Math.PI + (Math.random() - 0.5) * 0.9;
        speed = 160 + Math.random() * 420;
      } else {
        angle = Math.random() * Math.PI * 2;
        speed = 120 + Math.random() * 640;
      }
      particle.velocityX = Math.cos(angle) * speed;
      particle.velocityY = Math.sin(angle) * speed;
      particle.heat = 0.6 + Math.random() * 0.4;
      particle.size *= 1.15;
      particle.alpha = Math.min(1, particle.alpha * 1.3);
      particle.shocked = true;
      this.particles.push(particle);
    }
  }

  shock(x: number, y: number) {
    const reach = Math.hypot(Math.max(x, this.width - x), Math.max(y, this.height - y));
    this.shockwaves.push({ x, y, born: this.time, reach });
    this.flareAt = this.time;
    this.flareX = x;
    this.flareY = y;
  }

  pointer(x: number, y: number) {
    this.pointerTargetX = (x / this.width - 0.5) * 2;
    this.pointerTargetY = (y / this.height - 0.5) * 2;
  }

  step(deltaSeconds: number) {
    const delta = Math.min(deltaSeconds, 1 / 20);
    this.time += delta;
    const follow = 1 - Math.exp(-delta * 3);
    this.pointerX += (this.pointerTargetX - this.pointerX) * follow;
    this.pointerY += (this.pointerTargetY - this.pointerY) * follow;

    const settle = 1 - Math.exp(-delta * DRAG);
    const margin = 24;
    for (const particle of this.particles) {
      // the shockwave pushes the dust it passes, once
      if (!particle.shocked) {
        for (const wave of this.shockwaves) {
          const radius = wave.reach * easeOut(clamp01((this.time - wave.born) / SHOCK_DURATION));
          const distance = Math.hypot(particle.x - wave.x, particle.y - wave.y);
          if (distance < radius) {
            const push = (260 * particle.depth) / Math.max(1, distance / 120);
            particle.velocityX += ((particle.x - wave.x) / Math.max(distance, 1)) * push;
            particle.velocityY += ((particle.y - wave.y) / Math.max(distance, 1)) * push;
            particle.heat = Math.max(particle.heat, 0.35);
            particle.shocked = true;
          }
        }
      }
      particle.velocityX += (particle.driftX - particle.velocityX) * settle;
      particle.velocityY += (particle.driftY - particle.velocityY) * settle;
      particle.x += particle.velocityX * delta;
      particle.y += particle.velocityY * delta;
      particle.heat *= Math.exp(-delta * 1.6);

      // only slow dust wraps, so the burst leaves the screen instead of reappearing
      if (Math.hypot(particle.velocityX, particle.velocityY) < 60) {
        const spanX = this.width + margin * 2;
        const spanY = this.height + margin * 2;
        particle.x = ((((particle.x + margin) % spanX) + spanX) % spanX) - margin;
        particle.y = ((((particle.y + margin) % spanY) + spanY) % spanY) - margin;
      }
    }
    this.shockwaves = this.shockwaves.filter((wave) => this.time - wave.born < SHOCK_DURATION);
  }

  draw() {
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    context.globalCompositeOperation = "lighter";

    for (const particle of this.particles) {
      const shine = 0.72 + 0.28 * Math.sin(this.time * particle.twinkle + particle.phase);
      const arrival = particle.fadeIn > 0 ? clamp01((this.time - particle.born) / particle.fadeIn) : 1;
      const alpha = Math.min(1, particle.alpha * shine * arrival + particle.heat * 0.6);
      if (alpha < 0.01) continue;
      const x = particle.x + this.pointerX * 14 * particle.depth;
      const y = particle.y + this.pointerY * 10 * particle.depth;
      const size = particle.size * (1 + particle.heat * 1.4);
      const colour = particle.cool ? `rgba(196, 210, 255, ${alpha})` : `rgba(245, 245, 245, ${alpha})`;
      const speed = Math.hypot(particle.velocityX, particle.velocityY);
      if (speed > 140) {
        // fast dust is drawn as a spark, a short streak along its path
        context.strokeStyle = colour;
        context.lineWidth = size * 1.4;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(x - particle.velocityX * 0.035, y - particle.velocityY * 0.035);
        context.lineTo(x, y);
        context.stroke();
      } else {
        context.fillStyle = colour;
        context.beginPath();
        context.arc(x, y, size, 0, Math.PI * 2);
        context.fill();
      }
    }

    this.drawBeam();
    this.drawShock();
    context.globalCompositeOperation = "source-over";
  }

  private drawBeam() {
    const beam = this.beam;
    if (!beam || beam.fade >= 1) return;
    const context = this.context;
    const from = Math.max(0, beam.head - beam.tail);
    const to = Math.min(beam.length, beam.head);
    if (to <= from) return;
    const fromX = beam.startX + beam.directionX * from;
    const fromY = beam.startY + beam.directionY * from;
    const toX = beam.startX + beam.directionX * to;
    const toY = beam.startY + beam.directionY * to;
    const strength = 1 - easeOut(beam.fade);

    const gradient = context.createLinearGradient(fromX, fromY, toX, toY);
    const headInside = beam.head <= beam.length;
    gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
    gradient.addColorStop(headInside ? 0.85 : 0.5, `rgba(255, 255, 255, ${strength})`);
    gradient.addColorStop(1, headInside ? `rgba(255, 255, 255, ${strength})` : `rgba(255, 255, 255, ${strength * 0.6})`);

    context.lineCap = "round";
    // three passes read as a glowing core without a blur filter
    const passes: Array<[number, string]> = [
      [18 * strength + 2, `rgba(150, 175, 255, ${0.07 * strength})`],
      [6 * strength + 1, `rgba(200, 215, 255, ${0.22 * strength})`],
    ];
    for (const [lineWidth, colour] of passes) {
      context.strokeStyle = colour;
      context.lineWidth = lineWidth;
      context.beginPath();
      context.moveTo(fromX, fromY);
      context.lineTo(toX, toY);
      context.stroke();
    }
    context.strokeStyle = gradient;
    context.lineWidth = 1.6 * strength + 0.4;
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.lineTo(toX, toY);
    context.stroke();

    if (headInside) {
      const glow = context.createRadialGradient(toX, toY, 0, toX, toY, 36);
      glow.addColorStop(0, "rgba(255, 255, 255, 0.9)");
      glow.addColorStop(0.25, "rgba(210, 222, 255, 0.35)");
      glow.addColorStop(1, "rgba(160, 185, 255, 0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(toX, toY, 36, 0, Math.PI * 2);
      context.fill();
    }
  }

  private drawShock() {
    const context = this.context;
    for (const wave of this.shockwaves) {
      const progress = clamp01((this.time - wave.born) / SHOCK_DURATION);
      const radius = wave.reach * easeOut(progress);
      const alpha = 0.55 * (1 - progress) * (1 - progress);
      context.strokeStyle = `rgba(220, 230, 255, ${alpha})`;
      context.lineWidth = 1 + 10 * (1 - progress);
      context.beginPath();
      context.arc(wave.x, wave.y, radius, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(wave.x, wave.y, radius * 0.82, 0, Math.PI * 2);
      context.stroke();
    }

    if (this.flareAt >= 0) {
      const progress = clamp01((this.time - this.flareAt) / FLARE_DURATION);
      if (progress < 1) {
        const alpha = 0.7 * (1 - easeOut(progress));
        const halfWidth = this.width * (0.3 + 0.5 * easeOut(progress));
        const gradient = context.createLinearGradient(this.flareX - halfWidth, 0, this.flareX + halfWidth, 0);
        gradient.addColorStop(0, "rgba(170, 195, 255, 0)");
        gradient.addColorStop(0.5, `rgba(235, 240, 255, ${alpha})`);
        gradient.addColorStop(1, "rgba(170, 195, 255, 0)");
        context.fillStyle = gradient;
        context.fillRect(this.flareX - halfWidth, this.flareY - 1, halfWidth * 2, 2);
      }
    }
  }
}
