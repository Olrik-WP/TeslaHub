# Tesla Fleet Telemetry runtime config

This directory holds the runtime configuration for the optional `fleet-telemetry`
container started by `docker-compose.security-alerts.yml`.

## Files you must provide

| File | Description |
|------|-------------|
| `config.json` | Server config (TLS paths, MQTT dispatcher, rate limits). Copy from `config.json.example` and edit. Replace every `TELEMETRY_DOMAIN` placeholder with your real telemetry sub-domain (e.g. `telemetry.yourdomain.com`). |

> **No mTLS CA needed.** Tesla Fleet Telemetry now authenticates vehicles at
> the application layer (signed with each vehicle's key, validated against
> your registered partner public key). The server only needs a standard
> Let's Encrypt cert — no `server-ca.crt` file is required.

## Output

`fleet-telemetry` does not store anything itself. It re-publishes vehicle
signals as MQTT messages on your **existing Mosquitto broker** (the same one
TeslaMate uses), under the topic prefix `telemetry/<VIN>/v/<field>` and
`telemetry/<VIN>/alerts/<alert_name>/current`. `TeslaHub.Api` subscribes to
those topics to build alerts and push notifications.

`config.json` is not committed to git. See the project root `README.md` →
**"Security Alerts (optional)"** for the full setup walkthrough, including
the Caddy/Cloudflare wiring, port forwarding, and the `tesla-http-proxy`
sidecar required since Tesla firmware 2024.26+.
