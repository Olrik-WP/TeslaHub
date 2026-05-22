# Tesla custom wrap PNGs

This folder bundles the 20 official Tesla livery examples from
[teslamotors/custom-wraps](https://github.com/teslamotors/custom-wraps),
exposed in the Showroom **Esthétique → Wrap (livrée custom) → Wraps
Tesla officiels** gallery.

## Layout

```
public/wraps/
├── m3/   ← 20 PNGs cloned from custom-wraps/model3-2024-base/example
└── my/   ← 20 PNGs cloned from custom-wraps/modely-2025-base/example
```

**IMPORTANT — match the GLB exactly :** Tesla ships a DIFFERENT UV1
layout for every trim of the Y (`modely-2025-base`,
`modely-2025-performance`, `modely-2025-premium`, `modely-l`). Our
bundled `BayberryE41.glb` is the **Y Juniper base 2025** export, so the
UV1 islands match `modely-2025-base` ONLY. Pulling examples from
`modely-2025-premium` (or any other trim) produces a wrap that decals
on the wrong panels — the bonnet ends up on the doors, etc.

Each PNG carries the SAME file name across the two folders (e.g.
`Acid_Drip.png`), but Tesla maps body UVs differently per model so
the same livery renders distinctly on the M3 vs the Y. The frontend
picks the matching folder at render time from the active model key.

## Format constraints (mirror Tesla's in-car configurator)

- **PNG** only — the upload endpoint validates the PNG magic header
- **512×512 to 1024×1024 px** (1024² recommended for sharpness)
- **≤ 1 MB** — server returns 400 above the cap
- File names: alphanumerics, `_`, `-`, spaces, max 30 chars

## Refreshing from upstream

When `teslamotors/custom-wraps` ships new examples, sync them:

```powershell
# clone or pull custom-wraps somewhere, then:
$src = 'D:\GIT-Local\custom-wraps'
$dst = 'src\TeslaHub.Web\public\wraps'
Copy-Item "$src\model3-2024-base\example\*.png"  "$dst\m3\" -Force
Copy-Item "$src\modely-2025-base\example\*.png"  "$dst\my\" -Force
```

If file names change, mirror the new list in `TESLA_WRAP_FILES`
inside `src/components/ShowroomAestheticsSection.tsx`.

## Per-car user uploads

Anything dropped in the Showroom's drag-and-drop zone bypasses this
folder entirely — it's POSTed to
`/api/vehicle/{carId}/showroom/wrap` and stored as a `bytea` column
on `CarShowroomConfigs.WrapPng`. See
`src/TeslaHub.Api/Endpoints/ShowroomEndpoints.cs`.
