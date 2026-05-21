/**
 * Tesla Model Y Juniper (Bayberry) — opening animations.
 *
 * AUTO-GENERATED from Tesla's source .tres files via
 *   node Tesla-Godot-Test/convert-bayberry-anims.mjs
 *
 * Source files (all identical across Bayberry / BayberryE41 / BayberryE80 —
 * Tesla ships the same animation set for all 3 Y trims):
 *   Tesla-APK-Android/recover/godot/Ego/BayberryE41/
 *     HoodAnimation.tres        → opening 'hood' (+ struts LH/RH)
 *     TrunkAnimation.tres       → opening 'trunk' (+ struts LL/RL)
 *     ChargeportAnimation.tres  → opening 'charge_port'
 *     {LF,RF,LR,RR}DoorAnimation.tres
 *     {LF,RF,LR,RR}WindowAnimation.tres
 *
 * Key format differences vs Poppyseed (M3 Highland):
 *   - Tesla authored Bayberry as ABSOLUTE quaternion + position keys
 *     (Godot transform tracks) instead of inline Euler-degree keys.
 *   - The converter unrolls quaternions to Euler-YXZ degrees so the
 *     existing useVehicleOpenings runtime can apply them verbatim.
 *   - Bayberry has NO mirror_LF / mirror_RF animations — the rear-view
 *     mirrors are fused into the door meshes (no separate node), so
 *     auto-fold on lock is impossible on the Y without mesh surgery.
 *     The model config drops the `mirrorTracks` field accordingly.
 *
 * DO NOT hand-edit — re-run the generator when Tesla ships a new APK.
 */

import type { OpeningDefinition } from './vehicleOpeningTypes';

export const OPENINGS_BAYBERRY: ReadonlyArray<OpeningDefinition> = [
  {
    id: 'hood',
    length: 1.25,
    tracks: [
      { node: 'Hood_Spatial', rotation: [
          { t: 0, eul: [-0.1227, 0, 0] },
          { t: 1.25, eul: [68.6519, 0, 0] },
        ] },
      { node: 'Left_Strut_Lower', rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 1.25, eul: [-70.0001, 0, 0] },
        ] },
      { node: 'Right_Strut_Lower', rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 1.25, eul: [-70.0001, 0, 0] },
        ] },
    ],
  },
  {
    id: 'trunk',
    length: 1.25,
    tracks: [
      { node: 'Trunk_Spatial', rotation: [
          { t: 0, eul: [0.1774, 0, 0] },
          { t: 1.25, eul: [-65.6957, 0, 0] },
        ] },
      { node: 'Left_Strut_Higher', rotation: [
          { t: 0, eul: [-0.1774, 0, 0] },
          { t: 1.25, eul: [-7.3774, 0, 0] },
        ] },
      { node: 'Right_Strut_Higher', rotation: [
          { t: 0, eul: [-0.1774, 0, 0] },
          { t: 1.25, eul: [-7.3774, 0, 0] },
        ] },
    ],
  },
  {
    id: 'charge_port',
    length: 1.25,
    tracks: [
      { node: 'Charge_Port_Spatial', rotation: [
          { t: 0, eul: [0, 0, 0.2683] },
          { t: 1.25, eul: [-15.955, 20.4582, -103.4322] },
        ] },
    ],
  },
  {
    id: 'door_LF',
    length: 1.25,
    tracks: [
      { node: 'Door_LF_Spatial', rotation: [
          { t: 0, eul: [0, 0, 0] },
          { t: 1.25, eul: [0, -70.0001, 0] },
        ] },
    ],
  },
  {
    id: 'door_LR',
    length: 1.25,
    tracks: [
      { node: 'Door_LR_Spatial', rotation: [
          { t: 0, eul: [0, -0.1422, 0] },
          { t: 1.25, eul: [0, -70.1421, 0] },
        ] },
    ],
  },
  {
    id: 'door_RF',
    length: 1.25,
    tracks: [
      { node: 'Door_RF_Spatial', rotation: [
          { t: 0, eul: [0, -0.4829, 0] },
          { t: 1.25, eul: [0, 70.0001, 0] },
        ] },
    ],
  },
  {
    id: 'door_RR',
    length: 1.25,
    tracks: [
      { node: 'Door_RR_Spatial', rotation: [
          { t: 0, eul: [0, 0.0815, 0] },
          { t: 1.25, eul: [0, 70.0815, 0] },
        ] },
    ],
  },
  {
    id: 'window_LF',
    length: 1.25,
    tracks: [
      { node: 'Window_FL', translation: [
          { t: 0, pos: [0.0697, 0.4533, 0.684] },
          { t: 1.25, pos: [-0.0322, 0.0052, 0.5247] },
        ] },
    ],
  },
  {
    id: 'window_LR',
    length: 1.25,
    tracks: [
      { node: 'Window_RL', rotation: [
          { t: 0, eul: [0, 0.66, 0] },
          { t: 1.25, eul: [0.5756, -1.5356, 4.6572] },
        ], translation: [
          { t: 0, pos: [0.1131, 0.517, 0.5194] },
          { t: 1.25, pos: [-0.0136, 0.066, 0.4379] },
        ] },
    ],
  },
  {
    id: 'window_RF',
    length: 1.25,
    tracks: [
      { node: 'Window_FR', translation: [
          { t: 0, pos: [-0.0655, 0.4528, 0.6845] },
          { t: 1.25, pos: [0.0374, 0.0196, 0.5] },
        ] },
    ],
  },
  {
    id: 'window_RR',
    length: 1.25,
    tracks: [
      { node: 'Window_RR', rotation: [
          { t: 0, eul: [0, -0.2947, 0] },
          { t: 1.25, eul: [-0.6151, 1.1845, -1.5939] },
        ], translation: [
          { t: 0, pos: [-0.113, 0.517, 0.5194] },
          { t: 1.25, pos: [0.0146, 0.1135, 0.4516] },
        ] },
    ],
  },
];
