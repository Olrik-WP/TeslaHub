# TeslaHub

TeslaMate companion app — a self-hosted dashboard optimized for the Tesla in-car browser.

## What is this?

TeslaHub reads your existing TeslaMate data (read-only) and provides:

- A touch-first, dark-themed UI designed for the Tesla browser
- Vehicle status, battery, and position at a glance
- Charging sessions with cost tracking and custom pricing rules
- Trip history with distance, consumption, and route visualization
- Map with Leaflet (historical data) and Waze (live traffic)
- Custom cost management (home/night rates, supercharger, public, free)
- Multi-car support

TeslaMate remains your telemetry source. TeslaHub is the UX layer.

## Architecture

```
Docker (your server)
├── TeslaMate          (existing)
├── PostgreSQL         (existing — hosts both teslamate and teslahub databases)
├── Grafana            (existing)
├── TeslaHub API       (ASP.NET Core 9 — reads TeslaMate DB, manages App DB)
└── TeslaHub Web       (React + Caddy — serves the UI)
```

TeslaMate DB is **never exposed** — TeslaHub reads it via the Docker internal network, just like Grafana.

## Quick Start

### 1. Create database users (run once)

```bash
docker exec -it <your-postgres-container> psql -U tm_user -d teslamate
```

```sql
-- Read-only user for TeslaMate data
CREATE USER teslahub_reader WITH PASSWORD 'choose_password_1';
GRANT CONNECT ON DATABASE teslamate TO teslahub_reader;
GRANT USAGE ON SCHEMA public TO teslahub_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO teslahub_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO teslahub_reader;

-- TeslaHub app database
CREATE DATABASE teslahub;
CREATE USER teslahub_app WITH PASSWORD 'choose_password_2';
GRANT ALL PRIVILEGES ON DATABASE teslahub TO teslahub_app;
\c teslahub
GRANT ALL ON SCHEMA public TO teslahub_app;
```

### 2. Add to your .env

```env
TESLAHUB_READER_PASS=choose_password_1
TESLAHUB_APP_PASS=choose_password_2
TESLAHUB_ADMIN_USER=admin
TESLAHUB_ADMIN_PASSWORD=choose_a_strong_password
TESLAHUB_SESSION_DAYS=30
TESLAHUB_JWT_SECRET=generate_a_64_char_random_string
```

### 3. Add services to your docker-compose.yml

See `docker-compose.addon.yml` for the services to add.

### 4. Start

```bash
docker compose up -d teslahub-api teslahub-web
```

TeslaHub is now available at `http://your-server:4002`.

### 5. Reverse proxy with Caddy (recommended)

Add this to your Caddyfile to expose TeslaHub over HTTPS with automatic certificates:

```
teslahub.yourdomain.com {
	reverse_proxy localhost:4002
}
```

This works exactly like your Grafana setup — Caddy handles TLS automatically.

## Tech Stack

- **Backend**: ASP.NET Core 9 Minimal API, Dapper (TeslaMate queries), EF Core (App DB)
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, TanStack Query, Recharts, Leaflet
- **Database**: PostgreSQL (same instance as TeslaMate)
- **Auth**: Username/password (bcrypt), JWT with 30-day refresh tokens
- **Map**: Leaflet (historical) + Waze Live Map (traffic, GPS from Tesla browser)

## Development

```bash
# Backend
cd src/TeslaHub.Api
dotnet run

# Frontend
cd src/TeslaHub.Web
npm install
npm run dev
```

## License

MIT
