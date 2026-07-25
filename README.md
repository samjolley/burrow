# Burrow

A habit pet for AuDHD adults. One creature, one daily action, one screen, under five seconds.

No streaks. No penalties. No reminders. The only number is "days together", a count of
unique check-in days that can only go up. Missed days are never counted, displayed, or
referenced.

**Live:** https://samjolley.github.io/burrow/
**Spec:** `D:\PARA\30-Resources\Business\Business-Ideas\2026-07-23-habit-pet-weekend-prototype-spec.md`

This is a validation prototype with a pre-registered continue/kill gate, not a product.

## Run the tests

The date logic is the load-bearing part; both adversarial reviews rated it High severity.
It is pure, takes an injected clock, and is covered by a table.

```bash
cd /d/sites/burrow && TZ=America/Detroit node --test
```

PowerShell:

```powershell
$env:TZ = "America/Detroit"; node --test; Remove-Item Env:TZ
```

The timezone is not optional — the suite asserts both US DST transitions and hard-fails
at startup if the resolved zone is wrong, rather than producing confusing failures.

## Files

| File | What |
|---|---|
| `index.html` | Markup, all CSS, the inline creature SVG, and the app wiring in one module script |
| `state.js` | Pure logic. No DOM, no localStorage, no `Date.now()` |
| `state.test.js` | The assertion table |
| `sw.js` | Service worker |
| `manifest.webmanifest` | PWA manifest |
| `icon.svg` → `icon-*.png`, `apple-touch-icon.png` | `node make-icons.mjs` regenerates the PNGs |

No framework, no build step, no `package.json`, no dependencies.

## Deploy

```bash
git push origin main
```

GitHub Pages publishes from `main` at the repo root. First publish can take ~10 minutes;
subsequent ones are usually under a minute. `.nojekyll` removes the Jekyll build stage.

## Update-path test (run once on each phone)

1. App installed and running. Note the build stamp in the save corner and the days-together number.
2. Bump **both** `CACHE` in `sw.js` and `BUILD` in `index.html`. Commit and push.
3. Confirm from a desktop browser with a hard reload that the live URL serves the new stamp.
   **Do not proceed until this is true** — otherwise you will debug the service worker when
   the problem is Pages latency.
4. On the phone: swipe the app fully closed. Relaunch. It may still show the old build on this
   launch — that launch fetches and activates the new worker. Close and relaunch again.
5. Expect the new build. Still old after the second relaunch is a real bug.
6. **Days-together must be unchanged.** A cache bump must never touch `localStorage`.
7. Airplane mode, relaunch: expect the new build, fully functional, and a check-in that persists.
8. Back online, relaunch: the check-in from step 7 is still there.

## Save / restore

The save corner shows the state JSON and accepts a pasted one back. Restore validates the
schema and every date, dedupes, pulls `lastOpenedDay` forward to the newest check-in (so a
restored old export does not fire a warm-return greeting for a gap that never happened), and
requires an explicit confirm. Extra keys in the pasted JSON are dropped, not merged.

Test it on an iPhone with no dev tools: copy the export to Notes, paste a deliberately
corrupted version (delete a digit from a date) and confirm you get a readable error and no
state change, then delete the app, reinstall, and restore for real.

## Deliberate ceilings

Marked `ponytail:` in the source. Each is a known limit with a stated upgrade path, not an oversight.

- `dayKey` uses a noon anchor in the step-back. Correct in every zone; one character of cost.
- **No 3am timer.** `pageshow` / `visibilitychange` / `focus` cover the boundary, and iOS
  suspends background timers anyway.
- **`lastOpenedDay` only advances.** A device clock set forward and then back freezes napping
  detection until the real date catches up. The alternative is a spurious warm greeting from a
  five-minute clock slip, which is worse for the one moment this prototype exists to test.
- **One check-in per day means one per *device-reported* virtual-day key.** A changed device
  clock can bend it. There is no trusted time source and this is a family test.
- **The service worker shell list is three entries.** Do not add the manifest or the PNGs "for
  completeness" — a single 404 rejects the whole `cache.addAll` and leaves the app broken
  offline. The OS fetches icons at install time while online.
- **`fetch(req, { cache: 'no-cache' })` in the worker is load-bearing.** GitHub Pages serves
  `Cache-Control: max-age=600`, so a plain `fetch()` is satisfied by the browser HTTP cache and
  "network-first" quietly returns a build up to ten minutes stale, then caches it.
- **Network-first for everything, one strategy, no per-asset routing.**
- **`skipWaiting` + `clients.claim`, no auto-reload on `controllerchange`.** Auto-reload can loop
  and would yank the screen away mid-check-in. Close and reopen is the documented path.
- **No `id` in the manifest.** `start_url` and `scope` resolve against the manifest URL, so `./`
  is right for both. `id` resolves against the **origin**, so `"./"` would become
  `https://samjolley.github.io/` and collide with the user site there. Omitted, it defaults to the
  processed `start_url`, which is already correct. If one is ever needed the only correct value is
  `"/burrow/"`. Do not "fix" this to `./`.
- **Restore uses native `confirm()`.** A custom modal is 40 lines to say the same sentence.
- **`make-icons.mjs` borrows sharp** from `D:\sites\samjolley-site` rather than adding
  `node_modules` and a lockfile to a repo with no build step. Fallback: `npx sharp-cli`.
- **No `package.json`.** Node 24 detects ESM in `.js` by default. If `node --test` ever says
  "Cannot use import statement outside a module", try `node --experimental-detect-module --test`,
  and only then add a one-line `{"type":"module"}`.
- **`?dev=1` bypasses the install gate** for desktop work. Family members will never type it,
  which is all the gating this needs.

## Why the install gate exists

Home-screen web apps get their own storage, separate from Safari's. If someone hatches a
creature in Safari and then installs, the installed app opens empty and the creature is gone.
So the hatch flow is **absent from the DOM** in browser mode — not disabled, absent — and
browser mode never reads or writes `localStorage` at all. The bug is prevented by
construction rather than by remembering to install first.
