import { createRoot } from "react-dom/client";
import { ThinkingOrb, type OrbState } from "thinking-orbs";

// every element with data-orb gets a thinking orb in that state. they sit on white,
// so the ink is dark, and they freeze under reduced motion
export function mountOrbs() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll<HTMLElement>("[data-orb]").forEach((element) => {
    const state = element.dataset.orb as OrbState;
    const dots = element.dataset.orbDots ? Number(element.dataset.orbDots) : undefined;
    createRoot(element).render(
      <ThinkingOrb state={state} size={64} theme="light" dots={dots} paused={reduce} aria-hidden="true" />,
    );
  });
}
