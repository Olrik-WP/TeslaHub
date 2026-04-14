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

# JWT secret (generate a random 64-character string)
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

## Reverse Proxy (HTTPS)

TeslaHub listens on `127.0.0.1` only. To expose it over HTTPS, use a reverse proxy.

### Caddy (recommended)

Add to your Caddyfile:

```
teslahub.yourdomain.com {
    reverse_proxy localhost:4002
}
```

Caddy handles TLS certificates automatically. Reload with `caddy reload`.

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

Or use the update script:

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
