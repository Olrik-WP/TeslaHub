# TeslaHub

[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/Olrik-WP/TeslaHub?color=brightgreen)](https://github.com/Olrik-WP/TeslaHub/releases/latest)
[![Build and Push Docker Images](https://img.shields.io/github/actions/workflow/status/Olrik-WP/TeslaHub/docker-publish.yml?label=Docker%20Build)](https://github.com/Olrik-WP/TeslaHub/actions/workflows/docker-publish.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/deltawp/teslahub-api?label=docker%20pulls)](https://hub.docker.com/r/deltawp/teslahub-api)
[![Docker Image Size](https://img.shields.io/docker/image-size/deltawp/teslahub-api/latest?label=API%20image)](https://hub.docker.com/r/deltawp/teslahub-api)

A self-hosted companion dashboard for [TeslaMate](https://github.com/teslamate-org/teslamate), optimized for the Tesla in-car browser.

![TeslaHub Home](docs/screenshots/home.png)

| Charging | Trips | Vampire Drain |
|:---:|:---:|:---:|
| ![Charging](docs/screenshots/charge.png) | ![Trips](docs/screenshots/trips.png) | ![Vampire Drain](docs/screenshots/vampire.png) |

<details>
<summary>Mobile responsive</summary>

![TeslaHub Mobile](docs/screenshots/mobile.jpeg)
</details>

TeslaHub reads your existing TeslaMate data (read-only) and provides a touch-first, dark-themed interface with:

- Vehicle status, battery health, and position at a glance
- Charging sessions with manual cost tracking and DC charging curves
- Trip history with expandable details, efficiency metrics, and route visualization
- Vampire drain analysis with sleep health verdict and power analogies
- Interactive map with historical data
- Cost analytics by location, month, and period
- Multi-car support
- Internationalization (English / French)
- **Optional** real-time Sentry / break-in alerts via Tesla Fleet Telemetry — see [Security Alerts](#security-alerts-optional)

TeslaMate remains your telemetry source. TeslaHub is the UX layer.

## Architecture

```
Your Server (Docker)
├── TeslaMate           (existing)
├── PostgreSQL          (existing — hosts both teslamate and teslahub databases)
├── Mosquitto           (existing or new — MQTT broker)
├── Grafana             (existing)
├── TeslaHub Init       (one-shot — creates DB users automatically)
├── TeslaHub API        (ASP.NET Core 9 — reads TeslaMate DB + MQTT live data)
└── TeslaHub Web        (React + Caddy — serves the UI)
```

TeslaHub connects to your existing PostgreSQL instance via the Docker internal network, just like Grafana does. Your TeslaMate database is **never modified** — TeslaHub uses a read-only user.

Optionally, TeslaHub also connects to TeslaMate's MQTT broker to receive **live vehicle data** (door/trunk/frunk status, lock state, Sentry Mode, TPMS warnings, preconditioning). See [MQTT Setup](#mqtt-setup-live-vehicle-status) below.

---

## Installation

### Prerequisites

- A running [TeslaMate](https://docs.teslamate.org/docs/installation/docker) installation with Docker Compose
- Docker and Docker Compose v2+

### Step 1 — Add TeslaHub variables to your `.env`

In the same directory as your TeslaMate `docker-compose.yml`, add these variables to your `.env` file:

```env
# TeslaHub database passwords (choose strong passwords)
TESLAHUB_READER_PASS=choose_a_strong_password_1
TESLAHUB_APP_PASS=choose_a_strong_password_2

# TeslaHub admin login
TESLAHUB_ADMIN_USER=admin
TESLAHUB_ADMIN_PASSWORD=choose_a_strong_password_3

# Session duration (days the browser stays logged in)
TESLAHUB_SESSION_DAYS=30

# JWT secret — REQUIRED, min 32 characters. The API refuses to start
# without it. It is also used to derive the AES-GCM key that encrypts
# Tesla OAuth tokens at rest, so DO NOT change it once your stack has
# data (you would lose access to the encrypted blobs).
TESLAHUB_JWT_SECRET=generate_a_64_char_random_string

# Optional — custom map tiles (default: OpenStreetMap)
# MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png

# Optional — restrict access by IP (empty = allow all)
# TESLAHUB_ALLOWED_IPS=192.168.1.0/24

# Optional — MQTT for live vehicle status (doors, trunk, lock, sentry...)
# See "MQTT Setup" section below
MQTT_HOST=mosquitto
MQTT_PORT=1883
# MQTT_USER=
# MQTT_PASSWORD=
```

> **Tip:** Generate a JWT secret with: `openssl rand -hex 32`

**If you don't use a `.env` file**, add the variables directly in the `environment:` section of each service (see Step 2).

### Step 2 — Add TeslaHub services to your `docker-compose.yml`

Add the following services to your **existing** TeslaMate `docker-compose.yml`:

```yaml
  teslahub-init:
    image: deltawp/teslahub-init:latest
    restart: "no"
    environment:
      - TM_DB_HOST=database
      - TM_DB_PORT=5432
      - TM_DB_NAME=${TM_DB_NAME:-teslamate}
      - TM_DB_USER=${TM_DB_USER:-teslamate}
      - TM_DB_PASS=${TM_DB_PASS}
      - TESLAHUB_READER_PASS=${TESLAHUB_READER_PASS}
      - TESLAHUB_APP_PASS=${TESLAHUB_APP_PASS}
    depends_on:
      - database

  teslahub-api:
    image: deltawp/teslahub-api:latest
    restart: always
    environment:
      - TM_DB_HOST=database
      - TM_DB_PORT=5432
      - TM_DB_NAME=${TM_DB_NAME:-teslamate}
      - TM_DB_USER=teslahub_reader
      - TM_DB_PASSWORD=${TESLAHUB_READER_PASS}
      - APP_DB_HOST=database
      - APP_DB_PORT=5432
      - APP_DB_NAME=teslahub
      - APP_DB_USER=teslahub_app
      - APP_DB_PASSWORD=${TESLAHUB_APP_PASS}
      - TESLAHUB_ADMIN_USER=${TESLAHUB_ADMIN_USER:-admin}
      - TESLAHUB_ADMIN_PASSWORD=${TESLAHUB_ADMIN_PASSWORD}
      - TESLAHUB_SESSION_DAYS=${TESLAHUB_SESSION_DAYS:-30}
      - TESLAHUB_JWT_SECRET=${TESLAHUB_JWT_SECRET}
      - MAP_TILE_URL=${MAP_TILE_URL:-https://tile.openstreetmap.org/{z}/{x}/{y}.png}
      - TESLAHUB_ALLOWED_IPS=${TESLAHUB_ALLOWED_IPS:-}
      - MQTT_HOST=${MQTT_HOST:-}
      - MQTT_PORT=${MQTT_PORT:-1883}
      - MQTT_USER=${MQTT_USER:-}
      - MQTT_PASSWORD=${MQTT_PASSWORD:-}
      - MQTT_NAMESPACE=${MQTT_NAMESPACE:-}
      - TZ=${TZ:-Europe/Paris}
    ports:
      - "127.0.0.1:4001:8080"
    depends_on:
      - database
      - teslahub-init

  teslahub-web:
    image: deltawp/teslahub-web:latest
    restart: always
    ports:
      - "127.0.0.1:4002:80"
    depends_on:
      - teslahub-api
```

> **Note:** `database` refers to your existing PostgreSQL service name. If yours is named differently (e.g., `db` or `postgres`), adjust the `TM_DB_HOST`, `APP_DB_HOST`, and `depends_on` values accordingly.

> **Without `.env` file?** Replace variables like `${TM_DB_PASS}` with their actual values directly in the YAML.

### Step 3 — Start

```bash
docker compose up -d
```

The `teslahub-init` container will automatically:
1. Wait for PostgreSQL to be ready
2. Create a `teslahub_reader` user (read-only access to your TeslaMate database)
3. Create a `teslahub` database
4. Create a `teslahub_app` user (full access to the TeslaHub database)

Then `teslahub-api` starts and auto-migrates the TeslaHub database schema.

TeslaHub is now available at **http://your-server:4002**.

---

## MQTT Setup (Live Vehicle Status)

TeslaMate publishes real-time vehicle data to an MQTT broker (Mosquitto). Some data — like door/trunk/frunk status, lock state, Sentry Mode, TPMS pressure warnings, and preconditioning — is **only available via MQTT** and is never stored in the PostgreSQL database.

TeslaHub can connect to this MQTT broker to display these live features on the Home page.

### What you need

1. **A Mosquitto broker** running in your Docker stack
2. **TeslaMate with MQTT enabled** (i.e. `DISABLE_MQTT` must NOT be set to `true`)

> **⚠️ Important:** If your TeslaMate has `DISABLE_MQTT=true`, you must remove this line (or set `MQTT_HOST=mosquitto` instead) for MQTT to work. Without it, TeslaMate will not publish any data to the broker and live vehicle status will be unavailable in TeslaHub.

### If you already have Mosquitto

Most TeslaMate installations include Mosquitto. Just add `MQTT_HOST=mosquitto` to your `.env` (or to the `teslahub-api` environment) where `mosquitto` is the Docker service name of your broker.

### If you don't have Mosquitto yet

Add this service to your `docker-compose.yml`:

```yaml
  mosquitto:
    image: eclipse-mosquitto:2
    restart: always
    command: mosquitto -c /mosquitto-no-auth.conf
    ports:
      - "127.0.0.1:1883:1883"
    volumes:
      - mosquitto-data:/mosquitto/data
```

And add `mosquitto-data:` to your `volumes:` section.

Then update your TeslaMate service:
- Remove `DISABLE_MQTT=true`
- Add `MQTT_HOST=mosquitto`

### What happens without MQTT?

TeslaHub works perfectly fine without MQTT. All database-backed features (charging, trips, statistics, battery health, TPMS pressures, climate on/off, temperatures, etc.) continue to work.

Only the following **live features** require MQTT:

| Feature | MQTT Topic |
|---|---|
| Door status (open/closed) | `teslamate/cars/$id/doors_open` |
| Trunk status | `teslamate/cars/$id/trunk_open` |
| Frunk status | `teslamate/cars/$id/frunk_open` |
| Window status | `teslamate/cars/$id/windows_open` |
| Lock state | `teslamate/cars/$id/locked` |
| Sentry Mode | `teslamate/cars/$id/sentry_mode` |
| User present | `teslamate/cars/$id/is_user_present` |
| TPMS warnings | `teslamate/cars/$id/tpms_soft_warning_*` |
| Climate keeper mode | `teslamate/cars/$id/climate_keeper_mode` |
| Preconditioning | `teslamate/cars/$id/is_preconditioning` |

When MQTT is not connected, TeslaHub shows a subtle indicator and hides the body/security panel.

---

## Security Alerts (optional)

TeslaHub can optionally connect to your Tesla account via the official **Tesla Fleet API** to deliver real-time security features that go beyond what TeslaMate can capture — most importantly the `SentryModeStateAware` event raised when Sentry detects activity around the vehicle, and break-in detection. Alerts are pushed to Telegram in seconds.

> ⚠️ **Advanced users only — read this before you start.**
>
> This feature is genuinely useful, but standing it up end-to-end is **significantly harder than the rest of TeslaHub**. You will need to be comfortable with: a public domain name + DNS records (Cloudflare or similar), opening a port on your router, running a reverse proxy (Caddy / nginx) and managing Let's Encrypt certs, building two Go services from source via Docker Compose (Tesla publishes no images), debugging Linux file permissions inside Docker volumes, and reading container logs when something fails.
>
> The "100% self-hosted, zero third party" philosophy is the upside: nothing is shared, nothing leaves your box, no SaaS subscription. The downside is that **everything Tesla, your ISP, your DNS provider, and Caddy normally hide from a paying customer is now your problem**. Several of the steps below have non-obvious failure modes (mTLS perms, Tesla API requiring a signing proxy, snake_case JSON, partner vs user OAuth tokens, Telegram bots needing a `/start`, etc.). The [Troubleshooting](#troubleshooting) section at the end lists every gotcha encountered while bringing this stack up so you can shortcut your own debugging.
>
> If you only want core dashboard + map + history features, **leave Security Alerts disabled** — TeslaHub works fully without it. You can come back any time later.

### What you get

- 🚨 Instant Telegram notification when Tesla Sentry detects activity (`SentryModeStateAware` / `Panic`).
- 🔓 Break-in detection (vehicle locked but a door / trunk / frunk opens).
- 👥 Per-recipient routing: multiple Telegram chats can be configured, each subscribed to specific vehicles, with Sentry and break-in toggles per (recipient, vehicle) pair.
- 📜 Last 500 alerts kept in PostgreSQL with delivery status.
- 🗺️ **Send a destination to your car from the TeslaHub map.** Long-press / tap any spot on the map (or search an address) → click *Send to car*. The destination shows up on the vehicle's central screen as a "Start navigation" prompt.
  - **Sleeping cars are woken up automatically.** TeslaHub fires Tesla's plain-REST `POST /api/1/vehicles/{id}/wake_up` (this endpoint is the only Fleet API command that does *not* go through `tesla-http-proxy` — by Tesla design, since a sleeping car cannot authenticate signed commands), then polls `/vehicles/{id}` with a progressive back-off (2s → 3s → 5s) until `state="online"`, capped at 60s as per Tesla's official best-practice doc. The destination is then sent over the same path as a fully-awake car. Typical wait when the car was asleep on good cellular: **5–15s**.
  - You can tick **multiple cars at once** in the panel to broadcast the same destination to your whole fleet in one click. Each is woken independently and in parallel.
  - **No vampire drain.** A `wake_up` is issued only on explicit user action (a click); TeslaHub never wakes cars in the background or polls them on a schedule for live data — Fleet Telemetry handles that *push*-side. Tesla puts the car back to sleep on its own after ~10–15 min of inactivity. A handful of intentional wake-ups per day costs less than 1% SoC and stays well inside Tesla's $10/month free Fleet API tier.
- 🛠 Full setup wizard inside TeslaHub Settings — copy-paste for every Tesla developer app field, QR code for vehicle pairing, "Send test" button for Telegram.

> **One Fleet API setup powers every TeslaHub feature that talks to the car.** Sentry / break-in alerts and *Send destination to car* both rely on the same Tesla developer app, the same OAuth flow, and the same paired virtual key. Once Security Alerts is configured, *Send to car* lights up automatically (and vice-versa). If you see a "Tesla Fleet API not configured" banner inside the map's Send-to-car panel, complete the wizard at Settings → Security Alerts first.

### Roadmap — more vehicle commands coming

The Tesla Fleet API + virtual-key pairing currently in place gives TeslaHub the technical authority to send any signed command to your car (lock/unlock, frunk/trunk, climate, charge, honk/flash, sentry on/off, etc. — see the [security model](#what-paired-virtual-key-actually-grants)). For now, only the two user-facing features above are wired up:

| Feature | Status |
|---|---|
| Sentry / break-in Telegram alerts | ✅ available |
| Send destination from the map | ✅ available |
| Lock / unlock from the UI | 🛠 planned (with PIN/2FA confirmation) |
| Climate / preconditioning controls | 🛠 planned |
| Frunk / trunk / charge port | 🛠 planned |
| Charge start / stop / set limit | 🛠 planned |

When new commands ship, they'll reuse the **same** Fleet API setup — no extra plumbing required. If you don't enable Security Alerts, none of these features are exposed in the UI.

### Philosophy: 100% self-hosted, zero third party

TeslaHub never relies on a shared backend. Each TeslaHub installation registers its **own** Tesla developer app and runs its **own** Tesla Fleet Telemetry server. Your Tesla tokens, vehicle data, and alerts never leave your machine.

> **Credit:** the architecture is heavily inspired by the excellent open-source project [SentryGuard](https://github.com/abarghoud/SentryGuard) by Anas Barghoud (AGPL-3.0). TeslaHub re-implements the same concepts in C#/.NET so they fit naturally into the existing TeslaHub stack — and crucially, does so **without any shared infrastructure**.

### What you need

- A public domain name (TeslaHub web on a proxied subdomain + a DNS-only telemetry subdomain — see [Telemetry stack](#telemetry-stack-self-hosted-fleet-telemetry-server) below).
- A free Tesla developer app at [developer.tesla.com](https://developer.tesla.com).
- A personal Telegram bot (created in 30 seconds via [@BotFather](https://t.me/BotFather)).

Everything stays on **your** server. No third-party cloud, no shared client_id, no relayed messages.

### Step 1 — Create your Tesla developer app (5 min, free)

> 💡 The same instructions are also displayed inside TeslaHub: open **Settings → Security Alerts** and follow the embedded "0. Create your Tesla developer app" guide. Each value has a one-click copy button.

1. Open [developer.tesla.com](https://developer.tesla.com), click **Sign in** and use your existing Tesla account credentials.
2. From the left menu, go to **Apps**, then click **Create New App**.
3. Fill in the form with:
   - **App Name:** something **unique to you**, e.g. `TeslaHub <yourname>` or `<yourname> Tesla Companion`. ⚠️ App names are global on the Tesla developer portal — generic names like `TeslaHub Self-Hosted` are likely already taken and Tesla will refuse the form with a cryptic validation error. Pick anything personal and you're good.
   - **Description:** `Personal companion dashboard for TeslaMate`
   - **Allowed Origin URL:** `https://teslahub.yourdomain.com` (a trailing `/` is accepted; a sub-path like `/login` is rejected — keep it at the bare domain).
   - **Allowed Redirect URI:** `https://teslahub.yourdomain.com/api/tesla-oauth/callback` — **no trailing slash after `callback`**. Whatever you type here must later match `TESLA_REDIRECT_URI` in your `.env` **byte-for-byte**, otherwise Tesla rejects OAuth with `redirect_uri_mismatch`.
   - **Allowed Returned URL:** same as Origin URL (`https://teslahub.yourdomain.com`).
   - **Scopes:** at minimum `openid`, `offline_access`, `vehicle_device_data`, `vehicle_cmds`. You can tick more (e.g. `energy_*` for Powerwall) — TeslaHub only requests the four above at sign-in time, but having extras enabled now avoids re-creating the app later if you want them.
4. Click **Submit**. Tesla returns a `Client ID` and a `Client Secret`. Keep them safe — the secret is shown only once.

> 💳 **Tesla now requires a billing-enabled account.** During the registration flow Tesla will ask you to add a payment method — this is mandatory even for personal use. The good news: Tesla offers a **$10/month free credit** on Fleet API consumption. A typical TeslaHub setup (1–2 vehicles, Sentry events only) consumes **well under $1/month**, so you stay inside the free tier and nothing is actually billed. You can also set a hard monthly cap in the Tesla developer portal if you want belt-and-braces protection.

### Step 2 — Add the variables to your `.env`

```env
# Optional — Security Alerts (Tesla Fleet API)
TESLA_CLIENT_ID=your_tesla_client_id
TESLA_CLIENT_SECRET=your_tesla_client_secret
TESLA_REDIRECT_URI=https://teslahub.yourdomain.com/api/tesla-oauth/callback

# Region — pick the audience matching your Tesla account region
# EU:    https://fleet-api.prd.eu.vn.cloud.tesla.com   (default)
# NA/AP: https://fleet-api.prd.na.vn.cloud.tesla.com
TESLA_AUDIENCE=https://fleet-api.prd.eu.vn.cloud.tesla.com

# Master switch — set to true to start the telemetry consumer.
# The full feature also requires the Telegram + telemetry stack
# variables documented further down. Default false keeps everything
# off, including for users who do not want this feature.
SECURITY_ALERTS_ENABLED=true
```

### Step 3 — Wire them into your `teslahub-api` service

Add the new variables to the `environment:` block of `teslahub-api` in your `docker-compose.yml`:

```yaml
  teslahub-api:
    environment:
      # ... existing variables ...
      - TESLA_CLIENT_ID=${TESLA_CLIENT_ID:-}
      - TESLA_CLIENT_SECRET=${TESLA_CLIENT_SECRET:-}
      - TESLA_REDIRECT_URI=${TESLA_REDIRECT_URI:-}
      - TESLA_AUDIENCE=${TESLA_AUDIENCE:-}
      - SECURITY_ALERTS_ENABLED=${SECURITY_ALERTS_ENABLED:-false}
```

If you leave the variables empty, the feature simply stays inactive — TeslaHub continues to work as before.

### Step 4 — Restart and connect

```bash
docker compose up -d teslahub-api
```

Open TeslaHub → **Settings** → scroll to the **Security Alerts** card → click **Connect Tesla account**. You will be redirected to `auth.tesla.com`, sign in, and return to TeslaHub. Your Tesla tokens are now stored encrypted with AES-GCM in your local `teslahub` PostgreSQL database and refreshed automatically every ~30 minutes.

> Until you complete this step, the Home page shows a small dismissible banner reminding you that Security Alerts can be set up. The banner disappears automatically as soon as your Tesla account is connected.

### Pairing your vehicles (after Tesla OAuth)

Once your Tesla account is connected, the Settings card unfolds a 3-step wizard:

1. **Generate the public key for your domain.** TeslaHub creates an EC P-256 keypair, encrypts the private key at rest with AES-GCM, and exposes the public key (PEM, `SubjectPublicKeyInfo`) at `https://<your-domain>/.well-known/appspecific/com.tesla.3p.public-key.pem`. The wizard provides a clickable test link so you can confirm Tesla can fetch it.

   > **About the Chrome warning when you click the test link.** New domains containing the word "tesla" are routinely flagged by **Google Safe Browsing** as suspected phishing for a few weeks. You may see a red full-page warning ("Dangerous site"). This is **not** a TLS / certificate problem — your Caddy cert is fine. It's purely Chrome being conservative. Two ways to confirm the endpoint actually works:
   >
   > - **From a terminal:** `curl -v https://teslahub.yourdomain.com/.well-known/appspecific/com.tesla.3p.public-key.pem` — you should get a `-----BEGIN PUBLIC KEY-----` block. Tesla itself fetches the URL with a Go HTTP client that does not consult Safe Browsing, so the call from Tesla will succeed even while Chrome is still warning humans.
   > - **In Chrome:** click *Details* → *Visit this unsafe site*. Chrome will then download or display the PEM. If your browser offers to download the file (rather than render it), open it with a text editor — that's a good sign, it means Caddy is serving the right `.pem` MIME type and not the React SPA.
2. **Register your domain with Tesla** as a third-party partner. TeslaHub calls `POST /api/1/partner_accounts` on your behalf using your account's access token. Tesla pulls your public key from the `.well-known` URL above to confirm.
3. **Pair each vehicle.** TeslaHub generates a QR code pointing to `https://tesla.com/_ak/<your-domain>`. Scan it with your iPhone, the Tesla mobile app opens and asks you to approve TeslaHub's virtual key for the selected vehicle. Repeat for each car. Click *I've approved* in TeslaHub once done.

**Caddy snippet** for the well-known endpoint (already covered if your existing reverse-proxy block sends `/api/*` and the `/.well-known/*` path to `teslahub-api`). Example:

```caddyfile
teslahub.yourdomain.com {
    reverse_proxy /.well-known/appspecific/* teslahub-api:8080
    reverse_proxy /api/*                     teslahub-api:8080
    reverse_proxy /                          teslahub-web:80
}
```

### Telemetry stack (self-hosted Fleet Telemetry server + signing proxy)

This is where the actual Sentry events start flowing into your TeslaHub. **Two extra services** are added on demand via a Docker Compose `profile`:

- `fleet-telemetry` — Tesla's official Go server, terminates the TLS WebSocket from each vehicle and re-publishes signals to your **existing Mosquitto MQTT broker** (the one already running for TeslaMate, no extra broker needed).
- `tesla-http-proxy` — Tesla's official Go HTTP proxy, **mandatory** since firmware 2024.26+ to sign Fleet API write calls (in particular `fleet_telemetry_config`) with your partner private key. Without it, Tesla rejects the call with `400 "must be called through the Vehicle Command HTTP Proxy"`.

#### What you need

- A **separate sub-domain** dedicated to telemetry, e.g. `telemetry.yourdomain.com`.
- That sub-domain must be **DNS-only** on Cloudflare (gray cloud — *not* the orange proxy). The reason: Tesla connects to your server with TLS termination on your origin, and the Cloudflare proxy interferes with the long-lived WebSocket connection used by Fleet Telemetry. DNS-only forwards traffic directly.
- An **inbound port forward** from your router/box to the host on TCP `8443`.
- The Tesla `fleet-telemetry` source code, cloned locally so Docker can build it (Tesla does not publish a pre-built image).

#### DNS — Cloudflare example

```
teslahub.yourdomain.com    A   <your home ip>   🟠 proxied    (web UI + API)
telemetry.yourdomain.com   A   <your home ip>   ⚪ DNS only   (Tesla telemetry)
```

> Security note: DNS-only exposes your origin IP for that sub-domain. Realistic risk for a personal install is low. The Fleet Telemetry server only accepts properly authenticated vehicle connections (signed at the application layer with the partner public key you registered), so unauthenticated connections are dropped.

#### Caddy snippet (provides + renews the TLS cert for `telemetry.*`)

Caddy never serves traffic on this sub-domain — its only job is to **obtain and renew** a Let's Encrypt cert that the `fleet-telemetry` container reads from disk. Add this to your Caddyfile:

```caddyfile
telemetry.yourdomain.com {
    encode gzip zstd
    respond 404
}
```

While you are editing the Caddyfile, double-check that your `teslahub.yourdomain.com` block forwards `/.well-known/appspecific/*` and `/api/*` to the API container — Tesla fetches your partner public key from `/.well-known/appspecific/com.tesla.3p.public-key.pem`, and a SPA fallback would return the React app instead of the PEM.

Reload Caddy:

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
```

Verify the cert was obtained (~30s):

```bash
sudo find /var/lib/caddy -name "telemetry.yourdomain.com.crt"
```

Note the parent path containing `caddy/certificates/...` — you will need it below.

> **Different Caddy install? Find your cert path.** The default in this README assumes Caddy installed as a systemd service from the official Debian/Ubuntu package (`/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory`). Other layouts:
> - **Snap install:** `/var/snap/caddy/current/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory`
> - **Caddy in Docker:** `<host_path_mounted_to_/data>/caddy/certificates/acme-v02.api.letsencrypt.org-directory`
> - **Don't know?** Run: `sudo find / -path '*caddy/certificates/*letsencrypt*' -type d 2>/dev/null | head -1`
>
> Whatever path you end up with, set `CADDY_CERTS_PATH` in your `.env` so the compose mounts pick it up automatically. The `docker-compose.full-example.yml` and `docker-compose.addon.yml` already use that variable.

#### Make the cert readable by the Tesla containers

Both `fleet-telemetry` and `tesla-http-proxy` run as the `nonroot` user (uid `65532`) inside their Docker images. Caddy stores its certificates with mode `700` / `600` for the `caddy` user, so the Tesla containers will crash on first start with `permission denied: /certs/...`.

Open up read-only access for "others" so the containers can read the cert and its key:

```bash
sudo chmod -R o+rX /var/lib/caddy/.local/share/caddy/certificates/
```

> This makes the cert **and** its private key readable by every local user on the host. On a single-tenant box dedicated to your home server this is acceptable — nothing on the public internet sees these files. If your host is multi-tenant, prefer running Caddy as the same `nonroot` (`uid:65532`) user as the Tesla containers and keep mode `600`, or copy the cert into a separate volume owned by uid 65532.

Caddy renews certificates automatically every ~60 days and resets the permissions in the process. Two ways to keep them readable forever:

- **Recommended (works on stock Caddy):** add a tiny daily cron that re-applies the perms:

  ```bash
  sudo crontab -e
  ```
  ```cron
  0 4 * * * chmod -R o+rX /var/lib/caddy/.local/share/caddy/certificates/ 2>/dev/null
  ```

- **Caddy event hook:** a `{ events { on cert_obtained exec ... } }` global block at the top of the Caddyfile. This requires a custom Caddy build with the `events.handlers.exec` module (e.g. via `xcaddy`). On a stock Debian/Ubuntu Caddy install you will get `module not registered: events.handlers.exec` — stick with the cron approach above.

#### Clone Tesla's source repos (no pre-built images)

Tesla does not publish pre-built Docker images for either service. You build them yourself from their open-source repos:

```bash
cd ~/teslamate
git clone https://github.com/teslamotors/fleet-telemetry.git fleet-telemetry-src
git clone https://github.com/teslamotors/vehicle-command.git vehicle-command-src
```

This creates `~/teslamate/fleet-telemetry-src/` and `~/teslamate/vehicle-command-src/` with the Go code and Dockerfiles. Docker Compose will build them on first start (~3–5 min each).

#### Create the runtime config

```bash
cd ~/teslamate
mkdir -p fleet-telemetry
nano fleet-telemetry/config.json
```

Paste this and replace `telemetry.yourdomain.com` with your real sub-domain:

```json
{
  "host": "0.0.0.0",
  "port": 443,
  "log_level": "info",
  "json_log_enable": true,
  "namespace": "tesla_telemetry",
  "tls": {
    "server_cert": "/certs/telemetry.yourdomain.com/telemetry.yourdomain.com.crt",
    "server_key": "/certs/telemetry.yourdomain.com/telemetry.yourdomain.com.key"
  },
  "rate_limit": {
    "enabled": true,
    "message_interval_time": 30,
    "message_limit": 1000
  },
  "records": {
    "V": ["mqtt"],
    "alerts": ["mqtt"],
    "errors": ["logger"]
  },
  "mqtt": {
    "broker": "mosquitto:1883",
    "client_id": "fleet-telemetry",
    "topic_base": "telemetry",
    "qos": 1,
    "retained": false,
    "connect_timeout_ms": 30000,
    "publish_timeout_ms": 2500,
    "keep_alive_seconds": 30
  }
}
```

#### .env additions

```env
# Optional — Security Alerts telemetry stack
TELEMETRY_DOMAIN=telemetry.yourdomain.com
TELEMETRY_PORT=8443

# Where Caddy stored the Let's Encrypt certs (default below works for
# Caddy installed as a systemd service on Debian/Ubuntu — adjust if
# your Caddy install differs, e.g. snap).
CADDY_CERTS_PATH=/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory

# Tell teslahub-api where to find the published telemetry signals
# (defaults below match Mosquitto running in your TeslaMate compose).
TELEMETRY_MQTT_HOST=mosquitto
TELEMETRY_MQTT_PORT=1883
TELEMETRY_MQTT_TOPIC_BASE=telemetry

# Master switch — flip to true to enable the consumer in teslahub-api.
SECURITY_ALERTS_ENABLED=true

# URL of the local tesla-http-proxy used to sign Fleet API write calls.
# When the proxy is part of the compose stack (recommended), the
# default below points to its in-network hostname.
TESLA_COMMAND_PROXY_URL=https://tesla-http-proxy:4443
```

#### Add the new services to your compose

In your main `docker-compose.yml`, add these three services alongside the existing ones (the init container is one-shot and only generates the proxy's local TLS cert on first start):

```yaml
  fleet-telemetry:
    build:
      context: ./fleet-telemetry-src
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "8443:443"
    volumes:
      - /var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory:/certs:ro
      - ./fleet-telemetry/config.json:/etc/fleet-telemetry/config.json:ro
    depends_on:
      - mosquitto
    labels:
      - "com.centurylinklabs.watchtower.enable=false"

  tesla-http-proxy-init:
    image: alpine:3.20
    restart: "no"
    volumes:
      - key-vault:/key-vault
    command:
      - /bin/sh
      - -c
      - |
        set -e
        if [ ! -f /key-vault/proxy.crt ]; then
          apk add --no-cache openssl
          openssl req -x509 -newkey rsa:2048 -nodes -keyout /key-vault/proxy.key \
            -out /key-vault/proxy.crt -days 3650 -subj "/CN=tesla-http-proxy"
        fi
        # CRITICAL: tesla-http-proxy runs as nonroot (uid 65532) and must be
        # able to read both files. We re-apply the perms on every start so
        # that an existing volume from an earlier broken setup is healed.
        chmod 644 /key-vault/proxy.crt /key-vault/proxy.key
        # Same for the partner private key once it has been exported by the
        # TeslaHub UI ("Export private key for the proxy" button).
        if [ -f /key-vault/private.pem ]; then chmod 644 /key-vault/private.pem; fi

  tesla-http-proxy:
    build:
      context: ./vehicle-command-src
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      tesla-http-proxy-init:
        condition: service_completed_successfully
    environment:
      - TESLA_HTTP_PROXY_HOST=0.0.0.0
      - TESLA_HTTP_PROXY_PORT=4443
      - TESLA_HTTP_PROXY_TLS_CERT=/key-vault/proxy.crt
      - TESLA_HTTP_PROXY_TLS_KEY=/key-vault/proxy.key
      - TESLA_KEY_FILE=/key-vault/private.pem
    volumes:
      - key-vault:/key-vault
    expose:
      - "4443"
    # --key-file duplicates the env var on purpose: depending on the
    # vehicle-command release, the Go binary parses the flag more
    # reliably than TESLA_KEY_FILE. --verbose is optional but extremely
    # helpful the first time you bring the stack up — drop it once the
    # proxy is happy.
    command: ["--key-file", "/key-vault/private.pem", "--verbose"]
    labels:
      - "com.centurylinklabs.watchtower.enable=false"
```

> **Permissions inside the `key-vault` volume.** The volume holds three files: the proxy's self-signed `proxy.crt` + `proxy.key` (created by the init container), and the partner `private.pem` (written by `teslahub-api` once you click *Export private key for the proxy* in the UI). All three must end up world-readable inside the volume because the proxy runs as `nonroot` (uid 65532) and the API container that wrote `private.pem` may not match that uid. The init container always re-applies `chmod 644` on container start, which heals any half-broken setup carried over from earlier debugging sessions.
>
> If you ever want to inspect or fix the volume by hand:
>
> ```bash
> # List
> docker run --rm -v <stack>_key-vault:/key-vault alpine ls -la /key-vault
> # Force-fix perms
> docker run --rm -v <stack>_key-vault:/key-vault alpine chmod 644 /key-vault/proxy.key /key-vault/private.pem
> ```
>
> Replace `<stack>` with your compose project name (usually the directory containing `docker-compose.yml`, e.g. `teslamate`).

And **add 1 env var + 1 volume** to your existing `teslahub-api` service:

```yaml
  teslahub-api:
    # ...existing fields...
    environment:
      # ...existing env vars...
      - TESLA_COMMAND_PROXY_URL=${TESLA_COMMAND_PROXY_URL:-}
    volumes:
      - /var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory:/certs:ro
      - key-vault:/key-vault
```

And declare the shared volume at the bottom of the file:

```yaml
volumes:
  # ...existing volumes...
  key-vault:
```

#### Start the stack

```bash
cd ~/teslamate
docker compose up -d --build fleet-telemetry tesla-http-proxy teslahub-api
docker compose logs -f fleet-telemetry
```

The first build takes 5–10 minutes total (Go compilation for both Tesla services + libsodium/libzmq for fleet-telemetry). Subsequent rebuilds are cached.

You should see lines like:
```
fleet-telemetry-1   | {"level":"info","msg":"server started","port":443}
fleet-telemetry-1   | {"level":"info","msg":"connected to MQTT broker"}
tesla-http-proxy-1  | {"level":"info","msg":"listening","port":4443}
```

#### Tell Tesla to start streaming

Open Settings → Security Alerts → in the wizard step 4:

1. **First click "Export private key for the proxy"**. This writes your partner private key (decrypted) to the shared `key-vault` Docker volume so `tesla-http-proxy` can sign Tesla API requests with it. Do this **once**.
2. **Then click "Configure telemetry for all paired vehicles"**. TeslaHub sends a signed `POST /api/1/vehicles/fleet_telemetry_config` request through the proxy, which Tesla accepts. Each paired car will then open a persistent connection to your `fleet-telemetry` container as soon as it's awake.

> **Why two clicks?** Tesla mandates the partner-key signature for `fleet_telemetry_config`. The signing happens in `tesla-http-proxy`, which needs the private key on disk. We keep it encrypted in the database by default and only export it on demand to minimize how long it stays in the clear.

After that, the streaming pipeline is :
```
Vehicle ─► fleet-telemetry ─► Mosquitto MQTT ─► teslahub-api ─► Telegram
```

### Receiving notifications (Telegram)

The final piece is delivery. TeslaHub speaks directly to `api.telegram.org` — there is no intermediate notification service.

> **Do this step _before_ clicking "Configure telemetry" in the wizard.** If telemetry is enabled but no Telegram recipient exists yet, the first real Sentry event raised by your car will be lost (it is logged in the *Recent alerts* panel as "no recipient", but no notification is delivered). The opposite order is harmless: configuring Telegram first costs nothing.

#### Create your personal Telegram bot

1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, pick a display name (e.g. *My TeslaHub Alerts*) and a username ending in `bot`.
3. BotFather gives you an HTTP API token like `123456789:ABCdef...`. Treat this as a secret.
4. **Important:** open your new bot in Telegram and send `/start` to it from _every chat_ that should receive alerts (you, your spouse, etc.). Telegram bots cannot initiate a conversation — without a prior `/start` from the recipient, `api.telegram.org` returns `403 Forbidden: bot can't initiate conversation with a user` and TeslaHub surfaces this as a clear error in the wizard. The same applies to a group or channel: invite the bot first, then send any message.

#### Add the bot token to your `.env`

```env
# Optional — Telegram bot for security alerts
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
```

Restart the API:

```bash
docker compose up -d teslahub-api
```

#### Add recipients

In TeslaHub → **Settings → Security Alerts**, scroll down to *Notification recipients*. For each person who should receive alerts:

1. Find their Telegram chat ID by sending any message to [@userinfobot](https://t.me/userinfobot) on Telegram — it replies with the numeric `id`.
2. Add a recipient (Name + chat ID + language).
3. Click **Send test** — they should receive a Telegram message instantly. If the test fails with `403 Forbidden` / `chat not found`, the recipient has not yet sent `/start` to your bot (or, for groups, the bot was never invited). Fix that and click **Send test** again.
4. In the *Sentry* / *Break-in* matrix below the recipient, tick the vehicles each person should be notified about.

You can have multiple recipients per vehicle, or scope each person to specific cars (e.g. spouse only receives alerts for their own car).

> **Reusing an existing bot (e.g. your Watchtower bot) is fine** — the token is just an API credential. Each recipient still needs to send `/start` to that bot from their own Telegram account.

### What gets detected

| Alert | Trigger | Source |
|---|---|---|
| **Sentry alert** | `SentryModeStateAware` or `SentryModeStatePanic` published by the vehicle | Fleet Telemetry `V` records, field `SentryMode` |
| **Break-in** | `Locked = true` while `DoorState` reports an open door | Fleet Telemetry `V` records, fields `Locked` + `DoorState` |

The full alert history (last 500) is visible in the *Recent alerts* panel of Settings, with delivery status (notified / failed) for each event.

### Reliability notes

- The MQTT broker (Mosquitto) is shared with TeslaMate; no extra service to manage.
- The API container reconnects to MQTT automatically with a 10-second back-off if the broker is unavailable.
- Telegram failures are recorded in the alert event row (`failureReason`) so you can diagnose via the *Recent alerts* panel.
- Tesla OAuth tokens are refreshed proactively every 30 minutes; failures are surfaced in Settings.

### Security model

- **Tokens at rest:** AES-GCM (256-bit), key derived from `TESLAHUB_JWT_SECRET` via SHA-256.
- **OAuth state:** signed JWT with HS256, 10-minute expiry, audience-checked.
- **Token refresh:** automatic background refresh every 30 minutes, 60-minute proactive horizon.
- **Disconnect:** removes tokens and associated vehicles from the database immediately.
- **Network:** TeslaHub talks directly to `auth.tesla.com` and `fleet-auth.prd.vn.cloud.tesla.com` — no intermediate service.

#### What "paired virtual key" actually grants

Pairing TeslaHub as a third-party virtual key on a vehicle (the QR code step) is **not just read-only**. With the `vehicle_cmds` scope and the partner private key sitting on your server, TeslaHub has the cryptographic authority to send signed commands to your cars. Be honest with yourself about what that means:

| TeslaHub **can** do (signed via tesla-http-proxy) | TeslaHub **cannot** do |
|---|---|
| Lock / unlock the vehicle | Drive the car (only physical key cards / paired phones can authorise driving) |
| Open frunk / trunk / charge port | Push a software / OTA update |
| Arm / disarm Sentry mode | Change vehicle configuration (regen, range, etc.) |
| Honk / flash lights | Anything that requires the owner's phone for biometric approval |
| Climate control / preconditioning | |
| Set / start / stop charging | |

Today TeslaHub uses these capabilities only for the telemetry-config call and (optionally) the *send destination to car* feature. Future UI commands will be opt-in. Either way, the **partner private key** is the keys to the kingdom: anyone who can read it (your DB *and* your `.env`) can replay the same commands.

**Concrete recommendations for self-hosters:**

1. Use a **strong, unique admin password** for TeslaHub (don't reuse your TeslaMate password).
2. Set `TESLAHUB_ALLOWED_IPS` in your `.env` to restrict the admin UI to your home network / VPN — e.g. `TESLAHUB_ALLOWED_IPS=82.x.x.x/32,192.168.1.0/24`.
3. **Encrypt your backups** of the PostgreSQL volume *and* `.env` (Restic, Borg, rclone-crypt to Backblaze, etc.). A backup leak is functionally equivalent to a server compromise.
4. Run the host with **SSH key auth only**, fail2ban, OS auto-updates, and a host firewall.
5. Consider full-disk encryption (LUKS) on the host if it's physically accessible to anyone other than you.

This is the same threat model as the Tesla mobile app on your phone — the difference is that *you* are now responsible for the operational security that Apple / Google would normally provide.

### Why is the feature "optional"?

Because it requires a public domain name and a Tesla developer app, which is more setup than most TeslaHub users want. The feature is opt-in: the new environment variables default to empty, the Settings card shows clear instructions, and the rest of TeslaHub continues to work exactly as before for users who don't enable it.

### Troubleshooting

Bringing the Security Alerts stack online involves quite a few moving pieces (Tesla developer app, OAuth, public DNS, Let's Encrypt, two locally-built Tesla Go services, MQTT, Telegram). This section captures every error that came up during real-world bring-up and the fix that resolved it. If you hit something not listed here, open an issue with the relevant container logs.

#### Setup wizard / Tesla API

| Symptom | Root cause | Fix |
|---|---|---|
| **`/.well-known/appspecific/com.tesla.3p.public-key.pem` returns the React app instead of a `.pem` file** | Tesla expects this exact path to serve your partner public key. The internal Caddyfile inside `teslahub-web` falls back to `index.html` for any unknown path. | Already fixed in the published `deltawp/teslahub-web` image (PR #13). Make sure your **outer** Caddy block also forwards `/.well-known/appspecific/*` to the API container alongside `/api/*`. |
| **Chrome shows a red "Dangerous site" warning when clicking the public-key test link** | Google Safe Browsing flags brand-new domains containing the word "tesla" as suspected phishing. It is *not* a TLS issue. | Cosmetic. Tesla's own server-to-server fetch ignores Safe Browsing. Confirm the endpoint with `curl -v https://teslahub.yourdomain.com/.well-known/appspecific/com.tesla.3p.public-key.pem` from any shell — you should see a `-----BEGIN PUBLIC KEY-----` block. To bypass in Chrome itself: *Details* → *Visit this unsafe site*. The warning fades once your domain accumulates browsing reputation. |
| **Tesla refuses the developer-app form with a vague validation error on the App Name** | App names are global on `developer.tesla.com`. Common names like `TeslaHub Self-Hosted` are already registered by other users. | Use any unique name (e.g. `TeslaHub <yourname>` or `<yourname> Tesla Companion`). The name is purely cosmetic and never shown to the OAuth user. |
| **OAuth callback returns `redirect_uri_mismatch`** | `TESLA_REDIRECT_URI` in your `.env` does not match exactly what is registered in the Tesla developer app — most often a missing/extra trailing slash, or `http://` vs `https://`. | Make the two strings byte-for-byte identical. The recommended form is `https://teslahub.yourdomain.com/api/tesla-oauth/callback` with no trailing slash. |
| **Partner registration fails with `401 Unauthorized` from `partner_accounts`** | This endpoint requires a *partner* token (OAuth `client_credentials` grant), not a user token (`authorization_code`). | Already fixed in the published `deltawp/teslahub-api` image (PR #14). Just retry the wizard. |
| **"Configure telemetry" returns `400 must be called through the Vehicle Command HTTP Proxy`** | Since Tesla firmware **2024.26+**, all signed Fleet API write calls (including `fleet_telemetry_config`) must be proxied through Tesla's `tesla-http-proxy`. | Bring the `tesla-http-proxy` + `tesla-http-proxy-init` services up (`docker compose --profile security-alerts up -d`) and set `TESLA_COMMAND_PROXY_URL=https://tesla-http-proxy:4443` in `.env`. |
| **"Configure telemetry" returns `400 interval_seconds must be positive and less than 21600`** | The Tesla API expects snake_case for this field; an older TeslaHub version sent camelCase. | Pull the latest `deltawp/teslahub-api` image (PR #19). |
| **Wizard returns `404 Not Found` calling `fleet_telemetry_config_create`** | Tesla renamed the endpoint to `fleet_telemetry_config`. | Pull the latest `deltawp/teslahub-api` image (PR #17). |

#### `fleet-telemetry` container

| Symptom | Root cause | Fix |
|---|---|---|
| **`docker compose pull` fails with `pull access denied`** | Tesla does not publish `fleet-telemetry` on Docker Hub or GHCR. | Clone `https://github.com/teslamotors/fleet-telemetry.git` into `./fleet-telemetry-src/` and let Docker Compose build it locally (`build:` block already present in `docker-compose.security-alerts.yml`). |
| **`panic: open /certs/<domain>.crt: permission denied`** | The container runs as uid `65532` (distroless `nonroot`) and Caddy stores its certs as mode `700/600` for the `caddy` user. | `sudo chmod -R o+rX /var/lib/caddy/.local/share/caddy/certificates/` and add the daily cron from the [setup section](#make-the-cert-readable-by-the-tesla-containers). |
| **`json: cannot unmarshal object into Go struct field Config.records of type telemetry.Dispatcher`** | An old `config.json` listed `nats` as a dispatcher; Tesla never shipped NATS support. | Use the supplied `config.json.example` (MQTT only). The TeslaHub stack relies on the Mosquitto broker that is already running for TeslaMate. |
| **Container starts but Tesla shows the vehicle as "not streaming"** | Cloudflare proxy in front of `telemetry.*` will buffer/close the long-lived WebSocket. | The DNS record for `telemetry.*` must be **DNS-only** (grey cloud), not proxied (orange cloud). The `teslahub.*` record can stay proxied. |
| **External TLS handshake errors in the logs from random IPs** | Internet scanners hitting port 8443. | Cosmetic noise — every legitimate vehicle session establishes TLS cleanly. You can quiet this by pointing Tesla's vehicles at a non-default port and not opening 8443 to the world, but most users leave it. |

#### `tesla-http-proxy` container

| Symptom | Root cause | Fix |
|---|---|---|
| **Proxy crash-loops with `open /key-vault/private.pem: no such file or directory`** | The partner private key lives encrypted in the TeslaHub database. It must be exported once to the shared `key-vault` volume before the proxy can sign requests. | In TeslaHub → **Settings → Security Alerts**, click **"Export private key for the proxy"**. Then `docker compose restart tesla-http-proxy`. |
| **Proxy crash-loops with `open /key-vault/proxy.key: permission denied`** | The init container previously wrote `proxy.key` with mode `600`; the proxy runs as `nonroot` and could not read its own TLS key. | Pull the latest `docker-compose.security-alerts.yml` from this repo (PR #19) — the init container now sets `chmod 644` on `proxy.key` (acceptable: the file is on a private Docker network and the cert pair is regenerated trivially). On an existing volume: `docker run --rm -v <stack>_key-vault:/key-vault alpine chmod 644 /key-vault/proxy.key`. |
| **Proxy is up but `configure-telemetry` still 502s** | `teslahub-api` is not pointing at the proxy. | Verify `docker compose exec teslahub-api env \| grep TESLA_COMMAND_PROXY_URL` returns `https://tesla-http-proxy:4443`. If empty, add it to `.env` and to the `teslahub-api` `environment:` block (see `docker-compose.addon.yml`), then `docker compose up -d teslahub-api`. |

#### `teslahub-api` configuration

| Symptom | Root cause | Fix |
|---|---|---|
| **Settings page never shows the "Connect Tesla account" button** | `TESLA_CLIENT_ID` / `TESLA_CLIENT_SECRET` are missing from the container's environment. They were added to `.env` but not to the `environment:` block of `teslahub-api`. | Compare your compose file with `docker-compose.addon.yml` and add every `TESLA_*`, `TELEMETRY_*`, `TELEGRAM_BOT_TOKEN` and `TESLA_COMMAND_PROXY_URL` line. Then `docker compose up -d teslahub-api`. |
| **`docker compose up` fails with `services.teslahub-api.ports must be a list`** | YAML mix-up where `ports` and `volumes` were merged. | Each is its own top-level key under the service. See the canonical layout in `docker-compose.full-example.yml`. |
| **Telegram test sends nothing, recipient row shows `403 Forbidden`** | Telegram bots cannot DM a user who never opened the chat. | The recipient must send `/start` (or any message) to your bot once. For a group, invite the bot and post any message in the group. Then click *Send test* again. |

#### Networking sanity checks

```bash
# 1. Public TLS cert on telemetry.* served by fleet-telemetry
echo | openssl s_client -connect telemetry.yourdomain.com:8443 -servername telemetry.yourdomain.com 2>/dev/null | openssl x509 -noout -subject -dates

# 2. Tesla can fetch your partner public key
curl -sS https://teslahub.yourdomain.com/.well-known/appspecific/com.tesla.3p.public-key.pem | head -1
# → must start with "-----BEGIN PUBLIC KEY-----"

# 3. tesla-http-proxy is reachable from the API container
docker compose exec teslahub-api wget -qO- --no-check-certificate https://tesla-http-proxy:4443/api/1/vehicles 2>&1 | head -5
# → expect a Tesla 401 (no token), NOT a connection error

# 4. fleet-telemetry is publishing to MQTT
docker compose exec mosquitto mosquitto_sub -h localhost -t 'telemetry/#' -v -C 5
# → wakes the car or arms Sentry, then watch live messages
```

---

## Reverse Proxy (HTTPS)

TeslaHub listens on `127.0.0.1` only. To expose it over HTTPS, use a reverse proxy.

### Caddy (recommended)

#### Minimal block (no Security Alerts)

```caddyfile
teslahub.yourdomain.com {
    reverse_proxy localhost:4002
}
```

Caddy handles TLS certificates automatically. Reload with `sudo systemctl reload caddy` (systemd) or `caddy reload` (manual).

#### Block to use when Security Alerts are enabled

If you plan to use the **Security Alerts** feature, the bare snippet above will break Tesla's `/.well-known/appspecific/...` fetch (it would return the React SPA). Use this expanded block instead — it routes the API + the well-known path to the API container and everything else to the web container:

```caddyfile
teslahub.yourdomain.com {
    encode gzip zstd
    # Tesla fetches your partner public key from this exact path.
    reverse_proxy /.well-known/appspecific/* localhost:4001
    # All API calls (OAuth, telemetry config, recipients, etc.).
    reverse_proxy /api/*                     localhost:4001
    # Everything else = the React SPA.
    reverse_proxy                            localhost:4002
}

# Telemetry sub-domain. Caddy never serves traffic here — its only job
# is to obtain and renew the Let's Encrypt cert that fleet-telemetry
# reads from disk. See "Security Alerts (optional)" → "Telemetry stack".
telemetry.yourdomain.com {
    encode gzip zstd
    respond 404
}
```

> **If Caddy runs in Docker rather than as a systemd service**, replace `localhost:4001` / `localhost:4002` with the container names `teslahub-api:8080` / `teslahub-web:80` (assuming Caddy shares the same Docker network), and adapt the cert path mounted into `fleet-telemetry` accordingly (Docker installs typically store certs under `/data/caddy/certificates/...` inside the container).

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name teslahub.yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:4002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Updating

Pull the latest images and restart:

```bash
docker compose pull teslahub-init teslahub-api teslahub-web
docker compose up -d teslahub-init teslahub-api teslahub-web
```

Or use the update script (recommended — also handles `fleet-telemetry` + `tesla-http-proxy` rebuilds when Security Alerts are enabled):

```bash
curl -fsSL https://raw.githubusercontent.com/Olrik-WP/TeslaHub/main/update.sh -o update.sh
chmod +x update.sh
./update.sh
```

Options:
- `./update.sh --clean` — remove dangling images after update
- `./update.sh --full-clean` — prune all unused images and build cache
- `./update.sh --logs` — show logs after restart

Your data is safe — TeslaHub data lives in the PostgreSQL volume. Only the application containers are replaced.

### Updating the Tesla services (Security Alerts)

`fleet-telemetry` and `tesla-http-proxy` are built locally from Tesla's source repos because Tesla does not publish images. **Watchtower (and any image-based updater) cannot update them automatically** — they have a `build:` directive in compose, not an `image:` reference. To pick up upstream Tesla fixes, run:

```bash
cd ~/teslamate/fleet-telemetry-src && git pull
cd ~/teslamate/vehicle-command-src && git pull
cd ~/teslamate
docker compose build --pull fleet-telemetry tesla-http-proxy
docker compose up -d fleet-telemetry tesla-http-proxy
```

The provided `update.sh` script does this for you when `SECURITY_ALERTS_ENABLED=true` is set in `.env`.

> **Tip:** the `labels: ["com.centurylinklabs.watchtower.enable=false"]` in the compose snippets explicitly opts the Tesla containers out of Watchtower so it stops complaining about images it cannot pull. Keep that label.

---

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `TESLAHUB_READER_PASS` | *(required)* | Password for the read-only TeslaMate DB user |
| `TESLAHUB_APP_PASS` | *(required)* | Password for the TeslaHub app DB user |
| `TESLAHUB_ADMIN_USER` | `admin` | Login username for TeslaHub |
| `TESLAHUB_ADMIN_PASSWORD` | *(required)* | Login password for TeslaHub |
| `TESLAHUB_SESSION_DAYS` | `30` | How long the browser stays logged in |
| `TESLAHUB_JWT_SECRET` | *(required)* | Secret key for JWT signing |
| `MAP_TILE_URL` | OpenStreetMap | Custom tile server URL |
| `TESLAHUB_ALLOWED_IPS` | *(empty = all)* | Restrict access by IP/CIDR |
| `TESLAHUB_ALLOWED_ORIGINS` | *(empty = same-origin only)* | Comma-separated list of origins allowed to call the API cross-origin with credentials. Leave empty when the SPA is served by the same Caddy as `/api`. |
| `MQTT_HOST` | *(empty = disabled)* | MQTT broker hostname (e.g. `mosquitto`). Enables live vehicle status |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_USER` | *(empty)* | MQTT username (if broker requires auth) |
| `MQTT_PASSWORD` | *(empty)* | MQTT password |
| `MQTT_NAMESPACE` | *(empty)* | TeslaMate MQTT namespace (if configured) |
| `TZ` | `Europe/Paris` | Timezone |

---

## Security

- Passwords are hashed with bcrypt
- JWT access tokens (short-lived) + httpOnly refresh tokens (configurable duration)
- Progressive lockout on failed login attempts (exponential backoff)
- Optional IP whitelisting via `TESLAHUB_ALLOWED_IPS`
- TeslaMate database access is strictly read-only
- You can change your password from Settings after first login

---

## Development

For contributors who want to build from source:

```bash
git clone https://github.com/Olrik-WP/TeslaHub.git
cd TeslaHub

# Start everything with local builds
docker compose -f docker-compose.dev.yml up -d --build

# Or run services individually:
# Backend
cd src/TeslaHub.Api
dotnet run

# Frontend
cd src/TeslaHub.Web
npm install
npm run dev
```

---

## Tech Stack

- **Backend:** ASP.NET Core 9 Minimal API, Dapper, Entity Framework Core, PostgreSQL
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, TanStack Query, Recharts, Leaflet
- **Auth:** bcrypt + JWT with refresh tokens
- **Deployment:** Docker multi-arch (amd64/arm64), Docker Compose

## Credits

TeslaHub works alongside [TeslaMate](https://github.com/teslamate-org/teslamate), which is licensed under the [GNU AGPLv3](https://github.com/teslamate-org/teslamate/blob/master/LICENSE).

TeslaHub is an independent project and does not modify TeslaMate. It only reads TeslaMate data using a read-only database user.

## License

[GNU AGPLv3](LICENSE) — Free and open-source. Modifications and network-deployed forks must remain open-source under the same license.
