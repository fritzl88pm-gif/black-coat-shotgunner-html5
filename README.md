# Black Coat Shotgunner

A complete static HTML5 Canvas prototype for a one-level side-scroller shooter. It uses plain files only and builds all pixel sprites procedurally on an offscreen canvas at runtime.

## Run

Open `index.html` in a browser. No install, build step, server, or network access is required.

## Controls

- Move: `A` / `D` or left / right arrows
- Jump: `W`, up arrow, or space
- Shoot: `J` or `X`
- Reload: `R`
- Mobile: use the visible left, right, jump, shoot, and reload touch buttons

## Gameplay

Fight through the horizontal level, use platforms and cover, pick up medkits and shell boxes, defeat the tough enemy near the extraction zone, then reach the finish sign. The player has health, shells, reload timing, shotgun spread, knockback, hit stun, death, and restart states.

## Debug Smoke Hook

The game starts automatically and exposes `window.__gameDebug` for smoke tests:

```js
window.__gameDebug.state
window.__gameDebug.playerCount
window.__gameDebug.enemyCount
window.__gameDebug.snapshot()
window.__gameDebug.restart()
```

## Deployment

Deploy the four static files (`index.html`, `styles.css`, `game.js`, `README.md`) to any static host, or serve the directory with any basic file server.
