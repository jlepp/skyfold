# AGENT.md

Instructions for editing and deploying SKYFOLD. See `README.md` for what the
game is and how it plays.

## Editing

- Plain static site: HTML, CSS and ES modules. **No build step, no
  `node_modules`, no `package.json`.** Edit the files in place.
- Three.js is vendored in `vendor/` (`three.module.js` + `three.core.js`, which
  must stay in the same folder). Do not add CDN dependencies; the Press Start
  2P font is the only external runtime request.
- Layout: `index.html` (markup/overlays), `css/style.css`, and `js/` modules
  (`main.js` state machine and render loop, `input.js`, `audio.js`, `plane.js`,
  `track.js` obstacle generation and level scaling, `furniture.js`).
- Level difficulty lives in `levelScale()` in `js/track.js`; level-1 constants
  are at the top of `js/main.js`. If you change `BASE_DISTANCE`, keep
  `BASE_LEVEL_DISTANCE` in `track.js` in sync.
- If you change level scaling or add/remove files, update the tables and layout
  in `README.md` too.
- Tilt input only works in a secure context, so test on the HTTPS tunnel URL
  (or `localhost` / desktop keyboard controls), not the LAN IP.

## Cache busting (required on every change)

Phones and the Cloudflare edge cache aggressively, so every asset URL carries a
`?v=<key>` query string. **Increment the key whenever you change any file under
`index.html`, `css/` or `js/`.** If you forget, players keep running stale code.

The key has the form `YYYYMMDD` plus a letter suffix (`20261113b`). Use today's
date; if it is the same date as the current key, bump the letter (`b` -> `c`),
otherwise use the new date with `a`.

Update **every** occurrence to the **same** key (ES modules are keyed by full
URL, so a mismatched key loads a module twice and breaks shared state):

- `index.html`: the `css/style.css?v=...` link and the `js/main.js?v=...` script
- `js/main.js`: imports of `input.js`, `audio.js`, `plane.js`, `track.js`
- `js/track.js`: import of `furniture.js`

Find them all with:

```sh
grep -rn "?v=" index.html js css
```

Replace them in one go, then re-run the grep and confirm every line shows the
new key. If you add a new module or stylesheet, give its import the same
`?v=<key>`. Changes to `vendor/` rarely need a bump, but bump anyway if you
upgrade Three.js.

## Deploying

The game is served from this directory by `deploy/server.py`, a static server
on `127.0.0.1:8082` that sends `Cache-Control: no-cache`. It runs as the
`flying-game` systemd service and is exposed through the Cloudflare tunnel at
`https://skyfold.lepp.ca`.

- **Static file changes** (HTML/CSS/JS): nothing to restart. Files are served
  straight from disk. Bump the cache key (above) and reload.
- **Changes to `deploy/server.py` or `deploy/flying-game.service`**: reinstall
  and restart:

  ```sh
  sudo cp deploy/flying-game.service /etc/systemd/system/flying-game.service
  sudo systemctl daemon-reload
  sudo systemctl restart flying-game.service
  ```

- **First-time setup**: same copy, then
  `sudo systemctl enable --now flying-game.service`, and add the public
  hostname in the Cloudflare dashboard (the tunnel is remotely managed; editing
  `~/.cloudflared/config.yml` does nothing). Use service type **HTTP**, URL
  `localhost:8082`. Details are in `README.md`.

Verify a deploy:

```sh
systemctl status flying-game.service
curl -sI http://127.0.0.1:8082/ | grep -i cache-control   # expect: no-cache
curl -s http://127.0.0.1:8082/ | grep "?v="                 # expect the new key
```

## Git

Commit directly to `main`. Keep commit descriptions to 10 words or fewer.
