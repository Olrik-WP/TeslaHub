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

export const BayberryConfig: VehicleModelConfig = {
  key: 'bayberry',
  displayName: 'Model Y Juniper Propulsion',
  modelUrl: '/models/bayberry_e41.glb',  // TODO(model-y): extract GLB
  wheelUrl: '/models/wheel_e41.glb',     // TODO(model-y): extract GLB

  cameraPose: {
    // TODO(model-y): re-frame against the Y body — taller silhouette
    // needs slightly higher target.y and possibly a tiny zoom-out.
    position: [3.85, 2.0, 4.95],
    target: [0, 0.7, 0],
    fov: 38,
  },

  wheelFallbackPositions: [
    // TODO(model-y): verify wheelbase + track. E41 wears 19" wheels by
    // default → tyre radius ≈ 0.353 m (Continental ProContact 235/55R19).
    { id: 'LF', x: +1.4875, y: 0.353, z: -0.830, flipZ: true },
    { id: 'RF', x: +1.4875, y: 0.353, z: +0.830, flipZ: false },
    { id: 'LR', x: -1.3875, y: 0.353, z: -0.830, flipZ: true },
    { id: 'RR', x: -1.3875, y: 0.353, z: +0.830, flipZ: false },
  ],
  wheelAnchorNames: PoppyseedConfig.wheelAnchorNames, // Tesla naming reused

  chargePort: {
    nodeName: 'Charge_Cap_Spatial',
    alternateNames: ['Chargeport_Spatial', 'Charge_Port_Spatial', 'ChargePort'],
    // TODO(model-y): re-measure once bayberry.glb loads. Y port sits
    // slightly higher (taller body) — bump Y by ~+0.05.
    fallbackWorld: [-1.856, 1.016, -0.78],
    pivotToSocketOffset: [-0.05, -0.06, 0],
    plugDirection: [0, 0, 1],
  },
  cableGroundAnchor: [-3.5, 0, -1.5],

  actionAnchors: PoppyseedConfig.actionAnchors, // Tesla naming reused

  sentryCameraPositions: [
    // TODO(model-y): re-calibrate. Y is taller, so windshield/B-pillar
    // values rise by ~+0.05, and the rear sits higher above the plate.
    [+0.40, 1.40, 0],
    [+2.05, 0.60, 0],
    [+1.10, 0.78, -0.91],
    [+1.10, 0.78, +0.91],
    [-0.18, 1.28, -0.91],
    [-0.18, 1.28, +0.91],
    [-2.10, 0.88, 0],
  ],

  // Light & projection node names — Tesla reuses these verbatim
  // between Highland and Juniper Godot scenes.
  brakeLightNodes: PoppyseedConfig.brakeLightNodes,
  reverseLightNodes: PoppyseedConfig.reverseLightNodes,
  headlightNodes: PoppyseedConfig.headlightNodes,
  groundProjectionNodes: PoppyseedConfig.groundProjectionNodes,

  hiddenNodes: PoppyseedConfig.hiddenNodes,
  floorNodes: PoppyseedConfig.floorNodes,
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
