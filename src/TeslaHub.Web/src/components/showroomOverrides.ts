/**
 * Showroom overrides — opaque per-car visual tuning layer.
 *
 * The defaults in `vehicleModelConfig.ts` are hand-calibrated against
 * each Tesla GLB and shipped in the repo. They get us 95 % of the way:
 * a Model 3 looks like a Model 3, a Model Y looks like a Model Y. But
 * the LAST 5 % (the exact wheel offset that lines up with the arch,
 * the exact charge-port socket position that doesn't tilt the cable…)
 * is tedious to dial in via code-edit / rebuild / refresh cycles.
 *
 * Solution: store per-car overrides in the backend as JSON. The user
 * dials in those last 5 % in the Showroom page using sliders / drag
 * gizmos, hits Save, and every page that mounts the 3D viewer reads
 * the same overrides via React Query — so the calibration follows the
 * car everywhere (Home, Charging cards, etc.) without any code change.
 *
 * Design:
 *   - Every override field is OPTIONAL. Anything left undefined falls
 *     back to the repo default. This means "empty override = stock
 *     defaults", and removing a field is the way to "reset to default".
 *   - The merge is field-by-field via `mergeShowroomConfig`, NEVER a
 *     blind structural clone. The override file is owned by the user
 *     and we treat its absence per-field as "keep the shipped default"
 *     so we can ship NEW default values in code and still respect
 *     existing user overrides for unrelated fields.
 *   - `modelKey` lets the user force a specific model variant for a
 *     car when VIN-based detection is wrong or ambiguous (e.g. they
 *     want to render their Y as the Performance trim even though the
 *     VIN reads RWD). When absent, we fall back to `pickModelForVin`.
 *
 * This file is PURE — no React, no fetch, no side effects. The wiring
 * to React Query lives in `useResolvedModelConfig.ts` next door.
 */
import {
  PoppyseedConfig,
  VEHICLE_MODELS,
  type CalloutKeyName,
  type VehicleModelConfig,
  type VehicleModelKey,
  type WheelFallbackPosition,
} from './vehicleModelConfig';

/** Identifier for each wheel corner — used as the key for per-wheel overrides. */
export type WheelCorner = 'LF' | 'RF' | 'LR' | 'RR';

/**
 * Per-corner wheel position override. Only the fields the user actually
 * touched are present — leaving y/z out keeps the shipped defaults
 * untouched even after a save round-trip.
 */
export interface WheelPositionOverride {
  x?: number;
  y?: number;
  z?: number;
  /** Tesla's wheel mesh defaults to +Z facing outward. Set true on the
   *  left side to flip the mesh so the cover faces -Z. Usually you
   *  don't need to touch this — it's baked into the per-corner default. */
  flipZ?: boolean;
  /** Extra yaw rotation (degrees) applied to the wheel wrapper. Used
   *  to re-orient a swapped wheel GLB whose "front" axis doesn't
   *  match the original. Defaults to 0. */
  rotY?: number;
}

/**
 * Glass tuning — opacity and tint of the various glass layers. These
 * params currently live as magic numbers inside `VehicleTopView3D.tsx`
 * (search for `INNER_GLASS_OPACITY`, `outerOpacity`, etc.). The
 * Showroom UI exposes them as sliders so they can be tweaked per car
 * (M3 Highland and Y Juniper need different settings because their
 * baked baseColor + alphaMode differ in the GLB).
 *
 * All optional; undefined = use the existing in-code default.
 */
export interface GlassOverrides {
  /** Outer windshield / side-window opacity. 0..1. Lower = more
   *  transparent. M3 default ~0.45, Y default forced 0.55 (windshield). */
  outerOpacity?: number;
  /** Outer-glass tint multiplier — applied as `mat.color.multiplyScalar(this)`.
   *  Below 1 darkens the glass tint; above 1 lightens. */
  outerTintMultiplier?: number;
  /** Inner-pane opacity (Glass_Interior). M3 default ~0.78, Y default
   *  ~0.90 — the higher the value the more the rear-window tint reads
   *  as proper privacy glass instead of grey. */
  innerOpacity?: number;
  /** Special low-opacity treatment applied to the windshield's inner
   *  pane only (Glass_Interior_Fade on Y). Default ~0.08 so the user
   *  can see through the windshield. */
  dimmedInnerOpacity?: number;
  /** Opacity boost for `(no mat)` privacy-glass primitives on Y rear
   *  doors. Default ~0.85. */
  privacyOpacity?: number;
  /** envMapIntensity on outer glass. 0..2. Lower kills the HDR sky
   *  reflection that otherwise looks like a chrome mirror. Default
   *  0.25 on Y, ~1.0 on M3. */
  envMapIntensity?: number;
}

/**
 * Full opaque override shape — every field optional. This is exactly
 * what the backend stores in `CarShowroomConfigs.ConfigJson` and what
 * the Showroom UI emits when the user clicks Save.
 *
 * Adding a new tunable: add a field here, expose a slider in the
 * Showroom UI, and add the merge logic in `mergeShowroomConfig` below.
 * No backend change needed (the column is jsonb — any new field is
 * persisted automatically).
 */
export interface ShowroomOverrides {
  // Identification / variant
  /** Force a specific model config regardless of VIN. Useful when VIN
   *  detection is ambiguous (e.g. a CPO car re-registered to a
   *  different trim) or when the user wants to render a "what-if"
   *  configuration. */
  modelKey?: VehicleModelKey;
  /** Per-axis option selection — drives mesh visibility for models
   *  that pack multiple variants (trim, drive layout, market region,
   *  audio package…) into one GLB.
   *
   *  Map shape: `{ axisId -> optionId }`. Only axes the user actually
   *  changed need to be present; any axis missing from the map (or
   *  pointing to an unknown option id) falls back to the model's
   *  `defaultOption` for that axis. Example:
   *  `{ trim: 'performance', driveLayout: 'rhd' }`. */
  variants?: Record<string, string>;

  // Camera
  cameraPose?: Partial<VehicleModelConfig['cameraPose']>;
  /** Charging-mode camera pose — same shape as `cameraPose`, used as
   *  override on top of `defaults.chargingCameraPose`. Optional: when
   *  no defaults and no overrides exist, the regular pose is reused. */
  chargingCameraPose?: Partial<VehicleModelConfig['cameraPose']>;

  // Wheels
  /** Swap the wheel GLB (Cypress, Halo, Riptide for M3; Helix2, Machina2,
   *  Arachnid for Y). When set, OVERRIDES the model's default wheelUrl. */
  wheelUrl?: string;
  /** Partial per-corner wheel position. Each corner is independent —
   *  setting LF doesn't reset RF, RR, LR. */
  wheelFallbackPositions?: Partial<Record<WheelCorner, WheelPositionOverride>>;

  // Charge port + cable
  chargePort?: Partial<VehicleModelConfig['chargePort']>;
  cableGroundAnchor?: [number, number, number];
  /** Slack multiplier for the SC-side cable segment (start → ground).
   *  1.0 = default drape, smaller = taut/short, larger = more loop. */
  cableSlackPost?: number;
  /** Slack multiplier for the car-side cable segment (ground → port).
   *  Same scale as `cableSlackPost`. */
  cableSlackCar?: number;
  /** Supercharger post placement — shallow-merged over model default. */
  supercharger?: Partial<VehicleModelConfig['supercharger']>;

  // Sentry
  /** Override the WHOLE sentry array (it's typed as 7 cameras for a Y
   *  Juniper but 7 cameras for a M3 too — replace wholesale). */
  sentryCameraPositions?: Array<[number, number, number]>;

  // Visual chrome
  /** Body paint hex (Tesla Pearl White = 0xf2f2f0, Solid Black =
   *  0x0e0e0e, Midnight Silver = 0x5a5a5a, Deep Blue = 0x1b3a5c,
   *  Ultra Red = 0xa82323, Quicksilver = 0xa8a8a8). */
  bodyPaintColor?: number;
  /** Vertical lift of floating callouts (metres). Default ~0.45-0.50
   *  depending on roof height. */
  calloutHeight?: number;
  /** Per-callout XYZ nudge (metres, world axes) applied AFTER the
   *  `calloutHeight` lift. Lets the user position each floating button
   *  independently via the Showroom Callouts panel — e.g. push the
   *  Lock callout closer to the driver-door handle, drop the Sentry
   *  callout onto the B-pillar camera, etc.
   *
   *  Convention: +X forward, +Y up, +Z right. Missing keys → default
   *  position (just above the anchor). Keyed by SEMANTIC callout id
   *  so M3-vs-Y anchor renames don't void calibration. */
  calloutOffsets?: Partial<Record<CalloutKeyName, readonly [number, number, number]>>;
  /** Per-callout visibility flag — when `true`, the corresponding
   *  floating button is hidden from the 3D viewer (Home, Charging
   *  cards, etc.). The Showroom keeps every hidden callout visible
   *  with a "barré" indicator so the user can still position it and
   *  toggle visibility back on. Missing keys default to "shown". */
  calloutsHidden?: Partial<Record<CalloutKeyName, true>>;
  /** Per-slot interior colour overrides. Keys match the `key` field
   *  on each `interiorOverrides` entry in the model's config
   *  (`Interior2`, `Decor`, `cupholder`, `Wing`). Values are RGB hex.
   *  Models without `interiorOverrides` (e.g. Poppyseed M3) ignore
   *  this field. */
  interiorColors?: Record<string, number>;
  /** Wheel finish tweaks (alloy roughness/tint, plastic finish). Each
   *  field shallow-merges over the model's `wheelFinish` default. */
  wheelFinish?: Partial<VehicleModelConfig['wheelFinish']>;
  /** Per-light emissive boost (brake / reverse / headlight). Shallow
   *  merge over `cfg.lightTuning` — pick any subset to tune. */
  lightTuning?: Partial<VehicleModelConfig['lightTuning']>;
  /** Window glass finish tweaks (outer envMultiplier, opacity, tint;
   *  inner mixed opacity, env; inner solo env). Shallow merge over
   *  `cfg.glassFinish`. */
  glassFinish?: Partial<VehicleModelConfig['glassFinish']>;

  // Legacy glass fine-tuning (still in transit toward `glassFinish`).
  glass?: GlassOverrides;

  // Custom wraps (per-paint PNG overlay).
  wraps?: {
    /** Override the wrap source URL. When set, takes precedence over
     *  the user-uploaded wrap. Used by the Showroom "Templates Tesla"
     *  preset grid to preview one of the bundled wraps under
     *  `/public/wraps/` without uploading it first. Can also point
     *  at a specific library upload via
     *  `/api/vehicle/{carId}/showroom/wraps/{wrapId}` — see
     *  `wrapPngUrlById`. When unset AND uploads exist on the server,
     *  the renderer falls back to the most-recent upload via the
     *  legacy `/wrap` endpoint. */
    paintTextureUrl?: string;
    /** Texture rotation in 90° steps applied around the UV centre
     *  (0.5, 0.5). One of 0/90/180/270 — degrees, counter-clockwise.
     *  Lets the user re-align an uploaded PNG without re-exporting it
     *  from Photoshop: Tesla's UV unwrap layout doesn't always match
     *  the convention a PNG author would assume (top-down "U =
     *  horizontal" mental model vs Tesla's U = longitudinal). When
     *  unset, defaults to 0. */
    rotationDeg?: 0 | 90 | 180 | 270;
    /** Per-car wrap finish — drives the shader uniforms that control
     *  how brilliant / matte / metallic the wrap renders on the body.
     *  Every field is OPTIONAL; missing fields fall back to the
     *  shader defaults baked in `VehicleTopView3D.tsx` (DEFAULT_WRAP_*).
     *  Tweaked live from the Showroom — every value change mutates the
     *  active shader uniform directly without recompiling. */
    finish?: {
      /** PNG colour multiplier — compensates for the fact that Tesla's
       *  reference shader divides the wrap by 10 then re-injects HDR
       *  skybox brightness (which we don't have in three.js). 0.3 by
       *  default; raise toward 1.0 to brighten a wrap that reads too
       *  dark, lower toward 0.1 to dim a wrap that looks blown-out. */
      brightness?: number;
      /** PBR roughness on wrapped areas. 0 = mirror, 1 = chalk.
       *  Default 0.25 (glossy car-paint clearcoat). */
      roughness?: number;
      /** PBR metalness on wrapped areas. 0 = dielectric (vinyl-like),
       *  1 = pure metal. Default 0.5 — keeps a real metallic-flake
       *  specular highlight without losing the wrap's colour. */
      metalness?: number;
      /** Environment-map reflection strength on the Paint material
       *  while the wrap is active. Default 1.6 — we boost above 1.0
       *  to compensate for the missing Tesla HDR skybox term. */
      envMapIntensity?: number;
    };
  };
}

/**
 * Resolve the active model BEFORE merging overrides. The user's
 * explicit `modelKey` choice always wins; otherwise we fall back to
 * VIN-based detection (so cars without an override still work).
 */
export function pickResolvedModelKey(
  vin: string | null | undefined,
  overrides: ShowroomOverrides | null | undefined,
): VehicleModelKey {
  if (overrides?.modelKey) return overrides.modelKey;
  return vinModelKey(vin);
}

// ─── Per-model blob (v2) ────────────────────────────────────────────────────
//
// Cars used to store ONE flat `ShowroomOverrides` blob, with the model
// chosen via an in-blob `modelKey`. That meant testing / tuning a second
// model on a car OVERWROTE the first model's calibration (the whole blob is
// replaced on save). The v2 blob namespaces overrides BY MODEL so each model
// the user calibrates on a car keeps its own independent slot, and switching
// models for a quick test never clobbers another.
//
//   { schema: 2, activeModelKey?, models: { poppyseed: {...}, community: {...} } }
//
// `activeModelKey` is the model the car DISPLAYS everywhere (Home, cards);
// when absent it falls back to VIN detection. Backward compat: a legacy flat
// blob is migrated on read by `normalizeBlob`; the next save rewrites it as
// v2. No DB migration needed (the column is opaque jsonb).

/** A car's per-model Showroom blob. */
export interface ShowroomBlobV2 {
  schema: 2;
  /** Model the car renders everywhere. Absent → VIN detection. */
  activeModelKey?: VehicleModelKey;
  /** Per-model override slots (each WITHOUT a `modelKey` field — it's
   *  the map key). */
  models: Partial<Record<VehicleModelKey, ShowroomOverrides>>;
}

/** Type guard — true for the v2 namespaced blob, false for a legacy flat
 *  `ShowroomOverrides`. */
export function isBlobV2(raw: unknown): raw is ShowroomBlobV2 {
  return (
    !!raw &&
    typeof raw === 'object' &&
    (raw as { schema?: unknown }).schema === 2 &&
    typeof (raw as { models?: unknown }).models === 'object' &&
    (raw as { models?: unknown }).models !== null
  );
}

/** VIN → default model key. Community is never auto-detected (no VIN maps
 *  to it) — it must be selected explicitly via `activeModelKey`. */
export function vinModelKey(vin: string | null | undefined): VehicleModelKey {
  if (!vin) return 'poppyseed';
  return vin.toUpperCase().charAt(3) === 'Y' ? 'bayberry' : 'poppyseed';
}

/** Migrate any stored shape (legacy flat OR v2) into the canonical v2
 *  form. Pure — never mutates its input. */
export function normalizeBlob(
  raw: unknown,
  vin: string | null | undefined,
): ShowroomBlobV2 {
  if (isBlobV2(raw)) {
    return {
      schema: 2,
      activeModelKey: raw.activeModelKey,
      models: { ...raw.models },
    };
  }
  // Legacy flat blob: the whole object is one model's overrides; its
  // `modelKey` (if present) names the model AND becomes the active model.
  const flat = (raw && typeof raw === 'object' ? raw : {}) as ShowroomOverrides;
  const { modelKey, ...rest } = flat;
  const key = modelKey ?? vinModelKey(vin);
  const models: Partial<Record<VehicleModelKey, ShowroomOverrides>> = {};
  if (Object.keys(rest).length > 0) {
    models[key] = rest as ShowroomOverrides;
  }
  return { schema: 2, activeModelKey: modelKey, models };
}

/** The model a car DISPLAYS (explicit `activeModelKey` then VIN). */
export function resolveActiveModelKey(
  vin: string | null | undefined,
  raw: unknown,
): VehicleModelKey {
  return normalizeBlob(raw, vin).activeModelKey ?? vinModelKey(vin);
}

/** Flatten a v2 blob to the single-model `ShowroomOverrides` the resolver
 *  expects (with `modelKey` set so model selection stays correct).
 *  `forcedKey` previews a model other than the car's displayed one — used
 *  by the Showroom editor. */
export function selectModelOverrides(
  raw: unknown,
  vin: string | null | undefined,
  forcedKey?: VehicleModelKey,
): ShowroomOverrides {
  const blob = normalizeBlob(raw, vin);
  const key = forcedKey ?? blob.activeModelKey ?? vinModelKey(vin);
  return { ...(blob.models[key] ?? {}), modelKey: key };
}

/** Read one model's saved override slot (without `modelKey`). Hydrates the
 *  Showroom editor for the selected model. */
export function modelSlot(
  raw: unknown,
  vin: string | null | undefined,
  key: VehicleModelKey,
): ShowroomOverrides {
  return normalizeBlob(raw, vin).models[key] ?? {};
}

/** Build the v2 blob to persist after editing ONE model's slot, preserving
 *  every other model's slot. `activeModelKey` is set explicitly by the
 *  caller so saving a test calibration never changes what the car
 *  displays unless the user opted in. */
export function buildSavedBlob(
  prevRaw: unknown,
  vin: string | null | undefined,
  key: VehicleModelKey,
  slot: ShowroomOverrides,
  activeModelKey: VehicleModelKey | undefined,
): ShowroomBlobV2 {
  const blob = normalizeBlob(prevRaw, vin);
  // Strip a stray modelKey from the slot — it's namespaced by the map key.
  const { modelKey: _drop, ...cleanSlot } = slot;
  void _drop;
  return {
    schema: 2,
    activeModelKey,
    models: { ...blob.models, [key]: cleanSlot as ShowroomOverrides },
  };
}

/**
 * Apply per-corner wheel overrides on top of the model's default
 * positions. Each corner is treated independently — missing corners
 * keep their shipped defaults so a single-corner tweak doesn't blow
 * away the other three.
 */
function mergeWheelPositions(
  defaults: ReadonlyArray<WheelFallbackPosition>,
  overrides: ShowroomOverrides['wheelFallbackPositions'] | undefined,
): ReadonlyArray<WheelFallbackPosition> {
  if (!overrides) return defaults;
  return defaults.map((w) => {
    const ov = overrides[w.id];
    if (!ov) return w;
    return {
      id: w.id,
      x: ov.x ?? w.x,
      y: ov.y ?? w.y,
      z: ov.z ?? w.z,
      flipZ: ov.flipZ ?? w.flipZ,
      rotY: ov.rotY ?? w.rotY ?? 0,
    };
  });
}

/**
 * Merge a Showroom override on top of a base config. Returns a NEW
 * object — defaults are never mutated.
 *
 * Semantics for each field:
 *   - Scalar / hex color / tuple : override REPLACES default (entirely).
 *   - Object with sub-fields     : SHALLOW MERGE (sub-field-by-sub-field).
 *   - wheelFallbackPositions     : per-corner merge (see helper above).
 *
 * Fields that don't exist on `VehicleModelConfig` yet (glass, wraps)
 * are PASSED THROUGH on the result object so downstream consumers can
 * read them via a type cast — until the Phase 3 refactor brings them
 * into `VehicleModelConfig` proper.
 */
export function mergeShowroomConfig(
  defaults: VehicleModelConfig,
  overrides: ShowroomOverrides | null | undefined,
): VehicleModelConfig {
  if (!overrides) return defaults;

  return {
    ...defaults,
    // wheelUrl swap (different wheel design)
    wheelUrl: overrides.wheelUrl ?? defaults.wheelUrl,

    // Camera (object → shallow merge of position/target/fov)
    cameraPose: overrides.cameraPose
      ? { ...defaults.cameraPose, ...overrides.cameraPose }
      : defaults.cameraPose,

    // Charging-mode camera pose (optional on both sides → only emit
    // when at least one side defines it; merge shallowly otherwise).
    chargingCameraPose: overrides.chargingCameraPose
      ? {
          ...(defaults.chargingCameraPose ?? defaults.cameraPose),
          ...overrides.chargingCameraPose,
        }
      : defaults.chargingCameraPose,

    // Wheels (array → per-corner merge)
    wheelFallbackPositions: mergeWheelPositions(
      defaults.wheelFallbackPositions,
      overrides.wheelFallbackPositions,
    ),

    // Charge port (object → shallow merge)
    chargePort: overrides.chargePort
      ? { ...defaults.chargePort, ...overrides.chargePort }
      : defaults.chargePort,

    // Cable ground anchor (tuple → replace entirely)
    cableGroundAnchor: overrides.cableGroundAnchor ?? defaults.cableGroundAnchor,

    // Cable slack (per-segment scalars → replace each independently)
    cableSlack: {
      post: overrides.cableSlackPost ?? defaults.cableSlack.post,
      car: overrides.cableSlackCar ?? defaults.cableSlack.car,
    },

    // Supercharger post (object → shallow merge)
    supercharger: overrides.supercharger
      ? { ...defaults.supercharger, ...overrides.supercharger }
      : defaults.supercharger,

    // Sentry cameras (array → replace entirely; the geometry is
    // tightly coupled so per-camera merge would be confusing)
    sentryCameraPositions: overrides.sentryCameraPositions ?? defaults.sentryCameraPositions,

    // Visual chrome (scalars)
    bodyPaintColor: overrides.bodyPaintColor ?? defaults.bodyPaintColor,
    calloutHeight: overrides.calloutHeight ?? defaults.calloutHeight,
    // Per-callout XYZ nudge — shallow merge so a user override on a
    // single callout (e.g. lock) doesn't reset the others; absent keys
    // fall back to the model defaults (currently undefined for every
    // shipped model — anchors are already well-placed by hand).
    calloutOffsets: overrides.calloutOffsets
      ? { ...(defaults.calloutOffsets ?? {}), ...overrides.calloutOffsets }
      : defaults.calloutOffsets,
    // Per-callout visibility — same shallow-merge pattern. Stored on
    // the resolved config so the viewer can filter callouts without
    // re-resolving the override blob at every render. Defaults absent
    // for every shipped model (all 7 callouts visible by default).
    calloutsHidden: overrides.calloutsHidden
      ? { ...(defaults.calloutsHidden ?? {}), ...overrides.calloutsHidden }
      : defaults.calloutsHidden,

    // Interior colours — per-slot override keyed on the entry's `key`.
    // Each entry keeps its matchName/roughness/metalness from the
    // model default; only `color` is replaceable. Models without
    // `interiorOverrides` pass through unchanged (undefined).
    interiorOverrides: defaults.interiorOverrides?.map((ov) => ({
      ...ov,
      color: overrides.interiorColors?.[ov.key] ?? ov.color,
    })),

    // Wheel finish — shallow merge (every field is optional on the
    // override, falls back to the default).
    wheelFinish: overrides.wheelFinish
      ? { ...defaults.wheelFinish, ...overrides.wheelFinish }
      : defaults.wheelFinish,

    // Light tuning — shallow merge (intensity + colour per slot).
    lightTuning: overrides.lightTuning
      ? { ...defaults.lightTuning, ...overrides.lightTuning }
      : defaults.lightTuning,

    // Glass finish — shallow merge (outer + inner mixed/solo params).
    glassFinish: overrides.glassFinish
      ? { ...defaults.glassFinish, ...overrides.glassFinish }
      : defaults.glassFinish,

    // Variant axes — for each axis declared on the model, pick the
    // user's override option if it exists, otherwise the axis's
    // `defaultOption`. Unknown axis ids or unknown option ids are
    // ignored so a stale save against a refactored model never breaks
    // the viewer.
    activeVariants: (() => {
      const axes = defaults.variantAxes;
      if (!axes || axes.length === 0) return undefined;
      const out: Record<string, string> = {};
      for (const axis of axes) {
        const userChoice = overrides.variants?.[axis.id];
        const valid =
          userChoice && axis.options.some((o) => o.id === userChoice);
        out[axis.id] = valid ? userChoice : axis.defaultOption;
      }
      return out;
    })(),
  };
}

/**
 * Resolve a full config (the right model + overrides applied) from a
 * VIN and an override blob. Single entry point used both by the viewer
 * (with backend overrides) and the Showroom page (with local-edit
 * overrides that haven't been saved yet).
 */
export function resolveModelConfig(
  vin: string | null | undefined,
  overrides: ShowroomOverrides | ShowroomBlobV2 | null | undefined,
  forcedKey?: VehicleModelKey,
): VehicleModelConfig {
  // A v2 blob (from the backend) is flattened to its active model's slot
  // first; a flat blob (legacy DB rows + the Showroom's in-flight edits)
  // passes through unchanged so existing behaviour is preserved.
  // `forcedKey` pins a specific model (its own override slot + defaults)
  // regardless of VIN/activeModelKey — used by the automatic
  // community fallback when the VIN-detected GLB is missing.
  const flat = isBlobV2(overrides)
    ? selectModelOverrides(overrides, vin, forcedKey)
    : forcedKey
      ? { ...(overrides ?? {}), modelKey: forcedKey }
      : overrides;
  const key = forcedKey ?? pickResolvedModelKey(vin, flat);
  const defaults = VEHICLE_MODELS[key] ?? PoppyseedConfig;
  return mergeShowroomConfig(defaults, flat);
}

/**
 * The Showroom often needs the "extended" config that includes glass
 * tweaks (not yet on `VehicleModelConfig` — being migrated in Phase 3)
 * and reserved future fields (wraps). This helper returns the merged
 * config PLUS the raw overrides so the viewer can read them during the
 * transition.
 */
export interface ResolvedModelExtras {
  config: VehicleModelConfig;
  glass: GlassOverrides | undefined;
  wraps: ShowroomOverrides['wraps'] | undefined;
}

export function resolveModelExtras(
  vin: string | null | undefined,
  overrides: ShowroomOverrides | ShowroomBlobV2 | null | undefined,
  forcedKey?: VehicleModelKey,
): ResolvedModelExtras {
  const flat = isBlobV2(overrides)
    ? selectModelOverrides(overrides, vin, forcedKey)
    : forcedKey
      ? { ...(overrides ?? {}), modelKey: forcedKey }
      : overrides;
  return {
    config: resolveModelConfig(vin, flat, forcedKey),
    glass: flat?.glass,
    wraps: flat?.wraps,
  };
}

/**
 * Build a COMPLETE override blob holding every effective value (model
 * default where the user didn't override, the user's value where they
 * did). Used by the Showroom "Copier JSON complet" button so the user
 * can archive / share a fully self-describing calibration rather than
 * the compact delta that "Copier JSON" emits.
 *
 * The output is a valid `ShowroomOverrides` — re-importing it reproduces
 * the exact look regardless of future changes to the code defaults.
 */
export function buildEffectiveOverrides(
  defaults: VehicleModelConfig,
  overrides: ShowroomOverrides | null | undefined,
): ShowroomOverrides {
  const cfg = mergeShowroomConfig(defaults, overrides);
  const ov = overrides ?? {};

  const wheelFallbackPositions: Partial<Record<WheelCorner, WheelPositionOverride>> = {};
  for (const w of cfg.wheelFallbackPositions) {
    wheelFallbackPositions[w.id as WheelCorner] = {
      x: w.x,
      y: w.y,
      z: w.z,
      flipZ: w.flipZ,
      rotY: w.rotY ?? 0,
    };
  }

  const interiorColors: Record<string, number> = {};
  for (const io of cfg.interiorOverrides ?? []) {
    interiorColors[io.key] = io.color;
  }

  const out: ShowroomOverrides = {
    cameraPose: { ...cfg.cameraPose },
    chargingCameraPose: cfg.chargingCameraPose
      ? { ...cfg.chargingCameraPose }
      : undefined,
    wheelUrl: cfg.wheelUrl,
    wheelFallbackPositions:
      Object.keys(wheelFallbackPositions).length > 0
        ? wheelFallbackPositions
        : undefined,
    chargePort: { ...cfg.chargePort },
    cableGroundAnchor: [...cfg.cableGroundAnchor] as [number, number, number],
    cableSlackPost: cfg.cableSlack.post,
    cableSlackCar: cfg.cableSlack.car,
    supercharger: cfg.supercharger ? { ...cfg.supercharger } : undefined,
    sentryCameraPositions: cfg.sentryCameraPositions.map(
      (p) => [...p] as [number, number, number],
    ),
    bodyPaintColor: cfg.bodyPaintColor,
    calloutHeight: cfg.calloutHeight,
    calloutOffsets: cfg.calloutOffsets ? { ...cfg.calloutOffsets } : undefined,
    calloutsHidden: cfg.calloutsHidden ? { ...cfg.calloutsHidden } : undefined,
    interiorColors:
      Object.keys(interiorColors).length > 0 ? interiorColors : undefined,
    wheelFinish: { ...cfg.wheelFinish },
    lightTuning: { ...cfg.lightTuning },
    glassFinish: { ...cfg.glassFinish },
    variants: cfg.activeVariants ? { ...cfg.activeVariants } : undefined,
  };

  // Legacy / passthrough fields with no config-side default — keep the
  // user's value verbatim so an effective export round-trips fully.
  if (ov.glass) out.glass = ov.glass;
  if (ov.wraps) out.wraps = ov.wraps;
  if (ov.modelKey) out.modelKey = ov.modelKey;

  return out;
}
