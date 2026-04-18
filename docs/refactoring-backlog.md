# TeslaHub — Refactoring backlog

This file captures the remaining refactoring opportunities identified during
the April 2026 codebase review, **after** the first batch of bug fixes and
quick wins was merged.

> Status legend
> - [ ] Not started
> - [~] Partially addressed
> - [x] Done — left here for traceability only

---

## ✅ Already done in the first pass

Backend:

- [x] Cache invalidation key bug (`['chargingSessions']` → `['charging']` + `['chargingSummary']`).
- [x] `useQuery({ onSuccess })` migration to TanStack Query v5 (`useEffect` on `data`).
- [x] Removed broken `CacheService.InvalidateByPrefix` (renamed to `InvalidateAll`).
- [x] Removed dead `_jsonOpts` field in `MqttLiveDataService`.
- [x] Logged previously-silent `catch { }` blocks around MQTT disconnect.
- [x] Centralized `Haversine` formula in `Utilities/GeoDistance.cs` with `EarthRadiusMeters` constant.
- [x] Introduced `PricingTypes` and `CostPeriods` constants (`Models/PricingConstants.cs`).
- [x] Centralized SQL "address" expression in `TeslaMate/TeslaMateSql.cs`.
- [x] Simplified redundant `Sum` filter in `CostService.GetSummary`.
- [x] Centralized SSE `JsonSerializerOptions` in `Utilities/JsonOptions.cs`.

Frontend:

- [x] Factored cost-summary `URLSearchParams` builder.
- [x] Nominatim `Accept-Language` now follows `i18n.language`.
- [x] Translated About / "Source code" footer, Login title, aria-labels (`Collapse`, `Expand`, `Dismiss`), `previewText`, `Unknown`, "MQTT live", tire `OK`.
- [x] Centralized magic constants in `constants/theme.ts` (colors, `STALE_TIME`, `LIMITS.chargingSessionsPage`).

---

## Mid-effort refactors

### Backend

- [ ] **Extract location/cost CRUD logic out of `Endpoints/CostsEndpoints.cs`** into a dedicated service. Endpoints currently parse `TimeOnly`, mutate entities, call `CostService` and decide caching keys all in one place.
- [ ] **Extract live-data merge logic out of `VehicleEndpoints.MergeLiveData`**: ~60 lines of `live?.X ?? vehicle.X` is begging for a mapping helper / reflection-free generator.
- [ ] **Propagate `CancellationToken`** through Dapper-based queries (`ChargingQueries`, `LocationsQueries`, `StatesQueries`, `TripQueries`, `DrivesQueries`). Today every long-running TeslaMate query ignores the request's `ct`.
- [ ] **Refactor `MqttLiveDataService.ApplyValue`'s switch** (~60 cases) — consider a `Dictionary<string, Action<MqttLiveData, string>>` table or source-generated mapping.
- [ ] **Inline password validation in `AuthEndpoints`** should move into `AuthService` with a single `ValidatePasswordPolicy` method (currently length and message are hard-coded both in front and back).
- [ ] **JWT magic numbers** in `AuthService` (clock skew, access token TTL) → expose as `IOptions<AuthOptions>` with sane defaults so they're documented and overridable per env.

### Frontend

- [ ] **Shared `ChargingLocationFields` component** — the same form (name, pricing type tabs, peak/off-peak, monthly amount, radius, all-vehicles) is duplicated in `Settings.tsx` ~410-456 and `Charging.tsx` (`LocationForm`).
- [ ] **Centralize TanStack Query keys** in `api/queryKeys.ts` to avoid the `['charging']` vs `['chargingSessions']` class of bugs (now fixed) reappearing.
- [ ] **`selectedCarId` via React Context** — currently prop-drilled through `App` → page components.
- [ ] **Reusable `Panel` / `Card` / `PrimaryButton` components** to capture the repeated `bg-[#141414] border border-[#2a2a2a] rounded-xl p-4` and the `bg-[#e31937] ... active:bg-[#c0152f]` button pattern.
- [ ] **Replace `updateCarConfig(... as any)`** in `pages/Costs.tsx` with proper typing (now possible since v5 mutations accept generic input/error types).

---

## Large efforts (multi-PR projects)

### Backend

- [ ] **Decompose `Services/CostService.cs`** (~470 lines) into smaller services:
  - `LocationMatchingService` (FindMatchingLocation, AutoApplyAllLocationsPricingAsync, ApplyLocationPricingAsync)
  - `PricingCalculator` (CalculatePricePerKwh, IsOffPeak)
  - `CostSummaryService` (GetSummary, CalculateSubscriptionTotal, GetSubscriptionLocationsWithSessions, GetCostsGroupedByPeriodAsync)
- [ ] **Add an xUnit test project** — there is currently zero unit-test coverage. Start with `PricingCalculator`, `CostService.GetSummary` and `GeoDistance.HaversineMeters` since they are pure-ish functions with rich edge cases (off-peak crossing midnight, subscription monthly buckets).
- [ ] **Production JWT secret strategy** — `Program.cs` generates a secret at startup if `JWT_SECRET` is missing. Should hard-fail in `Production` and document required env vars.

### Frontend

- [ ] **Split giant page components** (each ~500-650 lines) into focused subcomponents under `pages/<page>/`:
  - `pages/Home.tsx` — extract `HeroSection`, `MapBlock`, `LatestTripCard`, `LiveChargingCard`, `CostSummaryCard`, `StickyVehicle` hook.
  - `pages/Settings.tsx` — `GeneralSettingsSection`, `VehicleImageSection`, `ChargingLocationsSection`, `PasswordSection`, `AboutSection`.
  - `pages/Charging.tsx` — `SessionFiltersBar`, `SessionsChart`, `SessionCard`, `LocationForm` (latter shared with Settings, see above).
  - `components/VehicleTopView.tsx` — split inline SVG into `VehicleSvg.tsx`, info panels into `BodyPanel`, `ClimatePanel`, `TpmsPanel`, `ChargePortPanel`.
- [ ] **Break up `api/queries.ts`** (~660 lines) into per-domain files (`api/queries/charging.ts`, `costs.ts`, `vehicle.ts`, `database.ts`, ...). Centralize types in `types/` next to them.

---

## Notes / nice-to-have

- The `[# 6b7280]`, `[#9ca3af]`, `[#4b5563]` text scale could become Tailwind theme tokens (`text-muted`, `text-subtle`, `text-faint`) so brand changes don't require codebase-wide search.
- Consider `react-i18next` namespaces (split locale JSON per page) once page split is done — keeps `en.json` / `fr.json` from growing past their current ~480 lines.
- `LIMITS.chargingSessionsPage = 500` is arbitrary; revisit pagination on the Charging page once the SessionCard is its own component.
