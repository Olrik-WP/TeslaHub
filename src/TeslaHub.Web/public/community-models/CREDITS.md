# Community 3D vehicle model — credits & licence

This folder holds the **bundled, openly-licensed** GLB shipped with the
public build (baked into the web image, served from `/community-models`).
It is intentionally kept SEPARATE from `public/models/` so the optional
Tesla-models Docker volume (`./teslahub-models:/srv/models:ro`) never
shadows it — the community car works out of the box for everyone.

Proprietary Tesla GLBs (from the mobile app) are NOT in this repo; see
the note at the bottom.

## Bundled — community model (default for public users)

| | |
|---|---|
| **File** | `community-m3-rigged.glb` |
| **Title** | Tesla Model 3 (Realistic Graphics) |
| **Author** | ChoochooLi |
| **Source** | https://sketchfab.com/3d-models/tesla-model-3-realistic-graphics |
| **Licence** | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| **Changes** | **Yes — modified.** Rigged for door/hood/trunk opening pivots, optimised with `gltf-transform` (dedup → weld → simplify → draco), re-scaled and re-oriented to TeslaHub's world axes, materials remapped for paint colour. |

### Attribution notice (CC BY 4.0)

> "Tesla Model 3 (Realistic Graphics)" by **ChoochooLi**
> (https://sketchfab.com/3d-models/tesla-model-3-realistic-graphics)
> is licensed under **CC BY 4.0**
> (https://creativecommons.org/licenses/by/4.0/).
> The model has been **modified** for use in TeslaHub (rigged,
> optimised, re-scaled, materials remapped).

This credit is also shown in-app in the **Showroom → Modèle / Trim**
section whenever the community model is selected, and in the project
`README.md`. Per CC BY 4.0 you must keep these notices intact when
redistributing the build.

## Proprietary Tesla models (NOT committed)

The `*.glb` files extracted from the Tesla mobile app (e.g.
`poppyseed.glb`, `bayberry_e41.glb`, `supercharger_base.glb`, the wheel
GLBs, …) are **Tesla intellectual property** and are intentionally
git-ignored. They are required only if you want the exact in-app Tesla
trims; the viewer degrades gracefully to the community model when they
are absent.
