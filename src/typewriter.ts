// the word in the pill deletes itself and types the next one. rare and decorative, so
// it waits for the intro and under reduced motion the first word simply stays

const WORDS = ["automating", "optimizing", "building"];
const TYPE_DELAY = 75;
const DELETE_DELAY = 40;
const HOLD = 2200;

export function startTypewriter() {
  const word = document.querySelector<HTMLElement>(".word-pill .word");
  if (!word) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let index = 0;
  const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  const run = async () => {
    for (;;) {
      await wait(HOLD);
      const current = WORDS[index];
      for (let length = current.length - 1; length >= 0; length--) {
        word.textContent = current.slice(0, length);
        await wait(DELETE_DELAY);
      }
      index = (index + 1) % WORDS.length;
      const next = WORDS[index];
      await wait(180);
      for (let length = 1; length <= next.length; length++) {
        word.textContent = next.slice(0, length);
        await wait(TYPE_DELAY);
      }
    }
  };

  // the intro announces when it is done, arriving without one starts right away
  if (document.documentElement.dataset.intro === "play") {
    window.addEventListener("norn:intro-done", () => void run(), { once: true });
  } else {
    void run();
  }
}
