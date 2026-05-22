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

  // Phase 5+: custom wraps (per-paint PNG overlay). Reserved.
  wraps?: {
    /** URL of a PNG that gets applied as baseColorTexture on every
     *  body paint material. Disabled until the wrap pipeline ships. */
    paintTextureUrl?: string;
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
  if (!vin) return 'poppyseed';
  const code = vin.toUpperCase().charAt(3);
  if (code === 'Y') return 'bayberry';
  return 'poppyseed';
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

    // Sentry cameras (array → replace entirely; the geometry is
    // tightly coupled so per-camera merge would be confusing)
    sentryCameraPositions: overrides.sentryCameraPositions ?? defaults.sentryCameraPositions,

    // Visual chrome (scalars)
    bodyPaintColor: overrides.bodyPaintColor ?? defaults.bodyPaintColor,
    calloutHeight: overrides.calloutHeight ?? defaults.calloutHeight,

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
  overrides: ShowroomOverrides | null | undefined,
): VehicleModelConfig {
  const key = pickResolvedModelKey(vin, overrides);
  const defaults = VEHICLE_MODELS[key] ?? PoppyseedConfig;
  return mergeShowroomConfig(defaults, overrides);
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
  overrides: ShowroomOverrides | null | undefined,
): ResolvedModelExtras {
  return {
    config: resolveModelConfig(vin, overrides),
    glass: overrides?.glass,
    wraps: overrides?.wraps,
  };
}
