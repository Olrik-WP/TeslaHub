/**
 * Shared types + label dictionary for the per-model opening animation
 * system.
 *
 * Tesla ships a different animation set with each Godot scene
 * (Poppyseed = M3 Highland, Bayberry = MY Juniper, etc.). We extract
 * each set into its own file (`poppyseedOpenings.ts`,
 * `bayberryOpenings.ts`), but the OpeningId enum and the runtime
 * data shapes must stay identical so the same UI / VisualSync /
 * Animator can drive any model.
 *
 * This file is the single source of truth for those shared shapes.
 * The model-specific files only contain `OPENINGS_<MODEL>` arrays
 * and (optionally) `MIRROR_TRACKS_<MODEL>` for the auto-fold feature.
 *
 * Note on `OpeningId`: this is the SUPERSET across all car families.
 * A given model may not implement every id (e.g. Bayberry has no
 * `mirror_LF` / `mirror_RF` because Tesla fused the rear-view mirror
 * mesh into the door). Missing ids simply don't appear in the model's
 * `OPENINGS_<MODEL>` array and the runtime gracefully degrades
 * (set() targets that don't match any opening become no-ops).
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
  // Mirror fold — only Poppyseed has dedicated mirror pivot nodes.
  // Bayberry's mirrors are fused into the door mesh so this animation
  // doesn't apply. We keep the id in the union (single source of
  // truth) and rely on per-model OPENINGS_<MODEL> to opt in.
  | 'mirror_LF'
  | 'mirror_RF';

export interface KeyframeRotation {
  /** Time in seconds (0 → length). */
  t: number;
  /** Euler degrees (x, y, z), applied via `node.rotation.set(...)` with
   *  Three.js order 'YXZ' (matches Godot's `rotation_degrees`). */
  eul: [number, number, number];
}

export interface KeyframeTranslation {
  /** Time in seconds (0 → length). */
  t: number;
  /** Absolute LOCAL position relative to the node's parent, applied
   *  via `node.position.set(...)` (Tesla authored these as absolute
   *  positions, not relative offsets — the runtime applies them
   *  directly without summing with the rest position). */
  pos: [number, number, number];
}

export interface OpeningTrack {
  /** Node name as it appears in the GLB scene graph. Resolved via
   *  `scene.getObjectByName()` which walks the whole graph, so the
   *  LEAF name is enough even when the source authored a path like
   *  `Door_LF_Spatial/Window_FL`. */
  node: string;
  rotation?: ReadonlyArray<KeyframeRotation>;
  translation?: ReadonlyArray<KeyframeTranslation>;
}

export interface OpeningDefinition {
  id: OpeningId;
  /** Total animation length in seconds (matches Godot `length=`). */
  length: number;
  /**
   * Whether this opening is followed by an automatic secondary one.
   * Currently unused — kept for parity with the original .tscn schema
   * in case we ever want to chain (e.g. open door → auto-fold mirror).
   */
  followUp?: OpeningId;
  /** Tracks — one per pivot node. */
  tracks: ReadonlyArray<OpeningTrack>;
}

/**
 * Human-readable French labels for the UI overlay (ShowroomControls,
 * panel buttons, debug menus). Centralised here so we don't duplicate
 * the dictionary per model — labels are the same regardless of which
 * car implements the opening.
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
