/**
 * Community Model 3 (CC-BY) — opening animations (FIRST PASS, to calibrate).
 *
 * Unlike the Tesla configs (whose keyframes are exact copies of Tesla's
 * .tscn animations), this community model has no authored animation data, so
 * the angles/axes below are derived geometrically from the rig and WILL need
 * iterative tuning in the viewer.
 *
 * RIG FACTS (from `Tesla-Godot-Test/compute-pivot-world.mjs` on the rigged
 * GLB — the NON-baked export that preserves the hinge dummies):
 *   - The model renders X=width(right+), Y=up, Z=length(rear+, front-),
 *     same as the baked static model (rootTransform only applies ×0.01 scale).
 *   - Every hinge dummy shares the same local→world axis mapping:
 *         localX → world +X (width)
 *         localY → world -Z (toward the front)
 *         localZ → world +Y (up)
 *   - So: HOOD + TRUNK swing around localX (the width axis); the four DOORS
 *     swing around localZ (the vertical axis).
 *   - Meshes are correctly parented under each dummy (door incl. its window +
 *     mirror, trunk incl. its lights, hood incl. trim), so rotating the dummy
 *     swings the whole panel around its hinge.
 *
 * Pivot node names (exact, from the GLB):
 *   hood  = bonnet_dummy_279   trunk = boot_dummy_158
 *   LF    = door_lf_dummy_184  LR    = door_lr_dummy_202
 *   RF    = door_rf_dummy_218  RR    = door_rr_dummy_235
 *
 * SIGN/ANGLE TUNING: if a panel opens the WRONG way, flip the sign of the
 * non-zero Euler component. If it rotates around the wrong axis, move the
 * value between the X and Z slots. Door open ≈ 65°, hood ≈ 45°, trunk ≈ 55°.
 */

import type { OpeningDefinition } from './vehicleOpeningTypes';

const OPEN_LEN = 0.7;

export const OPENINGS_COMMUNITY_M3: ReadonlyArray<OpeningDefinition> = [
  // Hood / frunk — hinge at the nose, swings around the width axis (localX).
  {
    id: 'hood',
    length: OPEN_LEN,
    tracks: [
      {
        node: 'bonnet_dummy_279',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: OPEN_LEN, eul: [-45, 0, 0] },
        ],
      },
    ],
  },
  // Trunk — hinge at the rear roofline, swings up around the width axis.
  {
    id: 'trunk',
    length: OPEN_LEN,
    tracks: [
      {
        node: 'boot_dummy_158',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: OPEN_LEN, eul: [55, 0, 0] },
        ],
      },
    ],
  },
  // Doors — swing around the vertical axis (localZ). Left doors open toward
  // -X (negative), right doors toward +X (positive).
  {
    id: 'door_LF',
    length: OPEN_LEN,
    tracks: [
      {
        node: 'door_lf_dummy_184',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: OPEN_LEN, eul: [0, 0, -65] },
        ],
      },
    ],
  },
  {
    id: 'door_LR',
    length: OPEN_LEN,
    tracks: [
      {
        node: 'door_lr_dummy_202',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: OPEN_LEN, eul: [0, 0, -65] },
        ],
      },
    ],
  },
  {
    id: 'door_RF',
    length: OPEN_LEN,
    tracks: [
      {
        node: 'door_rf_dummy_218',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: OPEN_LEN, eul: [0, 0, 65] },
        ],
      },
    ],
  },
  {
    id: 'door_RR',
    length: OPEN_LEN,
    tracks: [
      {
        node: 'door_rr_dummy_235',
        rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: OPEN_LEN, eul: [0, 0, 65] },
        ],
      },
    ],
  },
];
