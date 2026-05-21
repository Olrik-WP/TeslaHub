/**
 * Tesla Model 3 Highland (Poppyseed) — opening animations.
 *
 * Tesla's Godot 3.5 PackedSceneGLTF exporter strips AnimationPlayer
 * tracks from the .glb, so we reconstruct the 13 official animations
 * defined in `Tesla-APK-Android/.../Poppyseed.tscn` by hand.
 *
 * Each opening targets one or more "pivot" nodes by name. The
 * animation runs from t=0 (closed) to t=length (fully open). All
 * keyframes below are EXACT copies of the values in the .tscn — see
 * the source comments next to each definition for the corresponding
 * `[sub_resource type="Animation"]`.
 *
 * COORDINATE SYSTEM:
 *   - Godot Y-up, right-handed, rotation_degrees as (x, y, z) Euler.
 *   - Three.js matches Y-up / right-handed. Its Euler default order
 *     is 'XYZ' but the runtime explicitly uses 'YXZ' to match Godot.
 *   - Translations are in metres, applied as ABSOLUTE LOCAL positions
 *     relative to the node's parent (Tesla authored them that way —
 *     the runtime calls `node.position.set(...)` directly).
 *
 * Bayberry (MY Juniper) has its own auto-generated file
 * (`bayberryOpenings.ts`) sourced from .tres animation resources
 * instead — see that file for the generator script.
 */

import type {
  OpeningDefinition,
  OpeningTrack,
} from './vehicleOpeningTypes';

/**
 * Mirror fold animations (anims/4 and anims/7 in .tscn). These are
 * surfaced as standalone openings — Tesla originally embedded them in
 * the LF / RF door animations but real Teslas fold mirrors on lock
 * (auto-fold setting), NOT on door open. The visual sync hook drives
 * them from `vehicle.isLocked`.
 */
export const MIRROR_TRACKS_POPPYSEED = {
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
 * The 13 openings (11 top-level + 2 mirror fold).
 *
 * Source: `Tesla-APK-Android/decoded/.../Ego/v2023/Poppyseed/Poppyseed.tscn`
 * sub_resources Animation id=1..13.
 */
export const OPENINGS_POPPYSEED: ReadonlyArray<OpeningDefinition> = [
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
    tracks: [MIRROR_TRACKS_POPPYSEED.mirror_LF],
  },
  {
    id: 'mirror_RF',
    length: 1.0,
    tracks: [MIRROR_TRACKS_POPPYSEED.mirror_RF],
  },
];
