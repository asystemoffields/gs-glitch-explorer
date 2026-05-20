# Gravity Spy Glitch Explorer — Build Mission

## What This Is

An interactive, zero-backend web application that lets anyone — Gravity Spy volunteers, LIGO researchers, or curious humans — visually explore the entire landscape of LIGO gravitational-wave detector glitches. Users can navigate a 2D scatter plot of ~100k+ glitches projected from their ML classification vectors, click any point to see its spectrograms, filter by dozens of parameters, and — most importantly — discover potential new glitch classes by finding clusters of uncertain classifications.

Nothing like this exists. Every visualization of the glitch embedding space ever published has been a static figure in a paper. This tool makes it interactive and accessible in a browser.

## Why It Matters

LIGO's ability to detect gravitational waves is limited by noise transients called "glitches." The Gravity Spy project classifies these glitches into ~23 morphological classes using a combination of citizen science (2.7M Zooniverse volunteers) and machine learning. When new glitch classes are discovered and their causes identified, LIGO scientists can mitigate them, directly improving detector sensitivity.

The current discovery process for new glitch classes is painfully slow: a volunteer classifies a glitch on Zooniverse, thinks "this looks weird," posts on a Talk forum, other volunteers agree, and researchers eventually investigate. At the start of O4, the ML model was confidently mislabeling an entirely new glitch class as "Whistle" — a failure that could have been caught much faster with a tool that visualizes where the model is uncertain.

O4 just ended (November 2025). O4c data is being uploaded to Gravity Spy soon. A new short observing run starts summer 2026. The timing for this tool is perfect.

## Architecture

**Zero-backend static app.** Two components:

1. **Data pipeline** (Python script, run once): Downloads Zenodo data → processes it → outputs optimized static JSON files
2. **Web app** (React or standalone HTML/JS): Loads the JSON, renders an interactive WebGL scatter plot with filtering, clicking, and discovery tools

Deployable to GitHub Pages. Runs forever. Costs nothing.

---

## Component 1: Data Pipeline

### Data Sources

**Primary: Gravity Spy ML Classifications (Zenodo)**
- URL: https://zenodo.org/records/5649212
- Contents: CSV files with ML classifications for every glitch from O1, O2, O3a, O3b
- Each row contains:
  - `gravityspy_id` — unique 10-character identifier
  - `ifo` — detector (H1 or L1)
  - `peakGPS` — GPS timestamp of the glitch
  - `snr` — signal-to-noise ratio
  - `peak_frequency` — peak frequency in Hz
  - `Label` — ML-assigned class label
  - Confidence columns for each of the 23 classes (e.g., `Blip`, `Whistle`, `Scattered_Light`, etc.) — each a float 0–1 representing the model's confidence that the glitch belongs to that class

**Secondary: Gravity Spy Volunteer Classifications (Zenodo)**
- URL: https://zenodo.org/records/5911227
- Contents: HDF5 file loadable with pandas (`pd.read_hdf('retired_fulldata_min2_max50_ret0p9.hdf5', key='image_db')`)
- May contain additional metadata including image URLs, volunteer agreement scores, and retirement status

### Processing Steps

1. **Download** both Zenodo datasets
2. **Load and merge** the ML classifications CSVs (one per detector per observing run)
3. **Extract the confidence vectors** — for each glitch, pull the 23 confidence score columns into a numpy array
4. **Compute UMAP projection** — reduce the 23-dimensional confidence vectors to 2D coordinates
   - Use `umap-learn` library
   - Parameters to start with: `n_neighbors=15, min_dist=0.1, metric='cosine'`
   - Cosine distance is appropriate because we care about the *shape* of the confidence distribution, not the magnitude
5. **Compute confusion/entropy score** for each glitch:
   ```python
   from scipy.stats import entropy
   confusion_score = entropy(confidence_vector)
   ```
   High entropy = model is uncertain = the glitch might be between classes or a new class entirely
6. **Determine observing run** from GPS time:
   - O1: 1126400000–1137250000
   - O2: 1164556817–1187733618
   - O3a: 1238112018–1253977218
   - O3b: 1256655618–1269363618
7. **Construct spectrogram image URLs** — this needs investigation. Options:
   - The dataset may contain `url1`, `url2`, `url3`, `url4` columns pointing to the hosted spectrogram PNGs
   - If not, the Zooniverse subject viewer may host them at predictable URLs based on `gravityspy_id`
   - Fallback: the GWpy/GravitySpy package can fetch them, but we'd want to host them statically
   - **If image URLs are not directly available in the dataset**, the pipeline should document this and the web app should gracefully handle missing images (show metadata only)
8. **Output** a single JSON file (or compressed binary like MessagePack/CBOR if JSON is too large):

```json
{
  "metadata": {
    "total_glitches": 150000,
    "classes": ["1080Lines", "1400Ripples", "Air_Compressor", "Blip", ...],
    "class_colors": { "Blip": "#e41a1c", ... },
    "observing_runs": ["O1", "O2", "O3a", "O3b"]
  },
  "glitches": [
    {
      "id": "Fv3p6eROvA",
      "x": 12.34,
      "y": -5.67,
      "label": "Blip",
      "confidence": 0.97,
      "entropy": 0.12,
      "snr": 15.3,
      "peak_freq": 124.5,
      "gps": 1126500000,
      "run": "O1",
      "ifo": "H1",
      "urls": [
        "https://...spectrogram_0.5.png",
        "https://...spectrogram_1.0.png",
        "https://...spectrogram_2.0.png",
        "https://...spectrogram_4.0.png"
      ]
    }
  ]
}
```

### Performance Considerations

- If total glitches exceed ~200k, consider two tiers:
  - A "full" dataset for filtering/stats
  - A subsampled dataset (~50k) for initial rendering, with progressive loading
- Alternatively, use a binary columnar format (arrays of floats instead of array of objects) for smaller file size and faster parsing

---

## Component 2: Web Application

### Technology Choices

- **Rendering engine**: Must be WebGL-based for 100k+ points. Options:
  - `deck.gl` (ScatterplotLayer) — mature, great for large datasets, React-friendly
  - `regl-scatterplot` — lighter weight, very performant
  - Raw `regl` or Three.js — maximum control, more work
- **Framework**: React (with hooks) or vanilla JS — either works, choose based on complexity
- **UI components**: Tailwind CSS for styling, or minimal custom CSS

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  GRAVITY SPY GLITCH EXPLORER                    [?] [⚙]    │
├────────────┬────────────────────────────────────────────────┤
│            │                                                │
│  FILTERS   │          SCATTER PLOT                          │
│            │          (WebGL, full height)                   │
│  □ Classes │                                                │
│  ◉ H1 ◉L1 │          Each dot = one glitch                 │
│  Run: ──── │          Colored by class                      │
│  SNR: ──── │          Zoom/pan/hover                        │
│  Freq: ─── │                                                │
│  Conf: ─── │                                                │
│            │                                                │
│ [Discovery]│                                                │
│ ☐ Show     │                                                │
│   uncertain│                                                │
│ ☐ Lasso    │                                                │
│   select   │                                                │
│            │                                                │
├────────────┼────────────────────────────────────────────────┤
│  STATS     │  DETAIL PANEL (appears on click)               │
│  Total: N  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐         │
│  Shown: M  │  │ 0.5s │ │ 1.0s │ │ 2.0s │ │ 4.0s │         │
│  Classes:  │  └──────┘ └──────┘ └──────┘ └──────┘         │
│  [chart]   │  ID: Fv3p6eROvA | Blip (97%) | SNR: 15.3     │
│            │  H1 | O1 | 124.5 Hz | Entropy: 0.12           │
└────────────┴────────────────────────────────────────────────┘
```

### Feature Specification

#### 1. Scatter Plot (Core)

- Render all glitches as points on the UMAP 2D projection
- Color each point by its ML-assigned class label
- Point size can be uniform or scaled by SNR (user toggle)
- Zoom: scroll wheel or pinch, with smooth animation
- Pan: click and drag on empty space
- Hover: show tooltip with class, confidence, SNR
- Click: select a glitch, populate the Detail Panel
- Performance target: smooth interaction at 150k points

#### 2. Filter Panel

All filters are AND-combined. When a filter changes, points that don't match should either disappear or become very faint (fading is better UX than removal — preserves spatial context).

- **Class filter**: Checkboxes for all 23 classes, with "Select All" / "Select None." Each checkbox shows the class color swatch and count.
- **Detector**: Toggle H1 / L1 / Both
- **Observing run**: Checkboxes for O1, O2, O3a, O3b
- **SNR range**: Dual-handle slider, log scale (7.5 to ~1000+)
- **Peak frequency range**: Dual-handle slider, log scale (10 Hz to 2048 Hz)
- **ML confidence**: Single slider — "minimum confidence for assigned class." Sliding this down reveals the uncertain glitches. This is the most important discovery knob.
- **Entropy/confusion score**: Slider to highlight high-entropy points

#### 3. Detail Panel

Appears when a glitch is clicked. Shows:

- All 4 spectrogram images side by side (0.5s, 1.0s, 2.0s, 4.0s)
- Metadata: gravityspy_id, ML class, confidence %, SNR, peak frequency, GPS time, detector, observing run, entropy score
- ML confidence breakdown: small horizontal bar chart showing confidence across all 23 classes (makes it instantly clear when the model is torn between two classes)
- "Find similar" button: highlights the N nearest neighbors in the scatter plot
- "Pin for comparison" button: pins this glitch's spectrograms so you can click another and compare side-by-side

#### 4. Discovery Mode

Toggle-able overlay features:

- **"Show uncertain"**: Renders points with entropy above a threshold in a bright highlight color (e.g., bright yellow or red outline) while dimming everything else. This instantly reveals where potential new classes are hiding.
- **Lasso selection**: Draw a freehand region on the scatter plot. All enclosed points are selected. A gallery view appears showing a grid of their spectrograms (thumbnail size, scrollable). If the selection is large (>50), show a random sample with a "load more" button.
- **Nearest-neighbor view**: Click a point, see its K nearest neighbors (in 23D confidence space, not just 2D projection space) displayed as a small gallery.

#### 5. Temporal View

- A timeline slider or play/pause animation along the bottom
- Scrub through GPS time; points outside the current time window fade out
- Watch glitch populations appear and disappear across observing runs
- Optionally: a small histogram above the slider showing glitch count over time, so you can see bursts of activity

#### 6. Stats Sidebar

- Total glitches in dataset
- Currently visible (after filters)
- Class distribution bar chart for the current view
- Detector split (H1 vs L1 pie chart or simple count)

### Color Scheme

Use a categorical color palette with 23 distinguishable colors. Start with a standard qualitative palette (e.g., d3-scale-chromatic `schemeTableau10` extended) and assign colors to classes. The background should be dark (dark gray or near-black) for best contrast with colored points — this matches the aesthetic of the spectrogram images themselves.

### Responsive Design

Should work on desktop (primary target). Tablet is nice-to-have. Mobile is not a target (the scatter plot interaction requires precision pointing).

---

## The 23 Glitch Classes

For reference, these are the known classes in the O3 dataset:

1. 1080Lines
2. 1400Ripples
3. Air_Compressor
4. Blip
5. Chirp
6. Extremely_Loud
7. Fast_Scattering (Crown)
8. Helix
9. Koi_Fish
10. Light_Modulation
11. Low_Frequency_Blip
12. Low_Frequency_Burst
13. Low_Frequency_Lines
14. No_Glitch
15. Paired_Doves
16. Power_Line
17. Repeating_Blips
18. Scattered_Light
19. Scratchy
20. Tomte
21. Violin_Mode
22. Wandering_Line
23. Whistle

New classes discovered by volunteers in O4 include "Photon Calibrator Meadow" and "Vibration" — these won't be in the O1–O3 dataset but the tool should be designed so adding new classes is trivial (just add to the data JSON).

---

## Build Order

### Step 1: Data Exploration

Before writing any pipeline code, download the Zenodo data and explore its actual structure:

```bash
# Download ML classifications
wget https://zenodo.org/records/5649212/files/ML_O1_O2_O3a_O3b.zip  # (or whatever the actual filename is)

# Download volunteer classifications
wget https://zenodo.org/records/5911227/files/retired_fulldata_min2_max50_ret0p9.hdf5
```

Inspect:
- What columns exist?
- Are spectrogram URLs included?
- How many total rows?
- What do the confidence score columns look like?
- What's the value range of SNR and peak_frequency?

This exploration determines everything else.

### Step 2: Data Pipeline

Write a Python script (`pipeline/process_data.py`) that:
1. Loads and merges all CSV files
2. Computes UMAP embeddings
3. Computes entropy scores
4. Assigns observing runs from GPS times
5. Resolves spectrogram URLs
6. Outputs `glitch_data.json` (or `.json.gz`)

Dependencies: `pandas`, `numpy`, `umap-learn`, `scipy`, `requests`

### Step 3: Web App — Scatter Plot

Get the core rendering working:
- Load the JSON
- Render all points with WebGL
- Color by class
- Zoom/pan
- Hover tooltips

This is the skeleton everything else attaches to.

### Step 4: Web App — Filters + Detail Panel

- Add the filter sidebar
- Add click-to-select
- Add the detail panel with spectrograms and metadata

### Step 5: Web App — Discovery Features

- Entropy highlight overlay
- Lasso selection with gallery
- Nearest-neighbor view
- Temporal slider

### Step 6: Polish

- Class legend
- Stats sidebar
- Loading states
- Performance optimization
- README with usage instructions
- Deploy

---

## Key Risks and Mitigations

**Risk: Spectrogram URLs not in the dataset**
The Zenodo CSV may not include direct image URLs. If so:
- Check if the volunteer HDF5 file has URL columns
- Try the Zooniverse subject API: `https://www.zooniverse.org/api/subjects/{zooniverse_subject_id}`
- Check if images are hosted at a predictable CDN path using the `gravityspy_id`
- Worst case fallback: the tool works without images (metadata-only detail panel) and we document how to add image support later

**Risk: Dataset is too large for a single JSON**
If there are millions of glitches, a single JSON won't load in browser:
- Subsample to ~100k–200k (stratified by class to preserve proportions)
- Or use a binary format (Float32Array columns) loaded via fetch + ArrayBuffer
- Or implement level-of-detail: load class centroids first, then load full resolution when zoomed in

**Risk: UMAP computation takes forever**
UMAP on 100k+ points in 23 dimensions should be fast (minutes, not hours). If the dataset is much larger:
- Subsample for UMAP, then project remaining points using the learned transform
- `umap.transform()` can project new points onto an existing embedding

**Risk: Spectrogram images are behind authentication**
Some Gravity Spy data requires LIGO credentials. The Zooniverse-hosted images should be public (they're shown to volunteers). If not:
- Use placeholder/representative images per class
- Document that authenticated users can configure their own image endpoint

---

## Success Criteria

The tool is successful if:

1. A researcher can open it in a browser, see the full O1–O3 glitch landscape, and immediately identify spatial structure (classes form distinct clusters)
2. A volunteer can click on any point and see its spectrograms
3. Someone can slide the confidence threshold down, turn on "show uncertain," see highlighted clusters, lasso-select one, and view a gallery of spectrograms that clearly share a morphology not matching any existing class
4. The Gravity Spy team (Scott Coughlin, Christopher Berry, et al.) looks at it and says "we want to use this for O4/O5 data"

---

## Relevant Links

- Gravity Spy Zooniverse project: https://www.zooniverse.org/projects/zooniverse/gravity-spy
- Gravity Spy blog: https://blog.gravityspy.org/
- GravitySpy GitHub: https://github.com/Gravity-Spy/GravitySpy
- GravitySpy docs: https://gravity-spy.github.io/
- Zenodo ML classifications: https://zenodo.org/records/5649212
- Zenodo volunteer classifications: https://zenodo.org/records/5911227
- Wu et al. 2025 (O4 classifier): https://arxiv.org/abs/2401.12913
- Glanzer et al. 2023 (O1–O3 data quality): https://doi.org/10.1088/1361-6382/acb633
- Zevin et al. 2024 (lessons learned): https://doi.org/10.1140/epjp/s13360-023-04795-4
- Bahaadini et al. 2018 (DIRECT clustering): referenced in ML dataset paper
- AST-LoRA glitch characterization (Jan 2026): https://arxiv.org/abs/2601.20034
- GWpy documentation: https://gwpy.github.io/
- LIGO observing run timeline: https://observing.docs.ligo.org/plan/
