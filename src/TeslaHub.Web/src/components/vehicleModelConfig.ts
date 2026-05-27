/**
 * Per-vehicle-model 3D viewer configuration.
 *
 * Tesla's mobile app ships separate Godot scenes for each car family
 * (Poppyseed = Model 3 Highland, Bayberry = Model Y Juniper, Palladium
 * = Model S/X refresh, etc.). Each scene has its own dimensions, charge
 * port location, wheelbase and Sentry hardware layout. To keep the
 * viewer code identical across cars we lift every model-specific
 * constant into this file, keyed by a short model identifier, and let
 * the runtime swap configs based on the active VIN.
 *
 * Things that are NOT in this config (deliberately):
 *   - Node-name conventions Tesla reuses across all car families
 *     (`Hood_Spatial`, `Trunk_Spatial`, `Charge_Cap_Spatial`,
 *     `Brake_Lights_Center`, `Headlights`, etc.). These are baked into
 *     the consumer components and only need to be lifted here if a
 *     specific model deviates.
 *   - Tesla material naming regex (`Paint_*`, `Plastic_*`, `Glass_*`).
 *     Identical across the Godot scenes we've inspected.
 *
 * Adding a new model = add a new entry to VEHICLE_MODELS, populate the
 * fields (most copied from the closest existing model and tweaked by
 * eye against the real GLB), and update `pickModelForVin` if VIN-based
 * selection differs from the default fallback. The viewer code stays
 * untouched.
 *
 * Coordinate system used throughout (matches Tesla's Godot export):
 *   +X = forward (front of car)
 *   +Y = up
 *   +Z = right (passenger side)
 */

import type {
  OpeningDefinition,
  OpeningTrack,
} from './vehicleOpeningTypes';
import { OPENINGS_POPPYSEED } from './poppyseedOpenings';
import { MIRROR_TRACKS_POPPYSEED } from './poppyseedOpenings';
import { OPENINGS_BAYBERRY } from './bayberryOpenings';

/**
 * Every floating callout key the viewer knows about. Used to type
 * `calloutOffsets` and `calloutsHidden` so the compiler catches a
 * typo'd key at every override site. The canonical source of truth
 * is `CalloutKey` in `VehicleCallouts.tsx` — this duplicate exists
 * here to avoid a circular import (vehicleModelConfig → VehicleCallouts
 * → vehicleModelConfig). Keep the two in sync when adding callouts.
 */
export type CalloutKeyName =
  // Action callouts (clickable)
  | 'frunk'
  | 'trunk'
  | 'chargePort'
  | 'window'
  | 'lock'
  | 'sentry'
  | 'climate'
  | 'defrost'
  | 'flash'
  | 'honk'
  // Data callouts (read-only)
  | 'tpmsFL'
  | 'tpmsFR'
  | 'tpmsRL'
  | 'tpmsRR'
  | 'userPresent'
  | 'climateInfo';

/** Tesla internal codename for each car family. */
export type VehicleModelKey = 'poppyseed' | 'bayberry';

/** Each wheel mount when the GLB doesn't ship anchor empties. */
export interface WheelFallbackPosition {
  id: 'LF' | 'RF' | 'LR' | 'RR';
  x: number;
  y: number;
  z: number;
  /** Tesla's exported wheel cover faces +Z. Wheels on the left side
   *  (-Z) need scale.z = -1 to re-orient the cover outward. */
  flipZ: boolean;
  /** Extra Y rotation (yaw) in DEGREES applied to the wheel wrapper.
   *  Useful when a swapped wheel GLB (Cypress, E41…) was exported with
   *  a different "front" axis than the original; tune until the
   *  hubcap pattern faces the right way. Default 0. */
  rotY?: number;
}

/**
 * One option inside a variant axis (e.g. 'lhd' inside the
 * `driveLayout` axis, or 'standard' inside `trim`).
 */
export interface VariantOption {
  /** Stable identifier (lowercase, no spaces). */
  id: string;
  /** Display label in the Showroom UI. */
  label: string;
  /** Node names visible ONLY when THIS option is active. Nodes not
   *  listed in ANY variant option remain visible at all times. */
  ownedNodes: ReadonlyArray<string>;
}

/**
 * One independent configuration dimension of the model (e.g. trim,
 * drive layout, market region, audio package). Each axis is
 * orthogonal — picking 'rhd' on the drive axis doesn't affect the
 * 'performance' choice on the trim axis. The Showroom UI renders
 * one button group per axis.
 */
export interface VariantAxis {
  /** Stable identifier (e.g. 'trim', 'driveLayout', 'market'). */
  id: string;
  /** Display label in the Showroom UI (e.g. 'Trim', 'Conduite'). */
  label: string;
  /** Option id selected when no Showroom override is present.
   *  Persisted blobs only store DEVIATIONS from this default, so
   *  switching the default later still applies cleanly to existing
   *  saved cars. */
  defaultOption: string;
  /** All options for this axis. Order matters — first one is shown
   *  on the left in the UI. */
  options: ReadonlyArray<VariantOption>;
}

export interface VehicleModelConfig {
  // ───────────────────────────────────────────────────────────────────
  // Identification
  // ───────────────────────────────────────────────────────────────────
  /** Internal Tesla codename — also the GLB filename root. */
  key: VehicleModelKey;
  /** Marketing name for diagnostics / dev tools. */
  displayName: string;
  /** Body GLB URL, relative to public/. */
  modelUrl: string;
  /** Default wheel GLB URL (D50 hubcap on Highland, Gemini on Y). */
  wheelUrl: string;

  // ───────────────────────────────────────────────────────────────────
  // Camera framing — needs to be RE-CALIBRATED PER MODEL
  // ───────────────────────────────────────────────────────────────────
  cameraPose: {
    /** Camera world position, metres. */
    position: [number, number, number];
    /** OrbitControls.target — what the camera looks at. */
    target: [number, number, number];
    /** Vertical field of view, degrees. */
    fov: number;
  };

  // ───────────────────────────────────────────────────────────────────
  // Wheel placement — needed when GLB anchor empties are stripped
  // ───────────────────────────────────────────────────────────────────
  /** Hub-centre positions in world space; varies with wheelbase and
   *  track width. Y is the wheel-centre height (tyre radius). */
  wheelFallbackPositions: ReadonlyArray<WheelFallbackPosition>;
  /** Spatial node names Godot writes for each wheel mount point.
   *  Usually stripped by PackedSceneGLTF — kept as a best-effort
   *  first pass. Anchor lookup BEFORE falling back to positions. */
  wheelAnchorNames: ReadonlyArray<{ name: string; mirror: boolean }>;

  // ───────────────────────────────────────────────────────────────────
  // Charge port + cable geometry — per-model placement
  // ───────────────────────────────────────────────────────────────────
  chargePort: {
    /** Scene node carrying the trapdoor hinge pivot. */
    nodeName: string;
    /** Alternate names tried when nodeName is absent. */
    alternateNames: ReadonlyArray<string>;
    /** Fallback world position used when no node matches. */
    fallbackWorld: [number, number, number];
    /** Offset from the hinge pivot to the actual plug socket. */
    pivotToSocketOffset: [number, number, number];
    /** Unit vector pointing FROM the plug INTO the port (perpendicular
     *  to the body where the port sits). Cybertruck plug points in a
     *  different direction, hence per-model. */
    plugDirection: [number, number, number];
  };
  /** Where the procedural cable's ground end drapes (typically a few
   *  metres behind / outside the rear bumper). */
  cableGroundAnchor: [number, number, number];

  /** Tesla Supercharger V3/V4 post placement — shown when the car is
   *  plugged in or charging. The cable runs SC port → ground anchor →
   *  charge port. Calibrated per car in the Showroom. */
  supercharger: {
    /** GLB URL relative to public/. */
    modelUrl: string;
    /** World position of the SC base origin (metres). */
    position: [number, number, number];
    /** Y-axis rotation in degrees — faces the post toward the car. */
    rotationY: number;
    /** Local offset from the SC base origin to the cable connector
     *  (applied before rotationY). Tune in Showroom until the orange
     *  debug marker sits on the handle recess. */
    cablePortOffset: [number, number, number];
  };

  /** Optional secondary camera pose used while the car is charging — lets
   *  the showroom / Home animate to a 3/4 rear view that nicely frames
   *  the Supercharger + car together. When null the regular `cameraPose`
   *  is used regardless of charging state. */
  chargingCameraPose?: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };

  // ───────────────────────────────────────────────────────────────────
  // Action anchors — pivots used by callouts to attach floating buttons
  // ───────────────────────────────────────────────────────────────────
  /** Node names where each interactive callout button anchors.
   *  All entries must resolve to a node present in the GLB. The Showroom
   *  editor (PR-6) will later let users override these positions on a
   *  per-car basis via `showroomOverrides.calloutPositions`, but the
   *  defaults here are what every car sees out of the box. */
  actionAnchors: {
    frunk: string;
    trunk: string;
    chargePort: string;
    /** Representative window node — chosen for left-front for camera
     *  framing (closest to default orbit pose). */
    window: string;
    /** Lock/unlock callout — driver door is the conventional Tesla
     *  touch-to-unlock zone. */
    lock: string;
    /** Sentry-mode toggle. Anchored near a B-pillar camera when the
     *  model exposes mirror nodes (Poppyseed/M3), else fall back to
     *  the rear-left door (Bayberry/Y has mirrors fused into door
     *  meshes — no separate anchor available). */
    sentry: string;
    /** Climate ON/OFF — passenger-side anchor so it doesn't visually
     *  conflict with lock (driver-side). */
    climate: string;
  };

  // ───────────────────────────────────────────────────────────────────
  // Sentry pulse dot positions — per-model hardware layout
  // ───────────────────────────────────────────────────────────────────
  /** Number of physical Sentry cameras varies — Model 3 Highland has 7
   *  (front centre + 2 fenders + 2 B-pillars + rear plate + front bumper
   *  centre). Each entry becomes a single pulsing dot. */
  sentryCameraPositions: ReadonlyArray<[number, number, number]>;

  // ───────────────────────────────────────────────────────────────────
  // Light effect node names
  // ───────────────────────────────────────────────────────────────────
  brakeLightNodes: ReadonlyArray<string>;
  reverseLightNodes: ReadonlyArray<string>;
  headlightNodes: ReadonlyArray<string>;
  groundProjectionNodes: {
    headlights: string;
    stoplights: string;
  };

  // ───────────────────────────────────────────────────────────────────
  // Scene cleanup — Godot artefacts to strip / hide on load
  // ───────────────────────────────────────────────────────────────────
  /** Permanently removed from the scene graph (Godot artefacts that
   *  serve no purpose in a static viewer: defrost overlays, plate
   *  viewport, etc.). */
  hiddenNodes: ReadonlyArray<string>;
  /** Floor / studio-shadow mesh names. Kept visible but recoloured to
   *  pitch black via the floor shadow logic. */
  floorNodes: ReadonlyArray<string>;

  // ───────────────────────────────────────────────────────────────────
  // Material patterns — Tesla renames between car families
  // ───────────────────────────────────────────────────────────────────
  /** Regex matched against material names AND outer-glass node names to
   *  decide what to recolour as body paint, what to tint as glass, and
   *  the hex of the body paint override (white-multicoat by default). */
  materialPatterns: {
    /** Material names that are body paint surfaces (overridden to
     *  `bodyPaintColor`). E.g. M3 = /^paint(_|skybox|$)/i,
     *  Y = /^paint(_|rough|$)/i (covers `Paint` + `PaintRough`). */
    bodyPaint: RegExp;
    /** Material names that are OUTER tintable glass. MUST exclude
     *  light-cover materials (Tesla's `Glass_Lights` on the M3 is NOT
     *  windshield glass — it's the headlight cover; tinting it like
     *  side windows turns the front lights into red bricks).
     *
     *  Recommended pattern per model:
     *   - M3 : `/^glass(_tinted)?(_fade)?$/i`  (Glass + Glass_Tinted + Glass_Tinted_Fade)
     *   - Y  : `/^glass(_windows)?(_fade)?$/i` (Glass + Glass_Windows + Glass_Windows_Fade)
     *
     *  In both cases, `Glass_Lights*` and `Glass_Interior*` are
     *  intentionally NOT matched here. */
    outerGlassMaterial: RegExp;
    /** Material names that are the INSIDE (cabin-side) pane of an
     *  exterior glass surface. Tesla layers windshield/door windows
     *  with `Glass` (outer) + `Glass_Interior` (inner) where the inner
     *  pane has roughness ≈ 0.01 — effectively a perfect mirror that
     *  reflects the HDR sky and overpowers the outer tint. We don't
     *  tint these (they're already pitch black) but we kill their
     *  reflection so the outer glass tint can dominate. Match
     *  `Glass_Interior`, `Glass_Interior_Fade`, `Glass_Interior_*`. */
    innerGlassMaterial: RegExp;
    /** Subset of inner-glass materials that must be DEMOTED to the
     *  dimmed-inner-pane treatment (low opacity ≈ 0.08, kill mirror)
     *  regardless of their parent node. The default OUTER/roof code
     *  path bumps inner-pane opacity to 0.90 — that's what makes M3
     *  panoramic roof and door windows look properly tinted. But the
     *  Bayberry windshield (Fade mesh) is also paired with an inner
     *  pane named `Glass_Interior_Fade`, and Tesla wants the windshield
     *  translucent (not opaque grey). List those exceptions here.
     *  Undefined / empty → all inner panes follow the default OUTER
     *  treatment (correct for M3 Highland). */
    dimmedInnerGlassMaterial?: RegExp;
  };

  // ───────────────────────────────────────────────────────────────────
  // Glass zoning — per-zone mesh classification (door / pano / trunk)
  // ───────────────────────────────────────────────────────────────────
  /** Maps an OUTER-glass mesh to one of three calibration zones based
   *  on its parent node chain. Each zone has its own opacity / tint
   *  slider in the Showroom so the user can dial the panoramic roof,
   *  the side windows, and the trunk hatch independently.
   *
   *  CRITICAL: any mesh that doesn't match ANY of these patterns is
   *  considered "unzoned" and SKIPPED by the glass routing — this is
   *  the firewall that stops sliders from leaking onto the headlight
   *  covers (Tesla shares the `Glass_Lights` material on M3 and the
   *  `Glass` material on Y between body glass and light covers, so
   *  material-name matching alone is not sufficient).
   *
   *  Per-model recommendations:
   *   - M3 doorWindow : /^window_(l|r)[fr]$/i        → 4 door windows
   *   - M3 panoroof   : /^windows_top$/i             → ALL upper glass (pano + windshield + lunette + custodes)
   *   - Y  doorWindow : /^window_(fl|fr|rl|rr)$/i    → 4 door windows
   *   - Y  panoroof   : /^fade$/i                    → panoramic roof + windshield + rear hatch glass
   *   - Y  trunkGlass : /^trunk_cover(_main)?$/i     → trunk hatch outer glass (separate slider)
   *   - Y  sharedBody : /^static_(door_)?exterior$/i → windshield primitive in Static_Exterior (treated as pano) */
  glassZoning: {
    /** Parent-node regex for the 4 door windows. */
    doorWindowNode: RegExp;
    /** Parent-node regex for the panoramic roof + windshield mesh.
     *  Mesh that bundles pano+windshield+lunette on a single Group. */
    panoroofNode: RegExp;
    /** Parent-node regex for the trunk hatch outer glass.
     *  Y only — `Trunk_Cover_Main`. Leave undefined on models where
     *  the lunette is part of the pano (M3 Windows_Top). */
    trunkGlassNode?: RegExp;
    /** Parent-node regex for shared exterior groups whose glass
     *  primitives should be treated as PANO (typically the windshield
     *  primitive that ships unmarked inside `Static_Exterior` on Y).
     *  Undefined on M3 where every glass mesh has a dedicated parent. */
    sharedBodyNode?: RegExp;
  };

  // ───────────────────────────────────────────────────────────────────
  // Nodes whose meshes must STAY HIDDEN (never visible regardless of
  // state). Different from `hiddenNodes` (which is for one-shot scene
  // pruning at load) — `permanentlyHiddenNodes` are re-asserted every
  // frame via the cleanedScene memo so that VehicleLightEffects /
  // useGroundProjections / scene-reset logic can't accidentally turn
  // them back on. Use for "ugly leftover" geometry like the M3 high-beam
  // cluster on Y E41 (HighBeam_Left/Right, DRL_Left/Right) which sits
  // on the bumper at the wrong Y and ruins the front render.
  // ───────────────────────────────────────────────────────────────────
  permanentlyHiddenNodes?: ReadonlyArray<string>;
  /** RGB hex applied to every material matching `materialPatterns.bodyPaint`. */
  bodyPaintColor: number;

  // ───────────────────────────────────────────────────────────────────
  // Interior material overrides — recolour Tesla's placeholder colours
  // ───────────────────────────────────────────────────────────────────
  /** Some Tesla GLB exports ship interior materials as untextured flat
   *  colours used as authoring placeholders (the Model Y Bayberry ships
   *  `Decor` = bright purple and `cupholder` = bright blue!). Override
   *  those by name here. Each entry mutates the matching MeshStandard
   *  material's `color` in place — shared materials are still shared,
   *  so a single override repaints every mesh that uses the material.
   *  Set to an empty array for models with proper interior textures. */
  interiorOverrides?: ReadonlyArray<{
    /** Stable identifier used by the Showroom UI as the override key
     *  (e.g. `Interior2`, `Decor`, `cupholder`, `Wing`). Lets the user
     *  pick a colour per slot without us having to round-trip a
     *  RegExp through JSON. */
    key: string;
    /** Match the material's `name` property exactly (case-insensitive). */
    matchName: RegExp;
    /** RGB hex to assign to `mat.color`. */
    color: number;
    /** Optional override of `mat.roughness` (0..1). */
    roughness?: number;
    /** Optional override of `mat.metalness` (0..1). */
    metalness?: number;
  }>;

  // ───────────────────────────────────────────────────────────────────
  // Glass finish — opacity / tint / reflection params for window glass
  // ───────────────────────────────────────────────────────────────────
  /** Tuning for the OUTER + INNER pane treatment that the viewer
   *  applies to every glass mesh. All values are multiplicative or
   *  absolute (opacity), defaults are conservative — increase
   *  `outerEnvMultiplier` to see more sky reflection, decrease the
   *  per-zone `*Tint` to darken a given zone further, etc.
   *
   *  Glossary of the three pane families the viewer recognises:
   *   - **Outer**       : the cabin-side outer layer (windshield, door
   *                       windows, panoramic roof). Carries the visible
   *                       tint + reflection.
   *   - **Inner mixed** : the inner pane behind an outer one (windshield
   *                       inner, front door windows). Tesla layered them
   *                       with a perfect-mirror material that we damp
   *                       and collapse to a faint veil so we can see
   *                       through the windshield.
   *   - **Inner solo**  : the rear door windows on the Y — Tesla used
   *                       ONLY the inner pane (no outer). The "mirror"
   *                       here IS what reads as tinted glass; we keep a
   *                       softened reflection. */
  glassFinish: {
    /** Multiplier applied to outer glass `envMapIntensity` (ALL zones) —
     *  dampens sky reflections so the tint is visible. Default 0.3. */
    outerEnvMultiplier: number;
    /** Opacity of the 4 door windows. Default 0.55. */
    doorWindowOpacity: number;
    /** Tint scalar multiplied into the door windows' diffuse colour
     *  (0 = black, 1 = GLB-native colour). Default 0.45. */
    doorWindowTint: number;
    /** Opacity of the panoramic roof (and the windshield/lunette glass
     *  that ships fused with it on M3 `Windows_Top` and Y `Fade`).
     *  Default 0.90. */
    panoroofOpacity: number;
    /** Tint scalar for the panoramic roof zone. Default 0.15. */
    panoroofTint: number;
    /** Opacity of the trunk hatch outer glass (Y `Trunk_Cover_Main`).
     *  Ignored on models without a dedicated trunk glass node (M3
     *  bundles its lunette into Windows_Top). Default 0.85. */
    trunkGlassOpacity: number;
    /** Tint scalar for the trunk hatch outer glass. Default 0.30. */
    trunkGlassTint: number;
    /** Final opacity of the inner mixed pane (windshield inner +
     *  front door inner). Very low so the windshield reads as see-
     *  through. Default 0.08. */
    innerMixedOpacity: number;
    /** Multiplier on inner mixed `envMapIntensity` — kills the mirror
     *  that would otherwise reflect the HDR sky through the windshield.
     *  Default 0.02. */
    innerMixedEnvMultiplier: number;
    /** Opacity forced on inner-solo panes (Y rear-door privacy glass).
     *  These have no outer layer so the inner pane carries the full
     *  tint. Default 0.85 (privacy). */
    innerSoloOpacity: number;
    /** Multiplier on inner solo `envMapIntensity` — keeps a soft
     *  reflection so the rear windows still read as glass. Default 0.6. */
    innerSoloEnvMultiplier: number;
  };

  // ───────────────────────────────────────────────────────────────────
  // Light tuning — emissive intensity + colour for body lights
  // ───────────────────────────────────────────────────────────────────
  /** Per-light emissive boost applied by VehicleLightEffects when the
   *  corresponding state is active (brake = pedal pressed, reverse =
   *  shift in R, headlight = drive gear). Each field is split into
   *  intensity (linear emissive multiplier, ~1.4–3.0) and colour
   *  (RGB hex). All required so the runtime never has to defensive-
   *  check; the Showroom override layer can supply partials. */
  lightTuning: {
    /** Rear brake-light cluster emissive boost. Set on every node in
     *  `brakeLightNodes`. */
    brakeIntensity: number;
    brakeColor: number;
    /** Reverse-light boost. Set on every node in `reverseLightNodes`. */
    reverseIntensity: number;
    reverseColor: number;
    /** Front headlight boost. Set on every node in `headlightNodes`.
     *  On models where the headlight geometry is hidden permanently
     *  (Y E41: the DRL and HighBeam left/right meshes are visually
     *  broken on the bumper), this is a no-op — the slider stays in
     *  the UI but won't move anything until a proper headlight target
     *  is wired up. */
    headlightIntensity: number;
    headlightColor: number;
  };

  // ───────────────────────────────────────────────────────────────────
  // Wheel finish — material tweaks for alloy + plastic wheel pieces
  // ───────────────────────────────────────────────────────────────────
  /** Polish parameters applied to every wheel mesh whose material name
   *  matches the alloy or plastic regexes hard-wired in
   *  VehicleTopView3D.tsx (`aluminum|chrome|metal_anodized|silver` for
   *  alloy, `plastic_black|rubber` for plastic). Per-model so a model
   *  family that ships brighter chrome can tune separately from one
   *  with matte rims. The Showroom UI exposes these as sliders / a
   *  colour picker. */
  wheelFinish: {
    /** Lower bound applied to the alloy material's `roughness`. Below
     *  this value the alloy looks like a mirror; default 0.35 reads as
     *  brushed alloy. 0 = polished, 1 = matte. */
    alloyRoughnessMin: number;
    /** Multiplier applied to alloy material's `envMapIntensity`. >1
     *  exaggerates the HDR sky reflection so the wheel pops against
     *  the dark window glass. Default 1.6. */
    alloyEnvBoost: number;
    /** Tint applied to alloy materials (multiplied into `mat.color`).
     *  Undefined = leave the GLB's native colour alone. Use to dial
     *  black-painted alloys, gold, bronze, etc. */
    alloyTint?: number;
    /** Clearcoat strength applied to alloy / rim materials. 0..1.
     *  When > 0 the material is silently upgraded to a
     *  `MeshPhysicalMaterial` and a thin lacquer layer is added on
     *  top of the diffuse alloy. This is the right tool for matte-
     *  black painted alloys like the Highland D50 hubcaps (which the
     *  classifier puts in the "alloy" bucket because their material
     *  name doesn't match the tire/rubber regex): the underlying
     *  matte stays matte but the clearcoat picks up the bright HDR
     *  sky so the hubcap reads as "polished black paint" rather than
     *  "absorbent black void". Default 0 (no upgrade, keeps the
     *  cheaper MeshStandardMaterial shader path). */
    alloyClearcoat: number;
    /** Roughness forced on plastic black / rubber materials. Default
     *  0.55 — sub-matte so brake-dust / tyre rubber reads correctly. */
    plasticRoughness: number;
    /** EnvMap boost for plastic. Default 1.5. */
    plasticEnvBoost: number;
    /** Clearcoat strength applied to plastic wheel materials. 0..1.
     *  When > 0, the material is silently upgraded to a
     *  `MeshPhysicalMaterial` and a thin lacquer-like clearcoat layer
     *  is added on top of the diffuse plastic. This is the secret
     *  sauce for the Highland D50 / Y E41 plastic hubcaps that
     *  otherwise read as dead matte black under the HDR environment:
     *  the underlying plastic stays dark but the clearcoat picks up
     *  the bright sky reflection so the hubcap reads as "polished
     *  black plastic" rather than "absent". Tesla bakes a similar
     *  clearcoat into their Godot scenes; we replicate it at runtime
     *  so the user can dial it from 0 (mat) to 1 (full lacquer).
     *  Default 0 (= old behaviour, no MeshPhysicalMaterial upgrade). */
    plasticClearcoat: number;
  };

  // ───────────────────────────────────────────────────────────────────
  // Variant axes — multi-dimensional mesh visibility configurator
  // ───────────────────────────────────────────────────────────────────
  /** Tesla packs all combinations of trim / drive layout (LHD / RHD) /
   *  market region (EU / US) / audio package into ONE GLB by shipping
   *  duplicate overlapping meshes for every variant. Without filtering
   *  you get two steering wheels, double bumpers, US plate + EU plate
   *  stacked, etc.
   *
   *  Each axis lists independent options; the user picks one option
   *  per axis in the Showroom and the runtime hides every "non-active"
   *  mesh across all axes. Storage is `{ axisId -> optionId }` so a
   *  saved car carries e.g. `{ trim: 'performance', driveLayout: 'rhd' }`.
   *
   *  Nodes that are NOT mentioned in any axis remain always visible
   *  (the shared body, doors, etc.).
   *
   *  Leave undefined on models with no multi-variant packing (very
   *  rare — most Tesla GLBs have at least the LHD/RHD pair). */
  variantAxes?: ReadonlyArray<VariantAxis>;
  /** Currently-active option per axis, merged from the Showroom
   *  override on top of each axis's `defaultOption`. Map shape:
   *  `{ trim: 'standard', driveLayout: 'lhd', market: 'eu' }`. */
  activeVariants?: Record<string, string>;

  // ───────────────────────────────────────────────────────────────────
  // Privacy-glass nodes — extra-tinted rear windows (Tesla factory)
  // ───────────────────────────────────────────────────────────────────
  /** Node names whose `(no mat)` outer-glass primitives must be tinted
   *  darker than the front windows. Tesla's Model Y rear doors ship
   *  with privacy glass (~15-25 % light transmission) but the GLB only
   *  exposes them as an untextured primitive paired with the
   *  `Glass_Interior` inner pane — the inner pane alone can't carry the
   *  full tint. List the parent group names of those windows here and
   *  the NOMAT handler will boost their opacity. Empty array = no
   *  special rear-window treatment (Highland-style equal tint). */
  privacyGlassNodes?: ReadonlyArray<RegExp>;

  // ───────────────────────────────────────────────────────────────────
  // Callout overlay tuning
  // ───────────────────────────────────────────────────────────────────
  /** Vertical lift (metres) of each floating callout above its anchor.
   *  Y is 5 cm taller than 3 so the offset needs to be slightly bigger
   *  to clear the roof. */
  calloutHeight: number;
  /** Per-callout XYZ nudge (metres, world axes) applied AFTER the
   *  `calloutHeight` lift. Used by the Showroom Callouts panel so each
   *  user can fine-tune where the floating button sits relative to its
   *  default anchor-above position (e.g. shift the "Lock" callout off
   *  the windshield and onto the driver door handle).
   *
   *  Convention: world axes — +X forward (toward the front of the car),
   *  +Y up, +Z right. Missing keys / `[0,0,0]` → default anchor-above
   *  position, unchanged. Keyed by the SEMANTIC callout id (not the
   *  underlying GLB node name) so per-model anchor renames don't
   *  invalidate user calibration. */
  calloutOffsets?: Partial<Record<CalloutKeyName, readonly [number, number, number]>>;
  /** Per-callout visibility flag — `true` means the callout is HIDDEN
   *  from the viewer. Set per car in the Showroom (Boutons flottants
   *  section). Defaults to undefined for every shipped model (all
   *  callouts visible by default). The Showroom itself still renders
   *  hidden callouts in a barré state so the user can re-enable them. */
  calloutsHidden?: Partial<Record<CalloutKeyName, true>>;
  /** Maps each semantic TPMS slot (front-left / front-right / rear-left
   *  / rear-right) to the `WheelWrapper_<id>` runtime node it should
   *  attach to.
   *
   *  WHY this exists: Tesla's GLB families use DIFFERENT internal
   *  coordinate systems. Poppyseed (M3 Highland) uses +X = forward, so
   *  `WheelWrapper_LF` (id "LF") really IS the front-left tyre — the
   *  naming matches reality. Bayberry (Model Y Juniper) uses +Z =
   *  forward, and the wheel IDs end up rotated 90°: `WheelWrapper_LF`
   *  on Y is the front-RIGHT tyre. Without this remap the TPMS pills
   *  would land on the wrong wheel.
   *
   *  Values are the `wheelFallbackPositions[].id` strings, looked up
   *  via `WheelWrapper_<id>` at render time. */
  tpmsAnchorMap: Record<'FL' | 'FR' | 'RL' | 'RR', 'LF' | 'RF' | 'LR' | 'RR'>;

  // ───────────────────────────────────────────────────────────────────
  // Opening animations — per-model (Tesla ships different keyframes per
  // car family, and even uses DIFFERENT node names: M3 calls a window
  // pivot `Window_LF_Spatial`, Y calls it `Window_FL`).
  // ───────────────────────────────────────────────────────────────────
  /** Every animatable opening for this model. Drives the
   *  <VehicleOpeningsAnimator> inside the Canvas + the visual sync
   *  hook (which writes to `set(openingId, 0|1)`).
   *
   *  Models that don't implement a given opening (e.g. Bayberry has no
   *  `mirror_LF` / `mirror_RF`) simply omit it from the array. The
   *  runtime degrades gracefully — set() calls for missing ids are
   *  recorded but never produce visible motion. */
  openings: ReadonlyArray<OpeningDefinition>;

  /** Optional auto-fold tracks for the side mirrors, triggered on lock.
   *  Only meaningful when the GLB exposes dedicated mirror pivot
   *  nodes (Poppyseed: `Door_LF_Mirror_Spatial`, etc.). Bayberry's
   *  mirrors are fused into the door mesh — no separate node, no
   *  auto-fold possible without mesh surgery → leave undefined.
   *
   *  When undefined, useVehicleVisualSync skips the `set('mirror_*', …)`
   *  calls entirely so the model doesn't accumulate dead targets. */
  mirrorTracks?: {
    mirror_LF: OpeningTrack;
    mirror_RF: OpeningTrack;
  };
}

// ───────────────────────────────────────────────────────────────────────────
// MODEL 3 HIGHLAND — Poppyseed
// ───────────────────────────────────────────────────────────────────────────
//
// Node names verified via `Tesla-Godot-Test/inspect-glb-nodes.mjs` against
// the optimised poppyseed.glb. Position values calibrated by eye against
// the real Model 3 Highland body lines and refined from user feedback.

export const PoppyseedConfig: VehicleModelConfig = {
  key: 'poppyseed',
  displayName: 'Model 3 Highland',
  modelUrl: '/models/poppyseed.glb',
  wheelUrl: '/models/wheel_d50_highland.glb',

  // Calibrated by user (2026-05) — 3/4 front-driver view with a wider
  // FOV than the original 38° (now 45°) so the whole front bumper
  // reads in frame; target nudged +0.6 m on Z to recentre the body
  // visually around the windshield.
  cameraPose: {
    position: [4.85, 1.25, -3.45],
    target: [0, 0.6, 0.6],
    fov: 45,
  },

  // Wheelbase 2875 mm → x ±1.4375 with a +50 mm forward bias for the GLB.
  // Track 1580 mm (centre-to-centre) → ±0.79 m + tyre outer edge ≈ ±0.815.
  // 18" wheel radius 343 mm → wheel centre y = 0.343 m.
  wheelFallbackPositions: [
    { id: 'LF', x: +1.4875, y: 0.343, z: -0.815, flipZ: true },
    { id: 'RF', x: +1.4875, y: 0.343, z: +0.815, flipZ: false },
    { id: 'LR', x: -1.3875, y: 0.343, z: -0.815, flipZ: true },
    { id: 'RR', x: -1.3875, y: 0.343, z: +0.815, flipZ: false },
  ],
  wheelAnchorNames: [
    { name: 'Wheel_LF_Spatial', mirror: false },
    { name: 'Wheel_LR_Spatial', mirror: false },
    { name: 'Wheel_RF_Spatial', mirror: true },
    { name: 'Wheel_RR_Spatial', mirror: true },
  ],

  // Charge port: rear-left fender, ~92 cm high. Both `fallbackWorld`
  // and `pivotToSocketOffset` were re-measured live via the Showroom
  // anchor overlay (2026-05) — the red FALLBACK sphere snapped onto
  // the cyan PLUG SOCKET cube, then the user dialled the X offset
  // (-0.09) so the plug seats inside the port recess instead of
  // floating outboard of the bodywork.
  chargePort: {
    nodeName: 'Charge_Cap_Spatial',
    alternateNames: ['Chargeport_Spatial', 'Charge_Port_Spatial', 'ChargePort'],
    fallbackWorld: [-1.94, 0.92, -0.74],
    pivotToSocketOffset: [-0.09, -0.06, 0],
    plugDirection: [0, 0, 1],
  },
  // User-calibrated cable ground anchor (2026-05): ~3 m behind and
  // 1.5 m to the left of the car centre — slightly closer to the car
  // than the original -3.5 m so the cable doesn't disappear off-frame
  // at the wider FOV the user set above.
  cableGroundAnchor: [-2.95, 0, -1.5],

  supercharger: {
    modelUrl: '/models/supercharger_base.glb',
    position: [-4.2, 0, -1.6],
    rotationY: -90,
    cablePortOffset: [0.08, 1.05, -0.15],
  },

  chargingCameraPose: {
    position: [-4.8, 2.4, -4.2],
    target: [-1.5, 0.6, -0.6],
    fov: 38,
  },

  actionAnchors: {
    frunk: 'Hood_Spatial',
    trunk: 'Trunk_Spatial',
    chargePort: 'Charge_Cap_Spatial',
    window: 'Window_LF_Spatial',
    // M3 has mirror anchor nodes — sentry sits near the driver-side
    // B-pillar camera (closest hardware), climate on the passenger
    // mirror so the two new callouts don't overlap the lock callout
    // on the driver door.
    lock: 'Door_LF_Spatial',
    sentry: 'Door_LF_Mirror_Spatial',
    climate: 'Door_RF_Mirror_Spatial',
  },

  // User-calibrated Sentry camera positions (2026-05) — same 7-camera
  // layout but refined live against the Highland body. Front bumper
  // moved out to +2.33 to sit above the actual sensor housing; rear
  // pulled in to -2.27; B-pillars dropped slightly forward to land on
  // the actual camera lenses rather than mid-window.
  sentryCameraPositions: [
    [+0.40, 1.32, 0],      // 1. front rearview (top of windshield)
    [+2.33, 0.25, 0],      // 2. front bumper centre (above black grille)
    [+1.10, 0.72, -0.93],  // 3. left front fender (turn-signal lens)
    [+1.10, 0.72, +0.93],  // 4. right front fender
    [-0.31, 1.24, -0.74],  // 5. left B-pillar (rear-looking)
    [-0.31, 1.24, +0.74],  // 6. right B-pillar
    [-2.27, 0.81, 0],      // 7. rear (above license plate)
  ],

  brakeLightNodes: ['Brake_Lights_Left', 'Brake_Lights_Right', 'Brake_Lights_Center'],
  reverseLightNodes: ['Reverse_Light', 'Reverse_Light_Perf'],
  headlightNodes: ['Headlights', 'DRL'],
  groundProjectionNodes: {
    headlights: 'Headlights_Projections',
    stoplights: 'Stoplights_Projections',
  },

  hiddenNodes: [
    // Tesla CSG overlays — flat planes on the windshields/dashboard
    // used to visualise the defrost and the cabin airflow.
    'Defrost_Front',
    'Defrost_Rear',
    'Airflow_left',
    'Airflow_right',
    // Plate viewport: a Godot Viewport that bakes a text label onto a
    // quad. Without the live Godot runtime it renders as a black square.
    'Plate_Viewport',
    // NOTE: RHD / US / NV35 nodes are managed by `variantAxes` below
    // so the user can switch them per-car via the Showroom.
  ],
  floorNodes: ['Floor', 'Ground_Plane'],

  // Tesla M3 Highland materials. `Paint_*` for body.
  //
  // GLASS — Material+zone audit (poppyseed.glb, 2026-05):
  //   Outer materials   : Glass, Glass_Tinted, Glass_Tinted_Fade
  //                       (NEVER Glass_Lights — that's the headlight
  //                       cover material; tinting it = red bricks)
  //   Inner materials   : Glass_Interior, Glass_Interior_Tinted_Fade
  //   Door windows      : Window_L[FR] / Window_R[FR] (4 nodes) → zone DOOR
  //   Pano + windshield : Windows_Top (single mesh, 6 prims of
  //                       Glass_Tinted* + Glass_Interior_Tinted_Fade)
  //                       → ZONE PANO (the M3 fuses windshield, roof,
  //                       lunette, custodes AND pillars into one mesh;
  //                       there is no way to slider them separately
  //                       without primitive-level surgery, which is
  //                       fragile across GLB re-exports — accept the
  //                       compromise: one slider for the whole upper
  //                       greenhouse).
  //   Trunk glass       : N/A (bundled into Windows_Top)
  materialPatterns: {
    bodyPaint: /^paint(_|skybox|$)/i,
    outerGlassMaterial: /^glass(_tinted)?(_fade)?$/i,
    innerGlassMaterial: /^glass_interior/i,
  },
  glassZoning: {
    doorWindowNode: /^window_(l|r)[fr]$/i,
    panoroofNode: /^windows_top$/i,
  },
  bodyPaintColor: 0xf2f2f0,
  calloutHeight: 0.45,
  // M3 (+X = forward) — wheel IDs match physical positions 1:1.
  tpmsAnchorMap: {
    FL: 'LF',
    FR: 'RF',
    RL: 'LR',
    RR: 'RR',
  },
  // User-calibrated wheel finish (2026-05) tuned for the Highland D50
  // plastic hubcaps. alloyRoughnessMin=0 keeps the alloy spokes as
  // mirror-polish; plasticClearcoat will be tuned live by the user
  // once they confirm the D50 hubcap material classification (see the
  // console log `wheel polish: alloy=N plastic=M | materials seen: …`).
  wheelFinish: {
    alloyRoughnessMin: 0,
    alloyEnvBoost: 0.4,
    alloyClearcoat: 0,
    plasticRoughness: 0.45,
    plasticEnvBoost: 0.5,
    plasticClearcoat: 0,
  },
  // User-calibrated glass finish (2026-05) for the Highland greenhouse.
  // Much higher outerEnvMultiplier (1.5 vs old 0.3) lets the HDR sky
  // dominate the door windows + windshield reflection. Door windows
  // pushed to 90% opacity for proper privacy glass feel. Pano opacity
  // dropped to 80% so the cabin reads through the roof.
  glassFinish: {
    outerEnvMultiplier: 1.5,
    doorWindowOpacity: 0.9,
    doorWindowTint: 0.0,
    panoroofOpacity: 0.8,
    panoroofTint: 0.0,
    // M3 has no separate trunk glass — these are kept for the type
    // (Showroom hides the slider when the model has no trunkGlassNode).
    trunkGlassOpacity: 0.85,
    trunkGlassTint: 0.30,
    innerMixedOpacity: 0.5,
    innerMixedEnvMultiplier: 0,
    innerSoloOpacity: 0,
    innerSoloEnvMultiplier: 0,
  },
  // User-calibrated light tuning (2026-05). Brake doubled (5 vs old
  // 2.5) for visibility under the wider FOV. Headlight reduced (0.7
  // vs 1.4) and shifted to pure white (0xFFFFFF vs warm 0xfff5e8) for
  // a more clinical LED feel. Reverse left at the default warm value.
  lightTuning: {
    brakeIntensity: 5,
    brakeColor: 0xff1a1a,
    reverseIntensity: 1.8,
    reverseColor: 0xfff8e8,
    headlightIntensity: 0.7,
    headlightColor: 0xffffff,
  },
  // M3 Highland ships several interior materials as mid-grey
  // placeholders (Decor 0.51, InteriorSeats 0.37) that read as
  // washed-out white under the HDR environment. Repaint to Tesla
  // "Black Interior" charcoal so the cabin looks like the real car.
  // User can re-customise from the Showroom (e.g. cream seats).
  //
  // `Zero_Black` is a Tesla placeholder material that the LHD
  // Dashboard mesh applies to the air-vent louver geometry. In
  // game Tesla swaps it for a baked vent texture at runtime; in our
  // GLB it survives as a pure flat-black material and reads as ugly
  // BLACK STAINS on the dashboard vent. We override it to a soft
  // dark-grey so the louvers blend with the surrounding plastic
  // without losing the vent silhouette. The RHD Dashboard mesh
  // doesn't have this issue (different baked layout), but we can't
  // swap because that would put a RHD dashboard with a LHD steering
  // wheel — the user explicitly asked for a recolor, not a swap.
  interiorOverrides: [
    { key: 'InteriorSeats', matchName: /^InteriorSeats$/i, color: 0x1a1a1a, roughness: 0.75 },
    { key: 'InteriorSeats2', matchName: /^InteriorSeats2$/i, color: 0x1a1a1a, roughness: 0.75 },
    { key: 'Decor', matchName: /^Decor$/i, color: 0x1a1a1a, roughness: 0.7 },
    { key: 'Zero_Black', matchName: /^Zero_Black$/i, color: 0x2a2a2a, roughness: 0.85 },
  ],
  // Tesla packs every trim / drive layout / market region / audio
  // package into ONE GLB by shipping duplicate overlapping meshes for
  // every variant. Without filtering you'd see two steering wheels
  // poking through the dashboard, doubled bumpers z-fighting, EU + US
  // plates stacked, etc. Each axis below is independent and is
  // controlled per-car from the Showroom.
  variantAxes: [
    {
      id: 'trim',
      label: 'Trim',
      // Default = Long Range (the "middle" trim that ships with the
      // standard non-D50 bumpers, console and Reverse_Light). Users
      // pick Propulsion (D50 — Highland 2026) or Performance per car.
      defaultOption: 'longRange',
      options: [
        // NOTE on the seat geometry — Tesla packs each front seat as
        //   two physical meshes + colour overlays:
        //     - Seat_Bottom_LF / Seat_Bottom_RF  (mesh#11, SHARED) —
        //       structural shell (plastic + alu + black base fabric)
        //     - Seat_Top_LF   / Seat_Top_RF     (mesh#13/#16) —
        //       back-rest shell (Long Range / D50 silhouette)
        //     - Seat_Top_*_Color, Seat_Bottom_*_Color → LR fabric overlay
        //     - Seat_Top_Perf_*[_Color]                → Perf bucket + fabric
        //     - Seat_Bottom_D50_*                      → D50 all-in-one cushion
        //
        //   CRITICAL: Tesla ships the Poppyseed GLB with the seat
        //   shells `Seat_Bottom_LF/RF` set to `visible = false` by
        //   default — they expect a runtime (the Tesla configurator)
        //   to toggle them on per trim. We must therefore re-assert
        //   them visible in EVERY trim that uses them (LR, D50, Perf
        //   all do); leaving them out of `ownedNodes` leaves the
        //   shells hidden and the seats look like floating back-rests.
        {
          id: 'longRange',
          label: 'Long Range (RWD / AWD)',
          ownedNodes: [
            // Exterior
            'Bumper_F_Base',
            'Bumper_R_Base',
            'Bumper_R_Base_Reflector',
            'Reverse_Light',
            // Interior — classic Center Console (no D50 alu accents)
            'Center_Console',
            // Seat shells (must be re-asserted visible — Tesla
            // exports them hidden by default for the configurator)
            'Seat_Bottom_LF',
            'Seat_Bottom_RF',
            'Seat_Top_LF',
            'Seat_Top_RF',
            // Seat colour overlays (LR fabric)
            'Seat_Top_LF_Color',
            'Seat_Top_RF_Color',
            'Seat_Bottom_LF_Color',
            'Seat_Bottom_RF_Color',
          ],
        },
        {
          id: 'propulsion',
          label: 'Propulsion (D50 / Highland 2026)',
          ownedNodes: [
            // Exterior — D50 reuses the Base bumpers & reverse lamp
            // (no Performance reflector / no Perf splitter)
            'Bumper_F_Base',
            'Bumper_R_Base',
            'Bumper_R_Base_Reflector',
            'Reverse_Light',
            // Front fascia camera — exclusive to D50 (front parking
            // sensors brought back on Highland 2026 Propulsion).
            'Fascia_Cam_D50',
            // Interior — D50-specific aluminium-dark Center Console
            'Center_Console_D50',
            // Seats — REUSE the Long Range silhouette + fabric.
            // The D50-specific `Seat_Bottom_D50_*` cushion primitives
            // never light up in the renderer (likely a Tesla shape-key
            // morph rather than a visibility flip), so we fall back to
            // the same shell + cushion overlay set as `longRange`.
            'Seat_Bottom_LF',
            'Seat_Bottom_RF',
            'Seat_Top_LF',
            'Seat_Top_RF',
            'Seat_Top_LF_Color',
            'Seat_Top_RF_Color',
            'Seat_Bottom_LF_Color',
            'Seat_Bottom_RF_Color',
          ],
        },
        {
          id: 'performance',
          label: 'Performance',
          ownedNodes: [
            // Exterior — Perf bumpers + reflector + reverse lamp variant
            'Bumper_F_Perf',
            'Bumper_R_Perf',
            'Bumper_R_Perf_Reflector',
            'Reverse_Light_Perf',
            // Interior — Perf reuses the Long Range Center Console
            // (no D50 alu accents on Performance either).
            'Center_Console',
            // Seat shells (re-asserted visible — see CRITICAL note above)
            'Seat_Bottom_LF',
            'Seat_Bottom_RF',
            // Sport back-rest shell (with wings — replaces Seat_Top_*)
            'Seat_Top_Perf_LF',
            'Seat_Top_Perf_RF',
            // Perf-specific fabric overlays (top + bottom)
            'Seat_Top_Perf_LF_Color',
            'Seat_Top_Perf_RF_Color',
            'Seat_Bottom_Perf_LF_Color',
            'Seat_Bottom_Perf_RF_Color',
          ],
        },
      ],
    },
    {
      id: 'driveLayout',
      label: 'Conduite',
      defaultOption: 'lhd',
      options: [
        {
          id: 'lhd',
          label: 'Gauche (LHD)',
          ownedNodes: [
            'Interior_Body',
            'Dashboard',
            'Screen_Front',
            'Doorcard_LF',
            'Doorcard_RF',
            'Steering_Wheel_Spatial',
            'Stalk',
          ],
        },
        {
          id: 'rhd',
          label: 'Droite (RHD)',
          ownedNodes: [
            'Interior_Body_RHD',
            'Dashboard_RHD',
            'Screen_Front_RHD',
            'Doorcard_LF_RHD',
            'Doorcard_RF_RHD',
            'Steering_Wheel_RHD_Spatial',
            'Stalk_RHD',
          ],
        },
      ],
    },
    {
      id: 'market',
      label: 'Marché',
      defaultOption: 'eu',
      options: [
        { id: 'eu', label: 'Europe', ownedNodes: ['Plate_EU'] },
        { id: 'us', label: 'États-Unis', ownedNodes: ['Plate_US'] },
      ],
    },
    {
      id: 'audio',
      label: 'Audio',
      defaultOption: 'standard',
      options: [
        { id: 'standard', label: 'Standard', ownedNodes: [] },
        {
          id: 'nv35',
          label: 'Premium NV35',
          ownedNodes: [
            'Doorcard_LF_Tweeter_NV35',
            'Doorcard_RF_Tweeter_NV35',
            'Model3_Text_NV35',
          ],
        },
      ],
    },
  ],
  openings: OPENINGS_POPPYSEED,
  mirrorTracks: MIRROR_TRACKS_POPPYSEED,
};

// ───────────────────────────────────────────────────────────────────────────
// MODEL Y JUNIPER — Bayberry  (PLACEHOLDER — GLB not extracted yet)
// ───────────────────────────────────────────────────────────────────────────
//
// Skeleton in place so the routing already knows about Bayberry. Most
// values cascade from Poppyseed (Tesla reuses node names extensively
// across car families) — the deltas are dimensional. When the bayberry.glb
// is extracted, every TODO(model-y) marker below needs to be revisited.
//
// Known Y vs 3 deltas:
//   - Y body is ~5 cm taller (CAMERA y target slightly higher)
//   - Y wheelbase identical (2875 mm) but track wider (~+30 mm)
//   - Y charge port also rear-left fender, similar height (~+5 cm)
//   - Y has 7 cameras same as 3 but slightly different positions
//
// "Bayberry" is Tesla's codename for the Model Y Juniper (2025+ refresh).
// Three body variants ship in the APK, all Juniper-platform:
//   - Bayberry.glb         → MY Juniper PERFORMANCE (top trim, suspect)
//   - BayberryE41.glb      → MY Juniper PROPULSION (entry, single-motor RWD)
//   - BayberryE80.glb      → MY Juniper PREMIUM / LONG RANGE (mid, dual-motor)
// (The pre-Juniper 2020-2024 Y body is `ModelY_High.glb`, NOT Bayberry.)
//
// Wheel defaults per trim (best guess — Tesla configurator-ish):
//   - Wheel_E41.glb        → Propulsion factory wheels (Gemini-style hubcap)
//   - GeminiDark.glb       → 19" Gemini Dark (popular factory option)
//   - Helix2 / Helix2_Dark → 20" Helix2 (Premium upgrade)
//   - Machina2.glb         → 21" Machina2 (Performance stock)
//   - Arachnid_V2_21.glb   → 21" Arachnid (Performance optional)
//
// User's wife owns a Juniper PROPULSION (E41 body + E41 wheels), so we
// default to that. To target Premium/Long Range, swap to BayberryE80 +
// GeminiDark or Helix2; to target Performance, swap to Bayberry + Machina2.

// ALL values below verified against the real bayberry_e41.glb via
// `node Tesla-Godot-Test/inspect-glb-nodes.mjs Exports/public/bayberry_e41.glb`.
// Tesla renamed a LOT of nodes/materials between Highland and Juniper:
//   - Charge port pivot   : Charge_Cap_Spatial → Charge_Port_Spatial
//   - Window pivot        : Window_LF_Spatial → Window_FL (no _Spatial)
//   - Brake lights        : Brake_Lights_Left/Right/Center → Brake_Light
//   - Headlights          : Headlights → DRL_Left/Right + HighBeam_Left/Right
//   - Reverse             : Reverse_Light → Reverse + Reverse_US
//   - Ground projections  : *_Projections (plural) → *Projection (singular)
//   - Floor               : Floor → GroundPlane (one word)
//   - Glass material      : *_Skybox → Glass_Windows
//   - Body paint          : Paint_* → Paint + PaintRough (matte trim)
// Plus the Showroom-only `Fade` mesh that ghosts the whole car white
// (this was the "verre blanc" mystery). Must be hidden.

// ──────────────────────────────────────────────────────────────────────
// IMPORTANT — Bayberry GLB axis convention (CONTRARY to file header).
// The Tesla bayberry_e41.glb body is oriented with:
//     +Z = longitudinal (forward), -Z = backward
//     +X = lateral right, -X = lateral left
//     +Y = up
// — i.e. swapped vs the convention the file header documents (which
// matches Poppyseed / M3 Highland). Confirmed live (2026-05) by the
// Showroom anchor debug overlay: body bbox reads X=1.92m × Y=1.46m ×
// Z=4.79m, matching the real Y Juniper spec (W=1.94, H=1.62, L=4.79).
// All geometry values below are expressed in THIS frame and were
// calibrated by the user against the live render. Don't "fix" them
// to match the file header — they would render orthogonally to the
// body if you do.
// ──────────────────────────────────────────────────────────────────────

export const BayberryConfig: VehicleModelConfig = {
  key: 'bayberry',
  displayName: 'Model Y Juniper Propulsion',
  modelUrl: '/models/bayberry_e41.glb',
  wheelUrl: '/models/wheel_e41.glb',

  // Calibrated by the user (2026-05) — 3/4 rear-driver-side view with
  // a wider FOV than M3 (50° vs 38°) to accommodate the Y's larger
  // greenhouse without losing the wheels at the frame edge.
  cameraPose: {
    position: [-4.156, 1.35, -4.416],
    target: [-0.45, 0.7, 0],
    fov: 50,
  },

  // User-calibrated wheel placements (2026-05). Numbers reflect the
  // Bayberry GLB axis convention noted at the top of this section
  // (+Z = forward), so:
  //   wheelbase along Z : (+1.40) − (−1.51) = 2.91 m  (real Y: 2.89 m)
  //   track along X     : (+0.85) − (−0.85) = 1.70 m  (real Y: 1.65 m)
  // rotY=±90° rotates the E41 hubcap to face the body's longitudinal
  // axis (the wheel GLB exports its native hubcap facing +Z, which
  // would otherwise read as "wheels rolling sideways" once placed).
  wheelFallbackPositions: [
    { id: 'LF', x: +0.85, y: 0.353, z: -1.51, flipZ: true, rotY: -90 },
    { id: 'RF', x: +0.85, y: 0.353, z: +1.40, flipZ: false, rotY: 90 },
    { id: 'LR', x: -0.85, y: 0.353, z: -1.51, flipZ: true, rotY: 90 },
    { id: 'RR', x: -0.85, y: 0.353, z: +1.40, flipZ: false, rotY: -90 },
  ],
  // Bayberry GLB does NOT ship Wheel_*_Spatial anchors — confirmed via
  // inspect. Always falls back to wheelFallbackPositions above.
  wheelAnchorNames: [],

  chargePort: {
    // Bayberry's pivot is named WITHOUT the abbreviated "Cap".
    nodeName: 'Charge_Port_Spatial',
    alternateNames: ['Charge_Cap_Spatial', 'Chargeport_Spatial', 'ChargePort'],
    // Live-measured from the Showroom anchor overlay (2026-05) on the
    // user's Y Juniper Propulsion: the trapdoor pivot sits 78 cm
    // below the roof on the rear-driver fender, ~2 m forward of the
    // body centre (remember +Z = forward for this GLB).
    fallbackWorld: [-0.785, 1.02, 1.98],
    pivotToSocketOffset: [0.005, -0.055, 0.045],
    plugDirection: [1, -0.2, 0.11],
  },
  // User-calibrated cable ground anchor — drapes the cable across the
  // passenger side of the rear bumper so it stays clear of the orbit
  // camera's main viewing arcs.
  cableGroundAnchor: [-2.6, 0, 2.85],

  supercharger: {
    modelUrl: '/models/supercharger_base.glb',
    position: [-3.8, 0, 3.0],
    rotationY: -90,
    cablePortOffset: [0.08, 1.05, -0.15],
  },

  chargingCameraPose: {
    position: [-4.4, 2.5, 4.6],
    target: [-1.4, 0.6, 1.4],
    fov: 38,
  },

  actionAnchors: {
    frunk: 'Hood_Spatial',         // identical to M3
    trunk: 'Trunk_Spatial',        // identical to M3
    chargePort: 'Charge_Port_Spatial',  // RENAMED on Y
    window: 'Window_FL',           // RENAMED on Y (FL vs LF, no _Spatial)
    // Y has no separate mirror anchor (the mirrors are fused into the
    // door meshes — see bayberryOpenings comment header). We fall back
    // to door anchors for sentry/climate. Same lock anchor as M3.
    lock: 'Door_LF_Spatial',
    sentry: 'Door_LR_Spatial',
    climate: 'Door_RF_Spatial',
  },

  // User-calibrated Sentry pulse-dot positions (2026-05) — 7 hardware
  // cameras matching the Y Juniper Hardware 4 layout:
  //   1: windshield rearview               5: left rear pillar
  //   2: front bumper centre               6: right rear pillar
  //   3: left front fender repeater        7: rear tailgate plate
  //   4: right front fender repeater
  sentryCameraPositions: [
    [0,     1.44, -0.52],
    [0,     0.35, -2.35],
    [+0.96, 0.81, -1.12],
    [-0.96, 0.81, -1.12],
    [-0.71, 1.40, +0.33],
    [+0.71, 1.40, +0.33],
    [0,     0.98, +2.30],
  ],

  // bayberry_e41.glb audit (2026-05) — the "On" meshes are SEPARATE
  // from the "Off" meshes. Tesla swaps visibility via the Godot
  // animation player. We boost emissive on the "On" meshes only;
  // the matching "Off" meshes are demoted to `permanentlyHiddenNodes`
  // below so they never paint a black blob behind the lit version.
  //
  //   Rear brake cluster :
  //     Brake_Light                  → main brake cluster (single mesh)
  //     Brake_Lights_CHMSL_On        → centre high-mount stop lamp
  //     Back_Left_Turn_Signal_On     → rear turn signals (red glow)
  //     Back_Right_Turn_Signal_On
  //   Reverse :
  //     Reverse                      → EU reverse lamp
  //   Front headlights : NONE that we can safely boost.
  //     DRL_Left / DRL_Right / HighBeam_Left / HighBeam_Right are
  //     misplaced on the bumper in this export and are
  //     PERMANENTLY HIDDEN — the slider stays in the UI but the
  //     headlightNodes list is empty, so the boost is a no-op.
  brakeLightNodes: [
    'Brake_Light',
    'Brake_Lights_CHMSL_On',
    'Back_Left_Turn_Signal_On',
    'Back_Right_Turn_Signal_On',
  ],
  reverseLightNodes: ['Reverse'],
  headlightNodes: [],
  groundProjectionNodes: {
    headlights: 'HeadLightProjection',
    stoplights: 'BrakeLightProjection',
  },

  hiddenNodes: [
    // NOTE: `Fade` was originally suspected as a Showroom ghost-overlay
    // and added here — that was WRONG. `Fade` is the panoramic glass
    // ROOF (Tesla's odd choice of name in Bayberry.tscn). It's tinted
    // via glassZoning.panoroofNode below; keep it visible.
    // NOTE: RHD / US nodes are managed by `variantAxes` below so the
    // user can switch them per-car via the Showroom.
  ],
  // Nodes re-asserted as hidden on every cleaned-scene pass so they
  // can NEVER be revived by accident (light boosts, scene re-clones,
  // showroom toggles). See VehicleTopView3D's permanently-hidden pass.
  permanentlyHiddenNodes: [
    // Headlight cluster fragments that Tesla left misplaced on the
    // E41 export — they sit on the bumper and look like floating
    // pieces of glass / metal. The user asked to hide them flat.
    'HighBeam_Left',
    'HighBeam_Right',
    'DRL_Left',
    'DRL_Right',
    // Rear brake / CHMSL "off" variants that pair with the "On"
    // meshes (Tesla animates visibility — without the Godot anim
    // player both are visible at once and the cluster looks doubled).
    'Brake_Lights_CHMSL_Off',
    'Light_Off',
  ],
  // Y exports the studio shadow as a single word `GroundPlane`.
  floorNodes: ['GroundPlane'],

  // bayberry_e41.glb audit (2026-05):
  //
  //   Outer glass materials:
  //     Glass              → trunk hatch outer (Trunk_Cover_Main) + windshield (Static_Exterior)
  //     Glass_Windows      → 4 door windows
  //     Glass_Windows_Fade → panoramic roof + lunette merged on Fade mesh
  //   Inner glass materials:
  //     Glass_Interior      → windshield inner + door inner + trunk inner
  //     Glass_Interior_Fade → pano roof inner (heavily dampened)
  //
  //   Glass MESH zones:
  //     Window_FL / FR / RL / RR  → 4 door windows (DOOR zone)
  //     Fade                      → pano + windshield + lunette (PANO zone)
  //     Trunk_Cover_Main          → trunk hatch outer glass (TRUNK zone)
  //     Static_Exterior           → contains windshield outer prim (PANO zone fallback)
  //
  //   IMPORTANT: there is NO `Glass_Lights` material on Y. The light
  //   covers are part of the `Light`/`Cover` opaque materials so
  //   they are naturally outside the glass routing.
  materialPatterns: {
    bodyPaint: /^paint(_|rough|$)/i,
    outerGlassMaterial: /^glass(_windows)?(_fade)?$/i,
    innerGlassMaterial: /^glass_interior/i,
    // Pano roof inner pane (Glass_Interior_Fade, alpha 0.13) needs the
    // dimmed treatment — otherwise the pano reads as opaque grey.
    dimmedInnerGlassMaterial: /^glass_interior_fade$/i,
  },
  glassZoning: {
    doorWindowNode: /^window_(fl|fr|rl|rr)$/i,
    panoroofNode: /^fade$/i,
    trunkGlassNode: /^trunk_cover(_main)?$/i,
    // Static_Exterior bundles the windshield outer primitive — route
    // it to PANO so the windshield tint slider can reach it.
    sharedBodyNode: /^static_(door_)?exterior$/i,
  },
  // "Midnight Cherry" deep aubergine — the user's personal Y Juniper
  // Propulsion finish (Tesla don't ship a stock Pearl White Multi-Coat
  // in this exact shade; this is a Showroom paint pick). Owners who
  // prefer a different colour override via the Showroom paint picker.
  bodyPaintColor: 0x450d59,
  calloutHeight: 0.50,        // +5 cm vs M3 — Y is taller, callouts need
                              // more lift to clear the higher roofline
  // Y (+Z = forward) — wheel IDs are rotated 90° vs M3.
  // Calibrated from user testing (2026-05): the slider you move and the
  // pill that moves visibly were 90° off until this map landed.
  //   - WheelWrapper_LF is actually on the front-right corner
  //   - WheelWrapper_LR is actually on the front-left corner
  //   - WheelWrapper_RR is actually on the rear-left  corner
  //   - WheelWrapper_RF is actually on the rear-right corner
  tpmsAnchorMap: {
    FL: 'LR',
    FR: 'LF',
    RL: 'RR',
    RR: 'RF',
  },

  // Tesla shipped the Bayberry GLB with several interior materials left
  // as untextured placeholder colours that bleed through the windows:
  //   - `Decor`     rgba(0.20, 0.00, 0.80) = bright purple → magenta
  //                 panels visible inside every door
  //   - `cupholder` rgba(0.00, 0.04, 0.80) = bright blue → blue cup-
  //                 holder pad in the centre console
  //   - `Wing`      rgba(0.93, 0.96, 1.00) = near-white → blank backrest
  //                 placeholder (also confused with the white interior)
  //   - `Interior2` rgba(0.80, 0.80, 0.80) = light grey → ALL seats,
  //                 dashboard and door panels read as bright white.
  // Tesla intentionally ships them flat — there ARE no proper textures
  // in the GLB to substitute (verified by extracting via gltf-transform).
  // Best we can do is repaint them to Tesla "Black Interior" charcoal so
  // the cabin reads as a normal dark Tesla interior. Slight roughness
  // bump on Decor/cupholder removes the plasticky highlight too.
  interiorOverrides: [
    { key: 'Interior2', matchName: /^Interior2$/i, color: 0x1a1a1a, roughness: 0.7 },
    { key: 'Decor', matchName: /^Decor$/i, color: 0x1a1a1a, roughness: 0.7 },
    { key: 'cupholder', matchName: /^cupholder$/i, color: 0x1a1a1a, roughness: 0.7 },
    { key: 'Wing', matchName: /^Wing$/i, color: 0x1a1a1a, roughness: 0.7 },
  ],
  // User-calibrated wheel finish (2026-05) on the E41 alloy + plastic
  // brake-rotor cap. Higher alloyRoughnessMin (0.67) keeps the alloy
  // from reading as a chrome mirror under the HDR environment; the
  // env boost (2.1) restores enough HDR contrast to read as polished
  // brushed alloy. Plastic dialled slightly less glossy than M3
  // default to match the matte black of the brake-rotor cover.
  wheelFinish: {
    alloyRoughnessMin: 0.67,
    alloyEnvBoost: 2.1,
    alloyClearcoat: 0,
    plasticRoughness: 0.53,
    plasticEnvBoost: 1.15,
    plasticClearcoat: 0,
  },
  // User-calibrated glass finish (2026-05) — pushes a much more
  // transparent panoroof (16% opacity) and almost-clear inner mixed
  // pane (0% so the windshield reads fully transparent). Outer env
  // boost (1.18 vs old 0.3) lets the HDR sky reflection dominate the
  // glass so the car looks polished even when parked indoors.
  glassFinish: {
    outerEnvMultiplier: 1.18,
    doorWindowOpacity: 0.55,
    doorWindowTint: 0.0,
    panoroofOpacity: 0.16,
    panoroofTint: 0.15,
    trunkGlassOpacity: 0.78,
    trunkGlassTint: 0.0,
    innerMixedOpacity: 0.0,
    innerMixedEnvMultiplier: 0.0,
    innerSoloOpacity: 0.6,
    innerSoloEnvMultiplier: 0.0,
  },
  // User-calibrated rear-cluster boost (2026-05). Brake at 5.0 (vs
  // old 4.0) reads correctly against the user's dark body paint.
  // Reverse + headlights disabled (0) — both ship as misplaced
  // geometry on the Y E41 and the user prefers them off rather than
  // visible-but-broken. Slider sits in the UI for owners who want to
  // re-enable.
  lightTuning: {
    brakeIntensity: 5.0,
    brakeColor: 0xff0000,
    reverseIntensity: 0.0,
    reverseColor: 0xfff8e8,
    headlightIntensity: 0.0,
    headlightColor: 0xfff5e8,
  },
  // Tesla MY Juniper ships privacy glass on the rear doors (much darker
  // than the front side windows). In the GLB the rear-window geometry
  // is paired as `(no mat)` outer + `Glass_Interior` inner — without an
  // explicit privacy-glass material to tint, the NOMAT handler has no
  // way to know it should be darker than the front-door windows. Listing
  // the parent group names here tells it to boost opacity.
  privacyGlassNodes: [/^Window_R[LR]$/i, /^Back_(Left|Right)_[Ww]indow$/i],

  // Bayberry ships its trim variants as SEPARATE GLBs (E41 / E80) so
  // there's no `trim` axis here — picking a different trim swaps the
  // file. What stays packed in every Bayberry GLB are the LHD/RHD and
  // EU/US duplicates.
  variantAxes: [
    {
      id: 'driveLayout',
      label: 'Conduite',
      defaultOption: 'lhd',
      options: [
        {
          id: 'lhd',
          label: 'Gauche (LHD)',
          ownedNodes: ['LHD', 'Doorcard_LF_LHD', 'Doorcard_RF_LHD'],
        },
        {
          id: 'rhd',
          label: 'Droite (RHD)',
          ownedNodes: ['RHD', 'Doorcard_LF_RHD', 'Doorcard_RF_RHD'],
        },
      ],
    },
    {
      id: 'market',
      label: 'Marché',
      defaultOption: 'eu',
      options: [
        {
          id: 'eu',
          label: 'Europe',
          ownedNodes: [
            'Plate_EU',
            'Left_Turn_Signal_EU',
            'Right_Turn_Signal_EU',
            'Reverse',
          ],
        },
        {
          id: 'us',
          label: 'États-Unis',
          ownedNodes: [
            'Plate_US',
            'Left_Turn_Signal_US',
            'Right_Turn_Signal_US',
            'Reverse_US',
          ],
        },
      ],
    },
  ],

  openings: OPENINGS_BAYBERRY,
  // No mirrorTracks for Bayberry — Tesla fused the rear-view mirror
  // meshes into Front_Left_Door / Front_Right_Door (no separate pivot
  // node in the GLB), so auto-fold on lock is impossible without
  // remeshing. The visual sync hook detects the undefined field and
  // skips the mirror_LF / mirror_RF targets entirely.
};

export const VEHICLE_MODELS: Record<VehicleModelKey, VehicleModelConfig> = {
  poppyseed: PoppyseedConfig,
  bayberry: BayberryConfig,
};

/**
 * Pick the right model config from a VIN. Tesla VIN positions 4 (vehicle
 * line) and 5 (body) encode the model family. For our purposes the
 * 4th character is enough:
 *
 *   '3' (e.g. 5YJ3...) → Model 3
 *   'Y' (e.g. 7SAYG...) → Model Y
 *   'S' / 'X' / 'C'    → Model S / X / Cybertruck (not yet supported)
 *
 * Add cases as new model GLBs are extracted.
 */
export function pickModelForVin(vin: string | null | undefined): VehicleModelConfig {
  if (!vin) return PoppyseedConfig;
  const code = vin.toUpperCase().charAt(3);
  if (code === 'Y') return BayberryConfig;
  return PoppyseedConfig;
}

// ───────────────────────────────────────────────────────────────────────────
// Runtime resolution — VehicleModelContext + useActiveModel hook
// ───────────────────────────────────────────────────────────────────────────
//
// The 3D viewer needs to pick the right config based on which car the user
// has selected. <VehicleTopView3D> derives the config from `vehicle.vin`
// at render time and pipes it through this Context to every descendant
// (PoppyseedModel, VehicleLightEffects, VehicleCallouts, LiveChargingCable
// — all of them inside R3F's <Canvas>, which auto-bridges React contexts).
//
// We keep `ACTIVE_VEHICLE_MODEL` as a static fallback only for module-load-
// time defaults (default context value, SSR, etc.). Production paths must
// go through useActiveModel() so a Model Y driver sees Bayberry, not the
// Poppyseed Model 3.

import { createContext, useContext } from 'react';

export const VehicleModelContext = createContext<VehicleModelConfig>(PoppyseedConfig);

/**
 * Returns the currently-active vehicle model config. Reads the value
 * supplied by the nearest <VehicleModelContext.Provider> above in the
 * tree. Defaults to Poppyseed when no provider is mounted (e.g. unit
 * tests, isolated component stories).
 */
export function useActiveModel(): VehicleModelConfig {
  return useContext(VehicleModelContext);
}

/**
 * Static default — kept for top-of-file constants in legacy code paths
 * that haven't migrated to useActiveModel() yet. NEW code should always
 * use the hook instead so multi-car selection works.
 */
export const ACTIVE_VEHICLE_MODEL = PoppyseedConfig;
