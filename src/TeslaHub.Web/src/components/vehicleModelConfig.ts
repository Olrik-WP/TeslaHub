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

/** Tesla internal codename for each car family. */
export type VehicleModelKey = 'poppyseed' | 'bayberry';

/** Each wheel mount when the GLB doesn't ship anchor empties. */
/** Single ground-projection beam configuration. */
export interface ProjectionConfig {
  /** Public URL of the beam PNG (alpha-channel = cone shape). When
   *  undefined, the runtime falls back to the built-in
   *  /textures/headlight_beam.png or /textures/stoplight_beam.png. */
  textureUrl?: string;
  /** RGB hex multiplied into the texture's diffuse. White = unchanged
   *  Tesla warm-white / soft-red; tune to recolour the beam. */
  color: number;
  /** 0..1 alpha multiplier on top of the texture's own alpha. */
  opacity: number;
  /** Three.js renderOrder. +10 = above floor + paint, -1 = below
   *  shadow. */
  renderOrder: number;
}

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

  // ───────────────────────────────────────────────────────────────────
  // Action anchors — pivots used by callouts to attach floating buttons
  // ───────────────────────────────────────────────────────────────────
  /** Node names where each interactive callout button anchors. */
  actionAnchors: {
    frunk: string;
    trunk: string;
    chargePort: string;
    /** Representative window node — chosen for left-front for camera
     *  framing (closest to default orbit pose). */
    window: string;
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
    /** Parent NODE names whose descendants are outer glass (windows,
     *  windshields, panoramic roof) — used for transparency fixes. */
    outerGlassNode: RegExp;
    /** Material names that are outer glass — fallback when the node
     *  test misses but the material is unambiguously glass. */
    outerGlassMaterial: RegExp;
    /** Subset of outer glass nodes that should get the DARKER roof
     *  tint (panoramic roofs are bronze/black, not light grey). M3
     *  uses `Windows_Top`/`Sunroof`; Y exports the roof as a single
     *  mesh named `Fade` (Tesla's quirk — that's also its naming in
     *  the source Bayberry.tscn). */
    roofGlassNode: RegExp;
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
   *  `outerEnvMultiplier` to see more sky reflection, decrease
   *  `outerWindowTint` to darken windows further, etc.
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
    /** Multiplier applied to outer glass `envMapIntensity` — dampens
     *  sky reflections so the tint is visible. Default 0.3. */
    outerEnvMultiplier: number;
    /** Forced opacity for the panoramic roof when the GLB ships it at
     *  alpha < 0.4 (default 0.90 = nearly black). */
    outerRoofOpacity: number;
    /** Forced opacity for non-roof outer glass (default 0.55). */
    outerWindowOpacity: number;
    /** Scalar multiplied into the panoramic roof's diffuse colour —
     *  darker than the side windows (default 0.15). */
    outerRoofTint: number;
    /** Scalar multiplied into side-window / windshield diffuse
     *  (default 0.45). */
    outerWindowTint: number;
    /** Final opacity of the inner mixed pane (windshield inner). Very
     *  low so the windshield reads as see-through. Default 0.08. */
    innerMixedOpacity: number;
    /** Multiplier on inner mixed `envMapIntensity` — kills the mirror
     *  that would otherwise reflect the HDR sky through the windshield.
     *  Default 0.02. */
    innerMixedEnvMultiplier: number;
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
    brakeIntensity: number;
    brakeColor: number;
    reverseIntensity: number;
    reverseColor: number;
    headlightIntensity: number;
    headlightColor: number;
  };

  // ───────────────────────────────────────────────────────────────────
  // Ground projections — beam textures painted under the car
  // ───────────────────────────────────────────────────────────────────
  /** Per-beam tuning of the ground projection quads (Headlight in
   *  front, Stoplight in back). `textureUrl` overrides the baked /
   *  fallback PNG with a user-uploaded one; `color` is multiplied
   *  into the texture (white = unchanged); `opacity` is the final
   *  alpha multiplier; `renderOrder` controls the z-fight ordering
   *  vs the floor and the body. */
  projections: {
    headlight: ProjectionConfig;
    stoplight: ProjectionConfig;
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
    /** Roughness forced on plastic black / rubber materials. Default
     *  0.55 — sub-matte so brake-dust / tyre rubber reads correctly. */
    plasticRoughness: number;
    /** EnvMap boost for plastic. Default 1.5. */
    plasticEnvBoost: number;
  };

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

  // Frame composition: 3/4 front view, slight elevation, car centred.
  // Distance ~5.5 m gives a tight crop with the wheels touching the
  // canvas bottom edge and a small headroom for the roof.
  cameraPose: {
    position: [3.85, 1.9, 4.95],
    target: [0, 0.6, 0],
    fov: 38,
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

  // Charge port: rear-left fender, ~96 cm high. The fallback world
  // position was measured at runtime by reading Charge_Cap_Spatial.
  // `Charge_Cap_Spatial` is the trapdoor's REAR hinge pivot, NOT the
  // plug socket itself — hence the small offset.
  chargePort: {
    nodeName: 'Charge_Cap_Spatial',
    alternateNames: ['Chargeport_Spatial', 'Charge_Port_Spatial', 'ChargePort'],
    fallbackWorld: [-1.856, 0.966, -0.74],
    pivotToSocketOffset: [-0.05, -0.06, 0],
    plugDirection: [0, 0, 1],
  },
  // ~3.5 m behind and 1.5 m to the left of the car centre — gives the
  // cable enough length to drape on the floor before rising to the port.
  cableGroundAnchor: [-3.5, 0, -1.5],

  actionAnchors: {
    frunk: 'Hood_Spatial',
    trunk: 'Trunk_Spatial',
    chargePort: 'Charge_Cap_Spatial',
    window: 'Window_LF_Spatial',
  },

  sentryCameraPositions: [
    [+0.40, 1.32, 0],      // 1. front rearview (top of windshield)
    [+2.05, 0.55, 0],      // 2. front bumper centre (above black grille)
    [+1.10, 0.72, -0.88],  // 3. left front fender (turn-signal lens)
    [+1.10, 0.72, +0.88],  // 4. right front fender
    [-0.18, 1.20, -0.88],  // 5. left B-pillar (rear-looking)
    [-0.18, 1.20, +0.88],  // 6. right B-pillar
    [-2.10, 0.80, 0],      // 7. rear (above license plate)
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
  ],
  floorNodes: ['Floor', 'Ground_Plane'],

  // Tesla M3 Highland materials. `Paint_*` for body, `*_Skybox`/`Glass_Lights`
  // for HDR-reflective glass. Body paint forced to Pearl White Multi-Coat.
  materialPatterns: {
    bodyPaint: /^paint(_|skybox|$)/i,
    outerGlassNode:
      /windows_top|window_l[fr]|window_r[fr]|front_screen|rear_screen|sunroof/i,
    outerGlassMaterial: /glass.*skybox|glass_lights/i,
    roofGlassNode: /windows_top|sunroof/i,
    // M3 audit confirms `Glass_Interior` + `Glass_Interior_Tinted_Fade`
    // both ship with rough=0.01 just like Bayberry — kill the mirror.
    innerGlassMaterial: /^glass_interior/i,
  },
  bodyPaintColor: 0xf2f2f0,
  calloutHeight: 0.45,
  wheelFinish: {
    alloyRoughnessMin: 0.35,
    alloyEnvBoost: 1.6,
    plasticRoughness: 0.55,
    plasticEnvBoost: 1.5,
  },
  glassFinish: {
    outerEnvMultiplier: 0.3,
    outerRoofOpacity: 0.9,
    outerWindowOpacity: 0.55,
    outerRoofTint: 0.15,
    outerWindowTint: 0.45,
    innerMixedOpacity: 0.08,
    innerMixedEnvMultiplier: 0.02,
    innerSoloEnvMultiplier: 0.6,
  },
  lightTuning: {
    brakeIntensity: 2.5,
    brakeColor: 0xff1a1a,
    reverseIntensity: 1.8,
    reverseColor: 0xfff8e8,
    headlightIntensity: 1.4,
    headlightColor: 0xfff5e8,
  },
  projections: {
    headlight: { color: 0xffffff, opacity: 1, renderOrder: 10 },
    stoplight: { color: 0xffffff, opacity: 1, renderOrder: 10 },
  },
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

export const BayberryConfig: VehicleModelConfig = {
  key: 'bayberry',
  displayName: 'Model Y Juniper Propulsion',
  modelUrl: '/models/bayberry_e41.glb',
  wheelUrl: '/models/wheel_e41.glb',

  cameraPose: {
    // Y body is ~5 cm taller than Highland → target Y nudged up.
    // Same orbit distance; fine-tune by eye once the car loads.
    position: [3.85, 2.0, 4.95],
    target: [0, 0.7, 0],
    fov: 38,
  },

  wheelFallbackPositions: [
    // Wheelbase 2890 mm (Y Juniper) → x ±1.445.
    // Track 1647/1646 mm centre-to-centre → ±0.823 m.
    // E41 wheel is 19" with 255/45R19 → tyre radius ≈ 0.353 m.
    // (Calibrate Z by eye if a wheel still sits proud of the arch — the
    //  GLB's native wheel bbox isn't necessarily centred at its origin.)
    { id: 'LF', x: +1.495, y: 0.353, z: -0.823, flipZ: true },
    { id: 'RF', x: +1.495, y: 0.353, z: +0.823, flipZ: false },
    { id: 'LR', x: -1.395, y: 0.353, z: -0.823, flipZ: true },
    { id: 'RR', x: -1.395, y: 0.353, z: +0.823, flipZ: false },
  ],
  // Bayberry GLB does NOT ship Wheel_*_Spatial anchors — confirmed via
  // inspect. Always falls back to wheelFallbackPositions above.
  wheelAnchorNames: [],

  chargePort: {
    // Bayberry's pivot is named WITHOUT the abbreviated "Cap".
    nodeName: 'Charge_Port_Spatial',
    alternateNames: ['Charge_Cap_Spatial', 'Chargeport_Spatial', 'ChargePort'],
    // TODO(model-y): re-measure live from the console once it loads:
    //   scene.getObjectByName('Charge_Port_Spatial').getWorldPosition(new THREE.Vector3())
    fallbackWorld: [-1.856, 1.016, -0.78],
    pivotToSocketOffset: [-0.05, -0.06, 0],
    plugDirection: [0, 0, 1],
  },
  cableGroundAnchor: [-3.5, 0, -1.5],

  actionAnchors: {
    frunk: 'Hood_Spatial',         // identical to M3
    trunk: 'Trunk_Spatial',        // identical to M3
    chargePort: 'Charge_Port_Spatial',  // RENAMED on Y
    window: 'Window_FL',           // RENAMED on Y (FL vs LF, no _Spatial)
  },

  sentryCameraPositions: [
    // TODO(model-y): re-calibrate live. Y is taller, so windshield/B-pillar
    // values rise by ~+0.05, and the rear sits higher above the plate.
    [+0.40, 1.40, 0],
    [+2.05, 0.60, 0],
    [+1.10, 0.78, -0.91],
    [+1.10, 0.78, +0.91],
    [-0.18, 1.28, -0.91],
    [-0.18, 1.28, +0.91],
    [-2.10, 0.88, 0],
  ],

  // Bayberry has ONE merged brake mesh `Brake_Light` (no per-side split)
  // plus the optional CHMSL-on variant. The CHMSL-off variant is the
  // "rest state" mesh and stays visible by default — when we boost
  // emissive on the "On" mesh it doesn't matter that Off is also on,
  // because Off is unlit anyway.
  brakeLightNodes: ['Brake_Light', 'Brake_Lights_CHMSL_On'],
  // Two reverse variants (EU + US plate-area lamp) — we keep both lit
  // when in R; the US one will simply be hidden if we ever add a
  // region picker.
  reverseLightNodes: ['Reverse', 'Reverse_US'],
  // Y front lights split left/right + low-beam (DRL) / high-beam.
  // Boost DRLs only — high beams stay dark unless we later add a
  // dedicated headlightHighOn signal.
  headlightNodes: ['DRL_Left', 'DRL_Right'],
  groundProjectionNodes: {
    headlights: 'HeadLightProjection',
    stoplights: 'BrakeLightProjection',
  },

  hiddenNodes: [
    // NOTE: `Fade` was originally suspected as a Showroom ghost-overlay
    // and added here — that was WRONG. `Fade` is the panoramic glass
    // ROOF (Tesla's odd choice of name in Bayberry.tscn). It's tinted
    // via materialPatterns.roofGlassNode below; keep it visible.

    // Right-hand-drive variant — French market is LHD. Cuts the second
    // steering wheel poking through the dashboard.
    'RHD',
    'Doorcard_LF_RHD',
    'Doorcard_RF_RHD',

    // US-spec variants — keep EU plates + EU turn signals (amber).
    'Plate_US',
    'Left_Turn_Signal_US',
    'Right_Turn_Signal_US',
    'Reverse_US',  // also referenced in reverseLightNodes; staying hidden
                   // means the emissive boost is a no-op for it
  ],
  // Y exports the studio shadow as a single word `GroundPlane`.
  floorNodes: ['GroundPlane'],

  materialPatterns: {
    // `Paint` covers the glossy body; `PaintRough` covers the matte
    // wheel-arch trim and underbody bits that Tesla wants tinted too.
    bodyPaint: /^paint(_|rough|$)/i,
    // Window pivot naming flipped (FL instead of LF). `Fade` is the
    // panoramic roof glass (Tesla's quirky name — see materialPatterns
    // .roofGlassNode below). All glass surfaces share the same node-
    // walk logic, so listing Fade here makes its descendants get the
    // transparency/depth-sort fix applied like the door windows.
    outerGlassNode: /^(window_(fl|fr|rl|rr)|fade)$/i,
    // Bayberry uses FOUR distinct glass materials:
    //   - `Glass`                → windshield + rear hatch glass
    //   - `Glass_Windows`        → door windows
    //   - `Glass_Windows_Fade`   → panoramic roof (Fade node)
    //   - `Glass_Interior*`      → dashboard / cabin glass (DON'T tint)
    // The negative lookahead catches the first three and skips the
    // interior set, which would otherwise look pitch black through the
    // tinted outer glass.
    outerGlassMaterial: /^glass(?!_interior)/i,
    // Roof gets the darker tint. Y's roof IS the `Fade` mesh (not the
    // M3 `Windows_Top` / `Sunroof`). Both patterns kept for safety
    // even though only Fade exists in Bayberry.
    roofGlassNode: /^fade$/i,
    // Bayberry layers windshield (in Static_Exterior) and door windows
    // with both `Glass` (outer) AND `Glass_Interior` (inner) panes.
    // `Glass_Interior` rough=0.01 → mirror that reflects the HDR sky
    // straight through the very transparent outer Glass (alpha 0.16),
    // making the windshield read as bright white. Detect and dampen.
    innerGlassMaterial: /^glass_interior/i,
    // Only the windshield's inner pane (`Glass_Interior_Fade`, used by
    // the Fade mesh) gets the dimmed treatment. The door-window inner
    // panes (`Glass_Interior` on Window_FL/FR/RL/RR + Static_Exterior)
    // must stay opaque so Tesla's factory tint reads correctly and the
    // rear privacy glass looks black, not grey.
    dimmedInnerGlassMaterial: /^glass_interior_fade$/i,
  },
  bodyPaintColor: 0xf2f2f0,  // Pearl White Multi-Coat (same as M3 default)
  calloutHeight: 0.50,        // +5 cm vs M3 — Y is taller, callouts need
                              // more lift to clear the higher roofline

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
  wheelFinish: {
    alloyRoughnessMin: 0.35,
    alloyEnvBoost: 1.6,
    plasticRoughness: 0.55,
    plasticEnvBoost: 1.5,
  },
  glassFinish: {
    outerEnvMultiplier: 0.3,
    outerRoofOpacity: 0.9,
    outerWindowOpacity: 0.55,
    outerRoofTint: 0.15,
    outerWindowTint: 0.45,
    innerMixedOpacity: 0.08,
    innerMixedEnvMultiplier: 0.02,
    innerSoloEnvMultiplier: 0.6,
  },
  lightTuning: {
    brakeIntensity: 2.5,
    brakeColor: 0xff1a1a,
    reverseIntensity: 1.8,
    reverseColor: 0xfff8e8,
    headlightIntensity: 1.4,
    headlightColor: 0xfff5e8,
  },
  projections: {
    // renderOrder = 0 to match Bayberry GLB baseline (Tesla ships
    // these primitives with the texture already baked, so we don't
    // need to push them above the opaque pass like we do for M3).
    headlight: { color: 0xffffff, opacity: 1, renderOrder: 0 },
    stoplight: { color: 0xffffff, opacity: 1, renderOrder: 0 },
  },

  // Tesla MY Juniper ships privacy glass on the rear doors (much darker
  // than the front side windows). In the GLB the rear-window geometry
  // is paired as `(no mat)` outer + `Glass_Interior` inner — without an
  // explicit privacy-glass material to tint, the NOMAT handler has no
  // way to know it should be darker than the front-door windows. Listing
  // the parent group names here tells it to boost opacity.
  privacyGlassNodes: [/^Window_R[LR]$/i],

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
