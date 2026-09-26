// the scroll reveal recipe from the animate skill. marketing only, fires once
export function revealOnScroll() {
  const elements = document.querySelectorAll<HTMLElement>(".reveal");
  if (!("IntersectionObserver" in window) || elements.length === 0) return;
  document.documentElement.classList.add("js-reveal");
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute("data-visible", "");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -80px 0px" },
  );
  // siblings that enter together arrive a beat apart instead of all at once
  elements.forEach((element) => {
    const siblings = element.parentElement ? Array.from(element.parentElement.children).filter((child) => child.classList.contains("reveal")) : [];
    element.style.transitionDelay = `${Math.max(0, siblings.indexOf(element)) * 60}ms`;
    observer.observe(element);
  });
}
