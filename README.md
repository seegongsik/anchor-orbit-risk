# Anchor and Orbit

A workplace risk assessment from one phone photo.

The phone's gravity sensor draws the plumb line. Meta SAM 3.1 outlines the object and what holds it. The app measures how far the object would have to move before it goes over the edge, and how much energy a fall would release. Muse Spark Open drafts the assessment from those measurements: suggested likelihood and severity, controls, and the risk after the controls. The supervisor confirms or changes every grade. Every number in the table comes from a tool call, and a checker rejects any number the model types itself.

Indie-track entry for the Meta Global AI Developer Hackathon (October to November 2026). Operator: Minwoo Kwon (`seegongsik`). License: MIT.

This app supports a supervisor's risk assessment; it does not complete one. The supervisor makes the final judgment. It gives no medical advice and does not identify people.

## The idea: anchor and orbit

A rigid body that starts to move turns, at that instant, about one point (Chasles' theorem for planar motion). For an object near a table edge that point is the edge: the **anchor**. If the object tips, its centre of mass travels on a circle around the anchor: the **orbit**. It falls once the centre of mass crosses the plumb line through the anchor. So the safety margin is one distance, `d`, measured perpendicular to gravity, from the centre of mass to that plumb line.

A photo alone cannot tell which way is down. A phone can: `DeviceMotionEvent.accelerationIncludingGravity` gives gravity at the moment of capture, so `d` is measured against the real vertical even when the phone is tilted. The app shows how wrong `d` would have been if the photo's own vertical were used.

## What it does

1. **Capture** with a live plumb line over the camera preview, and save the gravity vector with the still. A bar under the preview shows the camera's pitch and turns red when the phone is not level with the edge (more than 15°, an assumption), because then the photo is not a side view.
2. **Mark**: tap the object and the table (SAM 3.1 outlines them from the tap), or draw by hand. Tap both ends of a known length (A4 sheet or bank card) and, optionally, the floor below the edge.
3. **Measure**: the centre of mass from the mask (an estimate that assumes uniform density), the anchor from the table mask, `d` with a fixed-seed Monte Carlo (1,000 draws) over mask, edge, gravity and scale errors, the drop height and the impact energy.
4. **Assess**: Muse Spark Open calls the tools, chooses controls, and submits the table; or assess without the agent, with the same tools and fixed text. The tools suggest grades from the measurements. The supervisor confirms or changes each grade in the table, and the risk scores follow.
5. **Fix and re-shoot**: after a control (for example moving the object inward), re-shoot the same hazard. The earlier photo shows faintly over the camera so the second photo is taken from the same spot. The table then shows the margin before and after, and both photos.
6. **Export** in English or Korean: CSV and a printable A4 table with the supervisor's signature line. Each grade says whether it is the tools' suggestion or set by the supervisor.

Ladders: tap the foot and the top; the angle from the ground is compared with the quarter-length rule for leaning ladders.

### Tilt check: does the measurement match reality?

The same geometry predicts the angle at which an object standing on a board tips over: `θc = atan(d / h)`, with `d` the horizontal distance from the centre of mass to the downhill base corner and `h` the height of the centre of mass above it. The ratio needs no scale. To check it, photograph the object from the side with the board level, lay the phone flat on the board, and raise one end slowly. The phone reads the board angle and catches the jolt when the object lands (or you tap "It tipped"). Each run is logged as predicted against measured and can be downloaded for `EVAL.md`. This tests the centre-of-mass estimate and the anchor against a real object; it assumes the object does not slide first.

## How the grades are suggested

The tools never state a probability of an accident or an injury. They suggest grades from what was measured, and say which rule they used.

| Grade | Suggested from | Rule (band edges are assumptions) |
| --- | --- | --- |
| Likelihood (edge) | The lower 5% of the measured margin `d`, so measurement error counts against the object | ≤ 0 → 5, < 1 cm → 4, < 3 cm → 3, < 10 cm → 2, else 1 |
| Likelihood (ladder) | The measured angle against the quarter-length rule | within ±5° → 2, within ±10° → 4, else 5 |
| Severity | The impact energy `m·g·h` | < 1 J → 1, < 10 J → 2, < 100 J → 3, else 4; a sharp edge or point facing down adds one |
| Risk | Likelihood × severity on a 5 × 4 matrix | ≥ 1 low, ≥ 5 medium, ≥ 10 high |

The main control for an edge hazard is a move: how far inward the object must go so that the lower 5% of its margin reaches 10 cm (the default target, an assumption), and the likelihood that margin suggests. How often the spot is touched, who works below it and whether there is room to move the object are for the supervisor to judge; that is why every grade can be changed in the table.

## Models

| Role | Model | Where |
| --- | --- | --- |
| Segmentation from a tap or a noun phrase | `sam-3.1` | Meta Model API, `POST /v1/responses` (image requests are unary; video goes through the Files API and streams) |
| Hazard survey from the photo | `meta-models/muse-spark-open-1026` | Baseten, OpenAI-compatible Chat Completions |
| Assessment agent with tool calls | `meta-models/muse-spark-open-1026` | Baseten |

Muse Wonder is documented as unavailable in South Korea, so it is not used. Muse Voice is speech-to-text only.

## The number checker

The agent never writes a grade, a score or a measurement.

- Likelihood, severity and risk in each row are **references** to tool results (`likelihood_from: "call_1"`). The checker confirms the reference exists, belongs to the same hazard, that the risk rating used exactly those two results, and that the residual risk used the same severity.
- Free text may show a number only through a placeholder such as `{call_5.move_by_m}`; the server fills it in and formats the unit. Any digit typed outside a placeholder sends the table back to the agent with the reason, up to three times.
- The checked table is a draft: the supervisor's changes to grades are recorded next to the tools' suggestions.

## Run locally

```bash
npm install
npm test          # unit tests (physics, tipping, risk, SAM decoding, agent with a scripted fake model)
npm run lint
npm run build
npm run check:api # transpiles the API functions file by file and calls them
npm run dev
```

Open `http://localhost:5173`. `?demo=synthetic` loads a labeled synthetic scene (a phone rolled by 6°); `?demo=assess` also runs the assessment without the agent; `?demo=tilt` shows the tilt-check prediction on the same scene. Phone sensors need HTTPS; on iOS tap **Allow motion sensors** first.

## Secrets

Server side only. The browser never receives them; `/api/status` returns booleans.

| Variable | Use |
| --- | --- |
| `MODEL_API_KEY` (or `META_API_KEY`) | Meta Model API (SAM 3.1) |
| `BASETEN_API_KEY` | Muse Spark Open on Baseten |
| `DAILY_SAM_CALL_CAP`, `DAILY_SPARK_CALL_CAP` | Optional per-instance daily caps (defaults 300 and 400) |

Without keys the app still measures and assesses locally; model features say so instead of inventing results.

## Sources for the numbers

| Quantity | Value | Source |
| --- | --- | --- |
| Standard gravity | 9.80665 m/s² | ISO 80000-3 |
| A4 long side | 297 mm | ISO 216 |
| Bank card long side | 85.6 mm | ISO/IEC 7810 ID-1 |
| Leaning ladder set-up | foot about one quarter of the working length from the support, so cos(angle) = 1/4, about 75.5° | OSHA 29 CFR 1926.1053(b)(5)(i) |
| Risk assessment duty (Korea) | find hazards, judge the risk, take measures, involve workers, keep records | Occupational Safety and Health Act Art. 36; Enforcement Rule Art. 37; MoEL Notice 2023-19 |

Assumptions, always labeled as such in the app and the exports: the band edges for the suggested grades (above), the 10 cm control target, the 0.75 m default drop height, uniform density, mask and edge errors, the ±5° ladder tolerance, the 15° pitch limit for a side view, and the tilt check's jolt threshold (2 m/s²) and look-back (250 ms).

## Open source used

| Package | Role | License |
| --- | --- | --- |
| `@meta-sam/parser` | Decodes SAM 3.1 masks and builds point prompts (server side) | SAM License (`licenses/SAM-LICENSE.txt`) |
| `vite`, `vitest` | Build, dev server, tests | MIT |
| `typescript`, `typescript-eslint`, `eslint`, `@eslint/js`, `globals`, `@types/node` | Types and lint | Apache-2.0 / MIT |

`tests/fixtures/sam-captured-image.json` is one captured SAM 3 response from Meta's public conformance corpus (`meta-models/meta-sam`, SAM License), used to test decoding. All application code was written in this repository during the hackathon (from 2026-10-27 02:00 KST).

## Limits

- The margin and the tipping angle are geometry. They are not the probability of an accident or an injury, and the suggested grades are not a verdict; the supervisor sets them.
- The margin needs a side view: the phone level, at the height of the edge, looking along it. Perspective errors grow away from that view.
- The scale must be at the object's distance from the phone. A 3% depth mismatch is assumed.
- The centre of mass is an estimate that assumes uniform density over the outline. A heavy part on one side moves the real one; the tilt check is how to find out.
- Sliding is not modeled.
- The ladder check reads one angle; it cannot see whether the ladder is secured or on firm footing.
- Serverless call caps are per instance; the provider dashboards are the hard limit.
- Real-phone checks of the plumb line and the tilt meter, and evaluation against ruler measurements and real tilts, are in progress (`PROGRESS.md`, `EVAL.md`).
