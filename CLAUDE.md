# Working notes for coding agents

Anchor and Orbit: a phone-photo risk assessment (likelihood × severity) for the Meta Global AI Developer Hackathon, indie track. Operator: Minwoo Kwon. Read `README.md` for the product, `DECISIONS.md` for why things are the way they are, and the top of `PROGRESS.md` for where work stands.

## Rules

- Contest: all code is new work written in this repository from 2026-10-27 02:00 KST. Do not copy code from other repositories. List every third-party package in the README table.
- Meta models do the AI work: SAM 3.1 (Meta Model API) and Muse Spark Open (`meta-models/muse-spark-open-1026` on Baseten). Muse Wonder is unavailable in South Korea.
- Never invent a number. Measurements come from the photo and the sensor; assumptions are labeled "assumption" in the UI and the exports; unknown facts are written as "확인 필요" in the docs. Synthetic data is labeled SYNTHETIC and used only in tests and the demo button.
- Grades are suggestions from measured geometry and energy; the supervisor sets them. Never present a margin or a Monte Carlo share as the probability of an accident or an injury.
- Keys live only in server environment variables (`MODEL_API_KEY`/`META_API_KEY`, `BASETEN_API_KEY`). Never log, print, commit or send them to the browser.
- Do not call the Meta Model API until Minwoo confirms the hackathon credits show under Billing; calls before that are charged to his card.
- Work on a branch and open a pull request. Never push to `main`. Minwoo merges.
- UI text, README and code comments in English. `PROGRESS.md` and `DECISIONS.md` in Korean.
- No medical advice, no identifying people, no brand names in generated text.

## Commands

`npm test` · `npm run lint` · `npm run build` (runs `tsc --noEmit` first) · `npm run check:api` (per-file transpile of the Vercel functions) · `npm run dev` (`?demo=synthetic`, `?demo=assess`, `?demo=tilt`).

## Map

- `src/physics/` plumb-line geometry (`plumb.ts`), tipping about the base for the tilt check (`tipping.ts`), masks, scale, circle fit, ladder.
- `src/pipeline/` marks → measurement (`measure.ts`), the synthetic scene.
- `src/risk/` suggested grades from the measured margin and energy, the matrix, supervisor grade changes, CSV/printable table.
- `src/assessment/` hazard types, the tool box the agent calls, the number checker, the no-agent path.
- `server/` SAM 3.1 client (`sam.ts`), Baseten client (`spark.ts`), survey, agent loop, routes, budget guard. `api/` holds one Vercel function per route.
- `src/sensors/` gravity mapping, camera pitch, board tilt and tip detection.
- `src/ui/` the phone page (`tilt-meter.ts` is the live board-angle reader).
