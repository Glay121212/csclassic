# 1.6 Pug Finder

Browser matchmaking for Counter-Strike 1.6 5v5 classic pugs. Pick a region (Europe, Americas, Asia) and the maps you accept (Inferno, Dust2, Mirage). When 10 players are queued in a region, the server builds a match, balances teams by rating, and picks a random player to host. No Steam login: players just pick a name.

- The **server owns** the queue, matches, results and ratings, so players cannot edit their own rating.
- A result counts when **6 of 10** players report the same winner. Ratings are Elo (K=24, start 1000).
- Ranks: Recruit, Regular (900), Veteran (1100), Elite (1300), Legend (1500+).
- The host starts a normal `hlds` server and posts their public IP:port. The others get a `connect` line.

## Run locally

    npm install
    npm start          # http://localhost:3000

Simulate a full queue of 10 players: `PORT=3000 node test/simulate.js` (with the server running).

## Put it on GitHub

    git init && git add . && git commit -m "1.6 pug finder"
    git branch -M main
    git remote add origin https://github.com/YOUR-NAME/pug16.git
    git push -u origin main

## Put it online at your own domain

GitHub Pages cannot run this, because it only hosts static files and the app needs a server that stays running (WebSockets). Use any Node host and point your domain at it:

1. **Render, Railway or Fly.io** (easiest): create a new web service from your GitHub repo. Build command `npm install`, start command `npm start`. Add a persistent disk and set `DATA_DIR` to its path (otherwise ratings reset on every deploy). Then add your domain in the host's custom domain settings and create the DNS record they show you. HTTPS is automatic and required, because the page uses `wss://`.
2. **Your own VPS:** `docker build -t pug16 . && docker run -d -p 3000:3000 -v pug16data:/data --restart always pug16`, then put Caddy or nginx in front for HTTPS and WebSocket proxying on `/ws`.

## Important notes

- **One server for all regions** is fine to start; regions are just separate queues. Player ping to the host is what matters, and the host is a player.
- **Smurfing and multi-accounts:** accounts are anonymous (a token in the browser), so someone can create a new account. Add IP limits or sign-in later if that becomes a problem.
- **Hosts need a reachable server:** the host must forward UDP port 27015 on their router. Consider requiring this in your rules.
- Ratings live in `DATA_DIR/players.json`. Back it up. For heavy traffic, swap it for SQLite or Postgres.
