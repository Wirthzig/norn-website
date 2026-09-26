# Norn website

The website of Norn. Home with the intro, Impressum, Datenschutz and AGB. A static
site, Vite and a little React for the thinking orbs, deployed by GitHub Actions to
`wirthzig.github.io/norn-website`.

```bash
npm install
npm run dev       # http://localhost:5173/norn-website/
npm run build     # static site in dist/
```

## The intro

`src/intro.ts` runs the timeline, `src/particles.ts` paints the streak, the sparks and the
dust, `src/post.ts` films that scene through a WebGL lens (focus pull, overexposure,
bloom, colour fringing, zoom blur, shake and a pressure wave that bends light). During
the intro the wordmark is painted into the scene from the same paths as the SVG, which
takes over at the end. A cover hides the cut until the streak's head passes it, so logo
and light cannot drift apart. Without WebGL the SVG and a plain canvas do the same with
less.

- Plays when someone arrives from outside. Coming back from a page of the site, or with
  back and forward, it opens on the finished logo. Nothing is stored on the device, so
  the Datenschutz page can say so
- Skips on click, tap, scroll, any key, or the button
- Under reduced motion the finished logo fades in and the dust stands still

## Checking it

```bash
npx vite --port 5610 &
npm run shoot -- http://localhost:5610/norn-website/
```

Screenshots of intro frames, every page, the skip and reduced motion, desktop and phone,
plus a real time recording, in `shots/`. `?at=1800` freezes the intro at that millisecond,
in the dev server only.

## Sources

Logo and tokens are copied from the Norn design system in the private `youtube-bot`
repo, `design-system/assets/Logos/` and `design-system/src/tokens.css`. Change them there
first. The legal texts start from `youtube-bot/docs/legal/`. Everything in red on those
pages is a placeholder, and none of it is legal advice.

## Deploy

Every push to `main` builds and deploys. In the repo settings, Pages source must be set
to GitHub Actions. A custom domain later is a `public/CNAME` file, a DNS record and
`SITE_BASE=/` for the build.
