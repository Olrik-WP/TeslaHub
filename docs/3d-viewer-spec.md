# TeslaHub 3D Viewer — Specification

> Last updated: 2026-05-20
> Status: Phase 1 (visual) complete for Poppyseed (Model 3 Highland), Phase 2 (data wiring) and multi-model not started.

## 1. Goals

- Replace the static SVG vehicle silhouette with a real 3D model extracted from the official Tesla Android app.
- One canonical 3D viewer component, used in **two modes**:
  - **Live mode** (`Home`): reflects the real vehicle state, allows safe API-backed actions.
  - **Showroom mode** (`Settings → Showroom`): full configurator (color, wrap, wheels, trim), free animation of openings, no API calls.
- Support multiple vehicles per user (Tesla account can hold several cars; the user already owns two).
- Stay performant on the Tesla in-car browser (Chromium ≥80, WebGL 2) and mobile PWAs.

---

## 2. Asset pipeline

### Extracted from the Tesla Android APK

| Asset | Tesla codename | TeslaHub model id | Status |
| --- | --- | --- | --- |
| `Poppyseed.glb` | Poppyseed | `model3-highland` (P3 2024+) | ✅ Extracted, optimized |
| `Wheel_D50.glb` | D50 | base wheel for `model3-highland` | ✅ Extracted, optimized |
| `BayberryE80.glb` | BayberryE80 | `modely-juniper` (MY 2025+) | ⏳ To extract |
| `Glider`, `Helix_19`, `Wishbone_19/20`, `ZeroG_19` | — | M3 wheel variants | ⏳ To extract |
| `GeminiDark`, `Helix2`, `Machina2`, `Arachnid_V2_21` | — | MY wheel variants | ⏳ To extract |
| `WallConnector.glb` | — | shared charger asset | ⏳ To extract |
| `WallConnectorChargingCable.glb` | — | shared cable asset | ⏳ To extract |
| `WallConnectorCableFreshRig.glb` | — | shared cable rig (newer) | ⏳ To extract |
| Wraps PNG (Tesla official + custom user) | — | from `github.com/teslamotors/custom-wraps` | ⏳ Not started |

### Extraction workflow (per asset)

1. GDRETools → extracts the `.scn` from the Tesla APK.
2. Open in Godot 3.5 (clean project at `Tesla-Godot-Test/`).
3. Run `export_poppyseed.gd` style GDScript using `PackedSceneGLTF.export_gltf()`.
   - **Godot 3.5 strips AnimationPlayer tracks from the export.** Keyframes must be re-coded manually in TypeScript (see §6).
   - **Godot 3.5 also strips empty `Spatial` nodes** (e.g. `Wheel_*_Spatial`). Pivots that have children (doors, hood, trunk) DO survive.
4. `gltf-transform`: `dedup → prune → weld → draco` (preserves hierarchy).
5. Drop the optimized `.glb` into `src/TeslaHub.Web/public/models/`.
   - Files are gitignored. Production deployment uses Docker volume mount `/srv/models`.

---

## 3. Multi-model architecture (NOT YET IMPLEMENTED)

### Vehicle → model resolution

```
vehicle.carType + trimBadging + vehicle_config.car_type + production year → modelId
```

Mapping (initial, to refine):

| Real car | `modelId` | GLB file | Default wheels |
| --- | --- | --- | --- |
| Model 3 2017–2023 | `model3` | `model3.glb` (to extract) | Aero_18 |
| Model 3 Highland (2024+) | `model3-highland` | `poppyseed.glb` | D50 |
| Model 3 Highland Performance | `model3-highland-perf` | `poppyseed.glb` (variant flag) | Warp_20 |
| Model Y 2020–2024 | `modely` | `modely.glb` (to extract) | Gemini_19 |
| Model Y Juniper (2025+) | `modely-juniper` | `bayberry.glb` | GeminiDark_19 |
| Cybertruck | `cybertruck` | (later) | — |

### Per-model config

```ts
// src/components/3d/models/<modelId>.config.ts
interface VehicleModelConfig {
  id: ModelId;
  displayName: string;          // "Model 3 Highland"
  glbUrl: string;               // "/models/poppyseed.glb"
  hiddenNodeNames: string[];    // parasite nodes to detach
  floorNodeNames: string[];     // shadow plane nodes
  wheels: {
    anchors: Array<{ name: string; mirror: boolean }>;
    fallbackPositions: WheelPosition[];     // when anchors are stripped
    availableSets: Array<{
      id: string;                  // "D50", "Helix_19"
      glbUrl: string;
      kind: 'alloy' | 'plastic_cover' | 'aero_cover';
    }>;
    defaultSet: string;
  };
  openings: OpeningDefinition[];           // 13 anims for Poppyseed
  paintMaterialPattern: RegExp;
  glassMaterialPattern: RegExp;
  charge_port: {
    worldOffset: [number, number, number]; // for cable plug position
  };
  body: {
    length: number;             // for camera framing
    width: number;
    height: number;
    wheelbase: number;
  };
}
```

The 3D viewer component takes `model: VehicleModelConfig` as a prop and is fully generic.

### Refactor needed (current code is Poppyseed-hardcoded)

- Move `HIDDEN_NODE_NAMES`, `WHEEL_ANCHORS`, `WHEEL_FALLBACK_POSITIONS`, `OUTER_GLASS_NODE`, `BODY_PAINT_MAT`, `CAMERA_POSITION`, etc., from `VehicleTopView3D.tsx` into a per-model config file.
- Move `vehicleOpenings.ts` keyframes into the per-model config (Tesla animations are slightly different across models).
- A new `useVehicleModel(vehicle)` hook returns the right `VehicleModelConfig` for the current car.

---

## 4. Two modes: `Live` vs `Showroom`

| Aspect | Live mode (Home) | Showroom mode (Settings → Showroom) |
| --- | --- | --- |
| Source of opening states | `vehicle.frunkOpen`, `vehicle.trunkOpen`, ... (read-only) | Local user state (free play) |
| Click on mesh | (TBD — option C below) | Toggles the opening locally, no API |
| Color / wrap / wheels | From DB `vehicle_customization` table (or Tesla `vehicle_config` fallback) | User-editable, persisted to DB on save |
| Auto-rotate | OFF by default | ON by default, with play/pause toggle |
| Charge cable | Shown when `vehicle.pluggedIn === true` | Toggle button |
| Default camera | 3/4 front view, fixed | 3/4 front view, free orbit |

### Home interaction policy (chosen: option C, minimal)

- **No "control panel" overlay** on Home — too cluttered.
- **No click-to-command on the mesh** — confusion risk (a misclick on the trunk in a car app should never accidentally open the trunk).
- **Single small overlay** with 3 actions: `Aérer vitres`, `Verrouiller/Déverrouiller`, `Klaxon` (optional). Maybe a small "Câble" indicator when plugged in.
- The 3D is **primarily a status display** on Home.
- All commands live in the existing `HomeQuickActions` component.

### Showroom interaction

- Full slide-out panel from the right edge (option A in the brainstorm).
- All 11 openings + master "Open all / Close all".
- Configurator: color, wrap, wheels, trim, spoiler.
- Save button → POST `vehicle_customization`.

---

## 5. State mapping (Phase 2 wiring)

### Read (API → 3D)

| API field (`VehicleStatus`) | 3D opening | Notes |
| --- | --- | --- |
| `frunkOpen` | `hood` | Direct |
| `trunkOpen` | `trunk` | Direct |
| `chargePortDoorOpen` | `charge_port` | Direct; force `1` if `pluggedIn=true` |
| `driverFrontDoorOpen` | `door_LF` | Direct |
| `driverRearDoorOpen` | `door_LR` | Direct |
| `passengerFrontDoorOpen` | `door_RF` | Direct |
| `passengerRearDoorOpen` | `door_RR` | Direct |
| `windowsOpen` | `window_LF/LR/RF/RR` | Global flag → all 4 to `0.08` (vent level) |
| `isLocked` | mirrors (LF/RF folded) | Heuristic: assumes auto-fold-on-lock is enabled |
| `pluggedIn` + `chargingState` | charge cable visibility & glow | See §7 |
| `sentryMode` | (visual indicator TBD) | No mesh; could add LED ring badge |

### Write (3D → API, existing endpoints)

- `POST /vehicles/{id}/access/trunk` `{ which: "front" }` → frunk
- `POST /vehicles/{id}/access/trunk` `{ which: "rear" }` → trunk
- `POST /vehicles/{id}/access/charge-port` `{ on: true/false }` → charge port
- `POST /vehicles/{id}/access/window` `{ command: "vent" | "close" }` → all windows
- `POST /vehicles/{id}/access/door_unlock` → unlock only (Tesla cannot open doors physically via API)
- `POST /vehicles/{id}/access/flash-lights`, `/honk-horn`, `/sentry`

### NOT controllable via API

- Individual door OPENING (only unlock)
- Individual window control (only "vent all" or "close all")
- Individual mirror fold/unfold (no public command)

---

## 6. Animation system (existing code reference)

- `src/components/vehicleOpenings.ts` — 13 hand-coded keyframe sets extracted from `Poppyseed.tscn`.
- `src/components/useVehicleOpenings.tsx`:
  - `<OpeningsProvider>` — context with `targets` (React state) and `progressRef` (mutated by useFrame).
  - `<VehicleOpeningsAnimator scene={...} />` — mounts inside Canvas, runs `useFrame` to lerp progress toward targets and apply rotations/translations to pivot nodes.
  - `findOpeningForObject(obj)` — walks up parent chain to map a clicked mesh to its opening id.

Behavior:
- `target ∈ {0, 1}`, `progress ∈ [0, 1]` lerped at speed `approach = 4 /s` (≈ 0.25s to 95%).
- Keyframes sampled linearly between adjacent times.
- Euler rotation order: `'YXZ'` (matches Godot's rotation_degrees order well enough for all 13 anims).
- Rest transforms snapshotted lazily on first frame per pivot (no need to know them ahead of time).

---

## 7. Charge cable (planned)

Source assets:
- `WallConnector.glb` — wall-mounted unit
- `WallConnectorChargingCable.glb` — static cable
- `WallConnectorCableFreshRig.glb` — newer rigged version

Implementation plan:
- Position the wall connector ~1.5 m behind the left-rear corner of the car.
- Plug the cable to `Charge_Cap_Spatial` world position (already extractable from scene).
- Use a `ShaderMaterial` on the cable mesh to animate a green electricity pulse (uv-based, simple `fract(uv.y - time * speed)` then smoothstep).
- States:

| `pluggedIn` | `chargingState` | Visual |
| --- | --- | --- |
| `false` | — | Cable hidden, connector mesh maybe still shown |
| `true` | `Disconnected` / `Stopped` / `Complete` | Cable visible, no glow (matte black) |
| `true` | `Charging` (slow ≤ 11 kW) | Green pulse, speed ≈ 0.5 |
| `true` | `Charging` (DC ≥ 50 kW Supercharger) | Bright cyan pulse, speed ≈ 2.0 |
| `true` | `NoPower` / error | Red fixed glow |

---

## 8. Configurator data model (Showroom)

```sql
CREATE TABLE vehicle_customization (
  vehicle_id   INT PRIMARY KEY REFERENCES vehicles(id),
  color_hex    INT          NULL,          -- override (else read from Tesla vehicle_config)
  wrap_url     VARCHAR(255) NULL,          -- path under /wraps/
  wheel_set    VARCHAR(32)  NULL,          -- "D50", "Helix_19", ...
  trim         VARCHAR(32)  NULL,          -- "Std", "LongRange", "Performance"
  spoiler      VARCHAR(32)  NULL,          -- "Std", "Carbon"
  updated_at   TIMESTAMP    DEFAULT NOW()
);
```

UI:
- Settings → Showroom (new tab).
- 6 Tesla colors as swatches + "Custom hex" input (for fun).
- Wrap browser: scans `/wraps/*.png` (Docker volume), shows thumbnails.
- Wheel selector: only shows sets whose `.glb` is mounted.
- Save persists to DB; live mode on Home reads from DB on next render.

---

## 9. Open questions

- **Multi-vehicle picker**: where? Currently TeslaHub assumes one active vehicle. For the showroom we need a vehicle selector at the top.
- **Per-vehicle DB customization**: schema above is per `vehicle_id`. Confirm we want one customization per car (yes).
- **Mirror fold heuristic**: do we toggle on `isLocked`, even though that's not always accurate? Or leave them static and document the limitation?
- **Wrap distribution**: bundled (Tesla official templates shipped with the app, ~10 MB) vs user-folder-only (Docker volume `/srv/wraps/`)?
- **Performance metrics**: target FPS on Tesla in-car browser? 30 FPS acceptable? Need to test once assets are mounted on the actual car.
- **Camera framing per car**: Model 3 vs Model Y vs Cybertruck have different proportions → camera distance/angle should scale with the per-model `body` dimensions.

---

## 10. Implementation roadmap

### Phase 1 — Visual core (DONE for Poppyseed)
- [x] React Three Fiber + drei + three-stdlib install, Vite code-split into lazy `three-vendor` chunk.
- [x] GLB loading with HEAD probe for optional assets.
- [x] Cleanup parasite nodes (projection planes, defrost overlays).
- [x] Wheel attachment with fallback positions.
- [x] Glass transparency fix (panoramic roof + side windows).
- [x] Body paint override (Pearl White Multi-Coat).
- [x] Tesla floor shadow (unlit MeshBasicMaterial).
- [x] D50 plastic hubcap polish.
- [x] Manual camera positioning (no Bounds auto-fit).
- [x] Opening animations system (13 keyframes from .tscn).
- [x] Click-to-toggle on meshes.
- [x] Overlay panel with all openings.

### Phase 1.5 — Polish (NEXT)
- [ ] Wheels track widened to ±0.815 (Tesla spec).
- [ ] Auto-rotate OFF by default.
- [ ] Replace big panel with compact slide-out / 3-button overlay on Home.
- [ ] Default vehicle id from active car.

### Phase 2 — Multi-model refactor
- [ ] Extract per-model config to `src/components/3d/models/<id>.config.ts`.
- [ ] Generic viewer component takes config as prop.
- [ ] `useVehicleModel(vehicle)` resolver hook.
- [ ] Extract Model Y Juniper (Bayberry) assets.

### Phase 3 — Wraps
- [ ] Architecture `PaintConfig = { kind: 'color' | 'wrap' }`.
- [ ] Texture loader for `/wraps/*.png`.
- [ ] Bundle 1-2 Tesla templates from `teslamotors/custom-wraps` for testing.
- [ ] Wrap selector UI in Showroom.

### Phase 4 — Charge cable
- [ ] Extract WallConnector + ChargingCable GLBs.
- [ ] Position cable from charge port to connector.
- [ ] ShaderMaterial with state-driven pulse.

### Phase 5 — Live wiring (Home)
- [ ] Map `VehicleStatus` fields to opening targets (read).
- [ ] Compact overlay with 3 commands (Aérer / Lock / Honk).
- [ ] Mirror auto-fold on `isLocked`.

### Phase 6 — Showroom (Settings)
- [ ] New Settings tab.
- [ ] `vehicle_customization` table + endpoints.
- [ ] Color / wrap / wheels / trim selectors.
- [ ] Slide-out animation panel.
- [ ] Vehicle picker (multi-car).

### Phase 7 — Headlights & emergency states
- [ ] Headlight emissive driven by node names (not material names — see retry plan in code comments).
- [ ] Brake/turn signals on `chargingState`/lock events.
- [ ] Sentry mode visual indicator (LED ring badge?).
