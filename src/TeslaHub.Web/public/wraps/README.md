# Tesla custom wrap templates

This folder hosts the bundled wrap PNGs shown as one-click presets in
the Showroom **Esthétique → Wrap (livrée custom) → Templates Tesla
officiels** gallery.

## Expected file names

The frontend `TESLA_TEMPLATES` array in
`src/components/ShowroomAestheticsSection.tsx` references the
following paths — drop matching PNGs here to enable each preset:

| File                | Model         | Notes                              |
| ------------------- | ------------- | ---------------------------------- |
| `m3-classic.png`    | Model 3       | Tesla classic livery               |
| `m3-camo.png`       | Model 3       | Camo pattern                       |
| `my-classic.png`    | Model Y E41   | Tesla classic livery               |
| `my-stripes.png`    | Model Y E41   | Stripes pattern                    |

If a file is missing the gallery still renders, but its thumbnail is
greyed out (the `<img onError>` fades broken images to 30 % opacity).

## Format requirements

Same constraints as Tesla's in-car configurator (Toybox → Paint
Shop → Wraps tab from a USB drive):

- **PNG** only (the upload endpoint validates the PNG magic bytes)
- **512×512 to 1024×1024 px** (1024² recommended for sharpness)
- **≤ 1 MB** (server enforces — bigger files are rejected with a 400)
- File name with alphanumerics, `_`, `-`, spaces (≤ 30 chars)

## Where to source the official Tesla templates

The Tesla team publishes per-model base templates under MIT-friendly
terms on GitHub: <https://github.com/teslamotors/custom-wraps>

Each model folder (e.g. `model3-2024-base/`, `modely-2025-base/`)
contains a `template.png` plus a few `example_*.png` showcase wraps
sized exactly to the spec above. Pick the templates that match the
trims you want to expose and rename them to the filenames in the
table above.
