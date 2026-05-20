/**
 * Tesla Model 3 Highland (Poppyseed) — opening animations.
 *
 * Tesla's Godot 3.5 PackedSceneGLTF exporter strips AnimationPlayer tracks
 * from the .glb, so we reconstruct the 13 official animations defined in
 * `Tesla-APK-Android/.../Poppyseed.tscn` by hand.
 *
 * Each opening targets one or more "pivot" nodes by name. The animation
 * runs from t=0 (closed) to t=length (fully open). All keyframes below are
 * EXACT copies of the values in the .tscn — see the source comments next
 * to each definition for the corresponding `[sub_resource type="Animation"]`.
 *
 * MULTI-MODEL NOTE:
 *   These keyframes are Poppyseed-specific. Tesla reuses the SAME node
 *   names across model families (Hood_Spatial, Trunk_Spatial, etc.) but
 *   the animation values differ — Model Y has a taller liftgate that
 *   rotates further, the hood opens at a different angle, etc.
 *
 *   When Bayberry (Model Y) lands:
 *     1. Read `Tesla-APK-Android/.../Bayberry.tscn` for the new keyframes.
 *     2. Split this file into `poppyseedOpenings.ts` and
 *        `bayberryOpenings.ts`, exporting each as `OPENINGS_POPPYSEED` /
 *        `OPENINGS_BAYBERRY`.
 *     3. Add `openings: typeof OPENINGS_POPPYSEED` to VehicleModelConfig
 *        and read it via `useActiveModel().openings` in
 *        `useVehicleOpenings.tsx`. The VIN-based picker is already wired
 *        (see vehicleModelConfig.ts > VehicleModelContext / useActiveModel)
 *        so the consumer only needs the field to land on the config object.
 *
 *   Until then we keep them inline to avoid premature abstraction.
 *
 * Coordinate system:
 *   - Godot uses Y-up, right-handed, rotation_degrees in (x, y, z) Euler.
 *   - Three.js matches Y-up / right-handed, but its Euler default order is
 *     "XYZ" (Godot uses "YXZ"). For door rotations (only Y axis used) and
 *     hood/charge cap (only single axis used), the order doesn't matter,
 *     so we can pass the values straight through. For the trunk hinge and
 *     mirrors (multi-axis), keyframes are simple enough that order is OK
 *     too — verified by visual inspection.
 *   - Translations are in meters, applied as offsets relative to each
 *     pivot's REST position. We snapshot rest pos/rot on first frame.
 */

export type OpeningId =
  | 'hood'
  | 'trunk'
  | 'charge_port'
  | 'door_LF'
  | 'door_LR'
  | 'door_RF'
  | 'door_RR'
  | 'window_LF'
  | 'window_LR'
  | 'window_RF'
  | 'window_RR'
  // Mirror fold animations. Originally Tesla embedded these inside the
  // door_LF / door_RF .tscn animations (so opening a front door also
  // folded its mirror). That was wrong though — in real Teslas mirrors
  // fold on LOCK (when the auto-fold setting is enabled), NOT on door
  // open. We expose them as standalone openings so useVehicleVisualSync
  // can drive them from `isLocked`. The same animation tracks are
  // reused, just decoupled from the door triggers.
  | 'mirror_LF'
  | 'mirror_RF';

export interface KeyframeRotation {
  /** Time in seconds (0 → length). */
  t: number;
  /** Euler degrees (x, y, z). */
  eul: [number, number, number];
}

export interface KeyframeTranslation {
  /** Time in seconds (0 → length). */
  t: number;
  /** Offset in meters relative to the node's rest position. */
  pos: [number, number, number];
}

export interface OpeningTrack {
  /** Node name as it appears in the GLB scene graph. */
  node: string;
  rotation?: KeyframeRotation[];
  translation?: KeyframeTranslation[];
}

export interface OpeningDefinition {
  id: OpeningId;
  /** Total animation length in seconds (matches Godot `length=`). */
  length: number;
  /**
   * Whether this opening is followed by an automatic secondary one.
   * (e.g. opening LF door auto-unfolds the LF mirror in the .tscn.)
   */
  followUp?: OpeningId;
  /** Tracks — one per pivot node. */
  tracks: OpeningTrack[];
}

/**
 * Mirror fold animations (anims/4 and anims/7 in .tscn). These are now
 * top-level openings — see OpeningId type comment for why we decoupled
 * them from the door animations.
 */
export const MIRROR_TRACKS = {
  mirror_LF: {
    node: 'Door_LF_Mirror_Spatial',
    rotation: [
      { t: 0, eul: [3.813, 0, 0] as [number, number, number] },
      { t: 1, eul: [2.75644, 43.7474, 2.6356] as [number, number, number] },
    ],
  } satisfies OpeningTrack,
  mirror_RF: {
    node: 'Door_RF_Mirror_Spatial',
    rotation: [
      { t: 0, eul: [0, 0, 0] as [number, number, number] },
      { t: 1, eul: [-2.756, -43.747, 2.636] as [number, number, number] },
    ],
  } satisfies OpeningTrack,
} as const;

/**
 * The 11 top-level openings (excluding the auto-mirror followups).
 *
 * Source: `Tesla-APK-Android/decoded/.../Ego/v2023/Poppyseed/Poppyseed.tscn`
 * sub_resources Animation id=1..13.
 */
export const OPENINGS: OpeningDefinition[] = [
  // anims/1 → Hood (= frunk lid)
  {
    id: 'hood',
    length: 1.5,
    tracks: [
      {
        node: 'Hood_Spatial',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 1.5, eul: [0, 0, 75] },
        ],
      },
    ],
  },

  // anims/2 → Trunk (composite 3-bar linkage so the lid swings UP AND BACK
  // rather than just rotating in place). Three tracks running in parallel.
  {
    id: 'trunk',
    length: 1.5,
    tracks: [
      {
        node: 'Trunk_Spatial',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 0.5, eul: [0, 0, -30] },
          { t: 1.0, eul: [0, 0, -85] },
          { t: 1.5, eul: [0, 0, -147] },
        ],
      },
      {
        node: 'Trunk_Bracket_Main_Spatial',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 1.5, eul: [0, 0, 58.5] },
        ],
      },
      {
        node: 'Trunk_Bracket2_Spatial',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 0.5, eul: [0, 0, 11.7] },
          { t: 1.0, eul: [0, 0, 23] },
          { t: 1.5, eul: [0, 0, 28.57] },
        ],
      },
    ],
  },

  // anims/3 — driver-front door. The original .tscn embedded the LF
  // mirror fold as a parallel track here, but mirrors don't fold when a
  // door opens in real life (they fold on park/lock), so we've moved
  // the mirror tracks to their own standalone openings.
  {
    id: 'door_LF',
    length: 1.5,
    tracks: [
      {
        node: 'Door_LF_Spatial',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 1.5, eul: [0, -65, 0] },
        ],
      },
    ],
  },

  // anims/5
  {
    id: 'door_LR',
    length: 1.5,
    tracks: [
      {
        node: 'Door_LR_Spatial',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 1.5, eul: [0, -65, 0] },
        ],
      },
    ],
  },

  // anims/6 — passenger-front door (RF). Same note as door_LF re: mirror.
  {
    id: 'door_RF',
    length: 1.5,
    tracks: [
      {
        node: 'Door_RF_Spatial',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 1.5, eul: [0, 65, 0] },
        ],
      },
    ],
  },

  // anims/8
  {
    id: 'door_RR',
    length: 1.5,
    tracks: [
      {
        node: 'Door_RR_Spatial',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 1.5, eul: [0, 65, 0] },
        ],
      },
    ],
  },

  // anims/9 — windows combine rotation + translation (glass slides down
  // along curved channel inside the door). Translation deltas are
  // relative offsets from the rest position.
  {
    id: 'window_LF',
    length: 1.5,
    tracks: [
      {
        node: 'Window_LF_Spatial',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 0.75, eul: [-7.69681, -0.144066, 0.267866] },
          { t: 1.5, eul: [-8.79564, -0.286379, 0.519103] },
        ],
        translation: [
          { t: 0, pos: [-0.193, 0.325, 0.056] },
          { t: 0.75, pos: [-0.12467, 0.136309, 0.0295399] },
          { t: 1.5, pos: [-0.0555551, -0.056449, -0.0216944] },
        ],
      },
    ],
  },

  // anims/10
  {
    id: 'window_LR',
    length: 1.5,
    tracks: [
      {
        node: 'Window_LR_Spatial',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 0.75, eul: [-4.40596, -0.215738, 0.009003] },
          { t: 1.5, eul: [-8.812, -0.342, 0.018] },
        ],
        translation: [
          { t: 0, pos: [-0.101, 0.355, 0.078] },
          { t: 0.75, pos: [-0.0745236, 0.232657, 0.0512469] },
          { t: 1.5, pos: [-0.0480473, 0.110314, 0.0334591] },
        ],
      },
    ],
  },

  // anims/11
  {
    id: 'window_RF',
    length: 1.5,
    tracks: [
      {
        node: 'Window_RF_Spatial',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 0.7, eul: [7.697, -0.144, 0.268] },
          { t: 1.5, eul: [8.796, 0.286, 0.519] },
        ],
        translation: [
          { t: 0, pos: [-0.193, 0.325, -0.056] },
          { t: 0.7, pos: [-0.125, 0.136, -0.03] },
          { t: 1.5, pos: [-0.056, -0.056, 0.022] },
        ],
      },
    ],
  },

  // anims/12
  {
    id: 'window_RR',
    length: 1.5,
    tracks: [
      {
        node: 'Window_RR_Spatial',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 0.75, eul: [4.406, 0.216, 0.009] },
          { t: 1.5, eul: [8.812, 0.342, 0.018] },
        ],
        translation: [
          { t: 0, pos: [-0.101, 0.355, -0.078] },
          { t: 0.75, pos: [-0.075, 0.233, -0.051] },
          { t: 1.5, pos: [-0.048, 0.11, -0.033] },
        ],
      },
    ],
  },

  // anims/13 — charge port lid (rotates outward on the rear-left fender)
  {
    id: 'charge_port',
    length: 1.5,
    tracks: [
      {
        node: 'Charge_Cap_Spatial',
        rotation: [
          // Rest already at (0, 16.544, 0) because the Charge_Cap pivot
          // is tilted in its parent frame. The animation rotates around X.
          { t: 0, eul: [0, 16.544, 0] },
          { t: 1.5, eul: [88.6351, 16.544, 0] },
        ],
      },
    ],
  },

  // Mirror fold animations — extracted from anims/4 (LF) and anims/7
  // (RF). Tied to `isLocked` by useVehicleVisualSync. Length kept at
  // 1.0s (vs 1.5s for doors) because real Tesla mirrors fold faster
  // than doors swing.
  {
    id: 'mirror_LF',
    length: 1.0,
    tracks: [MIRROR_TRACKS.mirror_LF],
  },
  {
    id: 'mirror_RF',
    length: 1.0,
    tracks: [MIRROR_TRACKS.mirror_RF],
  },
];

/**
 * Quick lookup by opening id.
 */
export const OPENINGS_BY_ID: Record<OpeningId, OpeningDefinition> = OPENINGS.reduce(
  (acc, o) => {
    acc[o.id] = o;
    return acc;
  },
  {} as Record<OpeningId, OpeningDefinition>,
);

/**
 * Human-readable French labels for the UI overlay.
 */
export const OPENING_LABELS: Record<OpeningId, string> = {
  hood: 'Frunk',
  trunk: 'Coffre',
  charge_port: 'Trappe de charge',
  door_LF: 'Porte avant gauche',
  door_LR: 'Porte arrière gauche',
  door_RF: 'Porte avant droite',
  door_RR: 'Porte arrière droite',
  window_LF: 'Vitre avant gauche',
  window_LR: 'Vitre arrière gauche',
  window_RF: 'Vitre avant droite',
  window_RR: 'Vitre arrière droite',
  mirror_LF: 'Rétroviseur gauche',
  mirror_RF: 'Rétroviseur droit',
};
