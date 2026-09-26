import "./styles/site.css";
import { startIntro } from "./intro";
import { revealOnScroll } from "./reveal";

startIntro();
revealOnScroll();

// react and the orbs are below the fold, so they load after the intro has what it needs
const loadOrbs = () => import("./orbs").then((module) => module.mountOrbs());
if ("requestIdleCallback" in window) requestIdleCallback(loadOrbs, { timeout: 2000 });
else setTimeout(loadOrbs, 600);
