# Anchor and Orbit

A workplace risk assessment from one phone photo.

The phone's gravity sensor draws the plumb line. Meta SAM 3.1 outlines the object and what holds it. Muse Spark Open writes the assessment: likelihood × severity, controls, and the risk after the controls. Every number in the table comes from a tool call, and a checker rejects any number the model types itself.

Indie-track entry for the Meta Global AI Developer Hackathon (October to November 2026). Operator: Minwoo Kwon (`seegongsik`). License: MIT.

This app is an assessment aid. The supervisor makes the final judgment. It gives no medical advice and does not identify people.

## The idea: anchor and orbit

A rigid body that starts to move turns, at that instant, about one point (Chasles' theorem for planar motion). For an object near a table edge that point is the edge: the **anchor**. If the object tips, its centre of mass travels on a circle around the anchor: the **orbit**. It falls once the centre of mass crosses the plumb line through the anchor. So the safety margin is one distance, `d`, measured perpendicular to gravity, from the centre of mass to that plumb line.

A photo alone cannot tell which way is down. A phone can: `DeviceMotionEvent.accelerationIncludingGravity` gives gravity at the moment of capture, so `d` is measured against the real vertical even when the phone is tilted. The app shows how wrong `d` would have been if the photo's own vertical were used.

## What it does

1. **Capture** with a live plumb line over the camera preview, and save the gravity vector with the still.
2. **Mark**: tap the object and the table (SAM 3.1 outlines them from the tap), or draw by hand. Tap both ends of a known length (A4 sheet or bank card) and, optionally, the floor below the edge.
3. **Measure**: centre of mass from the mask, the anchor from the table mask, `d` with a fixed-seed Monte Carlo (1,000 draws) over mask, edge, gravity and scale errors, the drop height and the impact energy.
4. **Assess**: Muse Spark Open calls the physics tools, chooses controls, and submits the table. Or assess without the agent, with the same tools and fixed text.
5. **Export** in English or Korean: CSV and a printable A4 table with the supervisor's signature line.

Ladders: tap the foot and the top; the angle from the ground is compared with the 4:1 rule.

## Models

| Role | Model | Where |
| --- | --- | --- |
| Segmentation from a tap or a noun phrase | `sam-3.1` | Meta Model API, `POST /v1/responses` (image requests are unary; video goes through the Files API and streams) |
| Hazard survey from the photo | `meta-models/muse-spark-open-1026` | Baseten, OpenAI-compatible Chat Completions |
| Assessment agent with tool calls | `meta-models/muse-spark-open-1026` | Baseten |

Muse Wonder is documented as unavailable in South Korea, so it is not used. Muse Voice is speech-to-text only.

## The number checker

The agent never writes a grade, a score or a measurement.

- Likelihood, severity and risk in each row are **references** to tool results (`likelihood_from: "call_2"`). The checker confirms the reference exists, belongs to the same hazard, and that the risk rating used exactly those two results.
- Free text may show a number only through a placeholder such as `{call_6.move_by_m}`; the server fills it in and formats the unit. Any digit typed outside a placeholder sends the table back to the agent with the reason, up to three times.

## Run locally

```bash
npm install
npm test          # unit tests (physics, risk, SAM decoding, agent with a scripted fake model)
npm run lint
npm run build
npm run check:api # transpiles the API functions file by file and calls them
npm run dev
```

Open `http://localhost:5173`. `?demo=synthetic` loads a labeled synthetic scene (a phone rolled by 6°); `?demo=assess` also runs the assessment without the agent. Phone sensors need HTTPS; on iOS tap **Allow motion sensors** first.

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
| Ladder set-up | base about 1/4 of the working length (4:1, 75.96°) | OSHA 29 CFR 1926.1053(b)(5)(i) |
| Severity reference: helmet crown impact | 49 J (5 kg striker) | EN 397, via DGUV IFA project BIA 1045 |
| Severity reference: safety toe cap impact | 200 J | EN ISO 20345 |
| Risk assessment duty (Korea) | employer duty, records kept | Occupational Safety and Health Act Art. 36; Enforcement Rule Art. 37; MoEL Notice 2023-19 |

Assumptions, always labeled as such in the app and the exports: the band edges for likelihood and severity, the nudging presets (rarely touched 0.5/day of 3 mm, everyday desk 2/day of 3 mm, busy bench 10/day of 5 mm), the 0.75 m default drop height, uniform density, mask and edge errors, the ±5° ladder tolerance.

## Open source used

| Package | Role | License |
| --- | --- | --- |
| `@meta-sam/parser` | Decodes SAM 3.1 masks and builds point prompts (server side) | SAM License (`licenses/SAM-LICENSE.txt`) |
| `vite`, `vitest` | Build, dev server, tests | MIT |
| `typescript`, `typescript-eslint`, `eslint`, `@eslint/js`, `globals`, `@types/node` | Types and lint | Apache-2.0 / MIT |

`tests/fixtures/sam-captured-image.json` is one captured SAM 3 response from Meta's public conformance corpus (`meta-models/meta-sam`, SAM License), used to test decoding. All application code was written in this repository during the hackathon (from 2026-10-27 02:00 KST).

## Limits

- The margin needs a side view: the phone at the height of the edge, looking along it. Perspective errors grow away from that view.
- The scale must be at the object's distance from the phone. A 3% depth mismatch is assumed.
- The centre of mass assumes uniform density over the outline.
- Serverless call caps are per instance; the provider dashboards are the hard limit.
- Real-phone checks of the plumb line, and evaluation against ruler measurements, are in progress (`PROGRESS.md`).
