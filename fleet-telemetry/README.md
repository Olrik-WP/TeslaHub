# Tesla Fleet Telemetry runtime config

This directory holds the runtime configuration for the optional `fleet-telemetry`
container started by `docker-compose.security-alerts.yml`.

## Files you must provide

| File | Description |
|------|-------------|
| `config.json` | Server config (TLS paths, NATS dispatcher, rate limits). Copy from `config.json.example` and edit. |
| `server-ca.crt` | Tesla-provided server CA bundle used to validate the vehicle client certificate during mTLS. Download once from the Tesla Fleet API documentation. |

Neither file is committed to git. See the project root `README.md` →
**"Security Alerts (optional)"** for the full setup walkthrough.
