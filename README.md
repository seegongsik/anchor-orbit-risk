# Anchor and Orbit

Point your phone at a workspace. The app looks for what can fall, swing, or slip, computes the physics, and fills a risk-assessment line where every number is traceable.

This is the indie-track entry for the Meta Global AI Developer Hackathon. Operator: Minwoo Kwon (`seegongsik`). License: MIT.

This app is an assessment aid. The supervisor makes the final judgment. It is not medical advice and it does not identify people.

## What works in this revision

- Phone-first Vite + TypeScript page (capture, gravity readout, overlay, evidence).
- Pure TypeScript physics: scale, tip-over margin `d`, drop `v`/`E`, ladder angle, circular-arc fit, Monte Carlo (≥1000 draws, fixed seed).
- Device-motion gravity mapping (unit-tested convention; real-phone sign is 확인 필요).
- SAM 3.1 request builder and wire-grammar parser. Official `~` / `!` mask rasters are **not** decoded yet (byte layout 확인 필요).
- Vercel Functions under `/api` that call Meta only when a server key exists. No invented SAM / Muse payloads.
- A **SYNTHETIC** example (`?demo=synthetic`) that runs mask → `d` → uncertainty without claiming to be a camera frame or a SAM result.

## Meta models (intended)

| Role | Model id | Where | Status in this revision |
| --- | --- | --- | --- |
| Segmentation | `sam-3.1` | Meta Model API `POST /v1/responses` | Client + parser written. Live call needs `MODEL_API_KEY`. |
| Scene list (later) | `muse-wonder-1.0` | Meta Model API | Documented unavailable in South Korea. Not called (no key). Fallback after Minwoo: `muse-spark-1.3` on extracted frames. |
| Evaluation agent (later) | `meta-models/muse-spark-open-1026` | Baseten `https://inference.baseten.co/v1` | Name locked (DECISIONS D1). Not called (no `BASETEN_API_KEY`). |
| Voice (optional, later) | `muse-voice-transcribe-1.0` | STT only — “It does not synthesize speech” | High-risk alerts will be text in 5 languages. |

Do not use Contributor model ids until Minwoo says so.

## Run locally

```bash
npm install
npm test
npm run lint
npm run build
npm run dev
```

Open `http://localhost:5173`. Sensors need HTTPS on a real phone (localhost is the usual exception). On iOS, tap **Allow motion sensors** first.

Synthetic pipeline (no camera, no API key):

`http://localhost:5173/?demo=synthetic`

## Secrets

Server-side only. Commit `.env.example`, never a real `.env`.

| Variable | Use |
| --- | --- |
| `MODEL_API_KEY` | Official Meta Model API key |
| `META_API_KEY` | Alias if `MODEL_API_KEY` is unset |
| `BASETEN_API_KEY` | Muse Spark Open on Baseten |

The browser never sees these values. `/api/status` returns booleans only.

## Open source used

| Package | Role | License (npm field; verify on upgrade) |
| --- | --- | --- |
| `vite` | Dev server and web build | MIT |
| `vitest` | Unit tests | MIT |
| `typescript` | Typecheck | Apache-2.0 |
| `eslint` | Lint | MIT |
| `@eslint/js` | ESLint recommended | MIT |
| `typescript-eslint` | TypeScript lint | MIT |
| `globals` | Lint globals | MIT |
| `@types/node` | Node types | MIT |

No application runtime dependencies. No code was copied from other repositories, including official sample repos. SAM grammar follows the published Meta docs; mask raster decode of live encodings is not implemented.

`@meta-sam/parser` is **not** in the tree yet (optional per Meta docs). Add it only after Minwoo agrees and a live SAM call exists.

## Limits and 확인 필요

- Official Rules (demo length, public-repo requirement, new-work clock, prohibited entries, bonus prizes): not readable without login.
- Muse Wonder availability in South Korea: documented as unavailable. Live `muse-wonder-1.0` error text: not recorded (no key).
- SAM video tracking, official mask byte layout, Baseten `json_schema` / tools: 확인 필요.
- Gravity sign and screen-angle mapping on a real iOS/Android device: 확인 필요.
- Vercel Function body limit is 4.5 MB (Vercel docs). Large stills should go to storage and be sent as URL / `file_id`.
- Meta Model API credits ($150) and Baseten credits ($100): how to claim, card required — 확인 필요.
- Prices cited in working notes are from 2026-10-26 docs; re-check before any cost claim.

## Threshold sources

| Quantity | Value | Source |
| --- | --- | --- |
| Standard gravity `g` | 9.80665 m/s² | ISO 80000-3 / CGPM standard gravity |
| A4 long side | 0.297 m | ISO 216 |
| Credit-card long side | 0.0856 m | ISO/IEC 7810 ID-1 |
| Default drop height | 0.75 m | Product brief; **assumption**, not a measured desk |
| Ladder 4:1 (≈75° from horizontal) | rise 4 / run 1 | Product brief comparison. Workplace-rule citation: **확인 필요** |
| Likelihood / severity bands | configurable | Band edges: **확인 필요** — labeled assumption until a source is found |
| Monte Carlo | 1000 draws, seed `20261027` | Product brief (≥1000, fixed seed) |

Do not invent a citation. If a number has no source, the UI and exports must say `assumption`.

## Contest notes (conservative)

Work in this repository starts after 2026-10-27 02:00 KST. Target submit 2026-11-04 22:00 KST. Deadline quoted in the brief: 2026-11-05 11:00 KST. Submission, signup, and payment are Minwoo’s, not the agent’s. Merges to `main` are Minwoo’s.
