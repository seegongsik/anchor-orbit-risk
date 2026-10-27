import { localAssessment } from "../assessment/local.js";
import type { Hazard, LadderMeasurement, MaskSource } from "../assessment/types.js";
import { A4_LONG_SIDE_M, CREDIT_CARD_LONG_SIDE_M } from "../physics/constants.js";
import type { Vec2 } from "../physics/geometry.js";
import { maskFromRuns, polygonMask, type BinaryMask } from "../physics/mask.js";
import { imageTiltDeg, plumbFromDown } from "../physics/plumb.js";
import type { BaseSide, TipPrediction } from "../physics/tipping.js";
import { measureEdge, measureLadder, measureTip, scaleFromTaps, type EdgeResult, type Scale } from "../pipeline/measure.js";
import { drawSyntheticScene, polygonsMask, syntheticScene } from "../pipeline/synthetic-scene.js";
import { ladderReferenceDeg } from "../risk/assess.js";
import { DISCLAIMER, LEGAL_CONTEXT, SIDE_VIEW_MAX_PITCH_DEG, type Lang } from "../risk/config.js";
import { formatField, formatLength, formatPercent } from "../risk/format.js";
import { setGrade, type AssessmentTable, type GradeSlot } from "../risk/table.js";
import { requestMotionPermission } from "../sensors/gravity.js";
import {
  ApiError,
  assess,
  getStatus,
  samAtPoint,
  samConcept,
  sparkCheck,
  survey,
  type ApiStatus,
  type SamMaskOut,
  type TraceLine,
} from "./api.js";
import { drawLiveOverlay, GravityReader, startCamera, stillFromSource, type Still } from "./camera.js";
import { canvasPoint, drawStill } from "./draw.js";
import { downloadCsv, downloadText, openPrintable, renderTable, type BeforeAfter } from "./table-view.js";
import { TiltMeter } from "./tilt-meter.js";

type Kind = "edge" | "ladder" | "tilt";
type Tool = "object" | "table" | "edge" | "scale" | "floor" | "foot" | "top";

const TOOLS: Record<Kind, { id: Tool; label: string }[]> = {
  edge: [
    { id: "object", label: "Object" },
    { id: "table", label: "Table" },
    { id: "edge", label: "Edge" },
    { id: "scale", label: "Known length" },
    { id: "floor", label: "Floor" },
  ],
  ladder: [
    { id: "foot", label: "Foot" },
    { id: "top", label: "Top" },
    { id: "scale", label: "Known length" },
  ],
  tilt: [{ id: "object", label: "Object" }],
};

const HINTS: Record<Tool, { sam: string; manual: string }> = {
  object: {
    sam: "Tap the object that could fall. SAM 3.1 outlines it.",
    manual: "Tap the object's outline corner by corner, then Close shape.",
  },
  table: {
    sam: "Tap the table or shelf it rests on. SAM 3.1 outlines it and finds the edge.",
    manual: "Tap anywhere on the table top, then use Edge.",
  },
  edge: {
    sam: "Optional: tap the edge corner to override the one found.",
    manual: "Tap the corner of the edge the object would go over.",
  },
  scale: {
    sam: "Tap both ends of the known length (at the object's distance from the phone).",
    manual: "Tap both ends of the known length (at the object's distance from the phone).",
  },
  floor: {
    sam: "Optional: tap the floor right below the edge to measure the drop height.",
    manual: "Optional: tap the floor right below the edge.",
  },
  foot: { sam: "Tap where the ladder touches the floor.", manual: "Tap where the ladder touches the floor." },
  top: { sam: "Tap where the ladder rests against the wall.", manual: "Tap where the ladder rests against the wall." },
};

type ObjectMark = { mask: BinaryMask; source: MaskSource };

type Marks = {
  object?: ObjectMark;
  support?: ObjectMark;
  polygonDraft: Vec2[];
  scaleTaps: Vec2[];
  floorPoint?: Vec2;
  manualEdge?: Vec2;
  manualSupportPoint?: Vec2;
  ladder: Vec2[];
};

function emptyMarks(): Marks {
  return { polygonDraft: [], scaleTaps: [], ladder: [] };
}

function must<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  return el as T;
}

function pickMask(masks: SamMaskOut[], prefer: "confidence" | "area"): SamMaskOut | null {
  if (masks.length === 0) return null;
  const sorted = [...masks].sort((a, b) =>
    prefer === "confidence"
      ? (b.confidence ?? 0) - (a.confidence ?? 0) || b.pixelCount - a.pixelCount
      : b.pixelCount - a.pixelCount,
  );
  return sorted[0];
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `
    <header>
      <p class="kicker">Meta Global AI Developer Hackathon · Indie</p>
      <h1>Anchor &amp; Orbit</h1>
      <p class="lede">A risk assessment from one phone photo. The phone's gravity sensor draws the plumb line, Meta SAM 3.1 finds the object and what holds it, and Muse Spark Open writes likelihood × severity. Every number in the table comes from a tool.</p>
    </header>
    <aside class="disclaimer">${DISCLAIMER.en}</aside>
    <div class="status" id="status"></div>

    <section>
      <h2><span>1</span> Capture</h2>
      <div class="row">
        <button id="btn-motion" type="button">Allow motion sensors</button>
        <button id="btn-camera" type="button">Start camera</button>
      </div>
      <p class="hint hidden" id="ghost-note"></p>
      <div class="stage live hidden" id="live-stage">
        <video id="live" autoplay playsinline muted></video>
        <img class="ghost hidden" id="ghost" alt="" />
        <canvas class="overlay" id="live-overlay"></canvas>
      </div>
      <div class="row">
        <button id="btn-capture" type="button" class="primary" disabled>Capture with gravity</button>
      </div>
      <div class="row">
        <label class="filebtn" for="file">Upload a photo</label>
        <input id="file" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" />
        <button id="btn-synthetic" type="button">Synthetic example</button>
      </div>
      <p class="tiny">Hold the phone upright (portrait) and level, at the height of the edge, and look along the edge so it is seen end-on. The bar at the bottom of the preview turns green when the camera is level within ${SIDE_VIEW_MAX_PITCH_DEG}° (an assumption). Put an A4 sheet or a card at the same distance for scale. An uploaded photo has no gravity reading: its vertical is assumed.</p>
    </section>

    <section id="s-mark" class="hidden">
      <h2><span>2</span> Mark</h2>
      <div class="seg" id="kinds">
        <button type="button" data-kind="edge" class="on">Near an edge</button>
        <button type="button" data-kind="ladder">Leaning ladder</button>
        <button type="button" data-kind="tilt">Tilt check</button>
      </div>
      <div class="seg tools" id="tools"></div>
      <p class="hint" id="hint"></p>
      <div class="stage"><canvas id="still"></canvas></div>
      <div class="row">
        <button id="btn-undo" type="button">Undo</button>
        <button id="btn-close" type="button" class="hidden">Close shape</button>
        <button id="btn-survey" type="button">Find hazards</button>
      </div>
      <div id="survey"></div>
      <div class="grid2" id="scale-grid">
        <div>
          <label for="scale-preset">Known length</label>
          <select id="scale-preset">
            <option value="a4">A4 long side, 297 mm (ISO 216)</option>
            <option value="card">Bank card, 85.6 mm (ISO/IEC 7810 ID-1)</option>
            <option value="custom">Custom (mm)</option>
          </select>
        </div>
        <div>
          <label for="scale-custom">Custom length (mm)</label>
          <input id="scale-custom" type="number" min="5" step="1" value="300" />
        </div>
      </div>
      <div class="metrics" id="metrics"></div>
      <details><summary>How it was measured</summary><ul id="notes" class="notes"></ul></details>

      <div id="tilt-panel" class="hidden">
        <h3 class="sub">Check the prediction on the real object</h3>
        <p class="tiny">Stand the object on a board and photograph it from the side with the board level. Then lay the phone flat on the board next to it, tap Start, and raise one end of the board slowly until the object tips. A rubber mat stops it sliding first. Use something unbreakable, over a soft surface.</p>
        <div class="seg" id="tilt-side">
          <button type="button" data-side="auto" class="on">Easier side</button>
          <button type="button" data-side="min">Tips to the left</button>
          <button type="button" data-side="max">Tips to the right</button>
        </div>
        <div class="tilt-readout"><b id="tilt-now">–</b><span id="tilt-pred"></span></div>
        <div class="row">
          <button id="btn-tilt-start" type="button" class="primary" disabled>Start tilt meter</button>
          <button id="btn-tilt-tipped" type="button" disabled>It tipped</button>
        </div>
        <ol class="trace" id="tilt-log"></ol>
        <div class="row"><button id="btn-tilt-save" type="button" disabled>Download tilt results</button></div>
      </div>

      <div id="describe">
      <h3 class="sub">Describe it</h3>
      <div class="grid2">
        <div><label for="f-object">Object</label><input id="f-object" type="text" value="object" /></div>
        <div><label for="f-support">Rests on</label><input id="f-support" type="text" value="desk" /></div>
        <div><label for="f-mass-low">Mass from (kg)</label><input id="f-mass-low" type="number" min="0" step="0.01" /></div>
        <div><label for="f-mass-high">to (kg)</label><input id="f-mass-high" type="number" min="0" step="0.01" /></div>
      </div>
      <label class="check"><input id="f-sharp" type="checkbox" /> A blade, point or sharp corner would lead if it fell</label>
      <p class="tiny" id="mass-note"></p>
      <div class="row">
        <select id="f-target"></select>
        <button id="btn-add" type="button" class="primary" disabled>Add to assessment</button>
      </div>
      </div>
      <div class="row"><button id="btn-save" type="button">Save capture for evaluation</button></div>
    </section>

    <section id="s-assess" class="hidden">
      <h2><span>3</span> Assess</h2>
      <div id="hazards"></div>
      <label for="place">Place</label>
      <input id="place" type="text" placeholder="for example: 2F office, shared desk" />
      <p class="tiny">The tools suggest each grade from the measured margin and the impact energy. Check every grade in the table and change it where you know better, for example how often the spot is touched or who works below it.</p>
      <div class="row">
        <button id="btn-agent" type="button" class="primary">Assess with Muse Spark Open</button>
        <button id="btn-local" type="button">Assess without the agent</button>
      </div>
      <ol class="trace" id="trace"></ol>
      <div class="seg" id="langs">
        <button type="button" data-lang="en" class="on">English</button>
        <button type="button" data-lang="ko">한국어</button>
      </div>
      <div id="table"></div>
      <div class="row hidden" id="exports">
        <button id="btn-csv" type="button">Download CSV</button>
        <button id="btn-print" type="button">Printable table</button>
      </div>
    </section>

    <footer>
      <p>${LEGAL_CONTEXT.en}</p>
      <p>Models: Meta SAM 3.1 (Meta Model API) for segmentation · Muse Spark Open, open weights served by Baseten, for the hazard survey and the assessment agent.</p>
      <div class="row"><button id="btn-check" type="button">Check model connection</button></div>
      <p class="tiny" id="check-out"></p>
    </footer>
  `;

  const $ = <T extends HTMLElement = HTMLElement>(s: string) => must<T>(root, s);
  const statusEl = $("#status");
  const live = $<HTMLVideoElement>("#live");
  const liveStage = $("#live-stage");
  const liveOverlay = $<HTMLCanvasElement>("#live-overlay");
  const btnCapture = $<HTMLButtonElement>("#btn-capture");
  const stillCanvas = $<HTMLCanvasElement>("#still");
  const toolsEl = $("#tools");
  const hint = $("#hint");
  const metricsEl = $("#metrics");
  const notesEl = $("#notes");
  const surveyEl = $("#survey");
  const btnClose = $<HTMLButtonElement>("#btn-close");
  const btnSurvey = $<HTMLButtonElement>("#btn-survey");
  const btnAdd = $<HTMLButtonElement>("#btn-add");
  const btnAgent = $<HTMLButtonElement>("#btn-agent");
  const btnLocal = $<HTMLButtonElement>("#btn-local");
  const target = $<HTMLSelectElement>("#f-target");
  const scalePreset = $<HTMLSelectElement>("#scale-preset");
  const scaleCustom = $<HTMLInputElement>("#scale-custom");
  const fObject = $<HTMLInputElement>("#f-object");
  const fSupport = $<HTMLInputElement>("#f-support");
  const fMassLow = $<HTMLInputElement>("#f-mass-low");
  const fMassHigh = $<HTMLInputElement>("#f-mass-high");
  const fSharp = $<HTMLInputElement>("#f-sharp");
  const massNote = $("#mass-note");
  const hazardsEl = $("#hazards");
  const traceEl = $("#trace");
  const tableEl = $("#table");
  const exportsEl = $("#exports");
  const sMark = $("#s-mark");
  const sAssess = $("#s-assess");
  const placeInput = $<HTMLInputElement>("#place");
  const ghost = $<HTMLImageElement>("#ghost");
  const ghostNote = $("#ghost-note");
  const describeEl = $("#describe");
  const scaleGrid = $("#scale-grid");
  const tiltPanel = $("#tilt-panel");
  const tiltNow = $("#tilt-now");
  const tiltPred = $("#tilt-pred");
  const tiltLogEl = $("#tilt-log");
  const btnTiltStart = $<HTMLButtonElement>("#btn-tilt-start");
  const btnTiltTipped = $<HTMLButtonElement>("#btn-tilt-tipped");
  const btnTiltSave = $<HTMLButtonElement>("#btn-tilt-save");

  let api: ApiStatus | null = null;
  const gravity = new GravityReader();
  gravity.start();
  let stream: MediaStream | null = null;
  let still: Still | null = null;
  let kind: Kind = "edge";
  let tool: Tool = "object";
  let marks = emptyMarks();
  let edgeResult: EdgeResult | null = null;
  let ladderResult: LadderMeasurement | null = null;
  let hazards: Hazard[] = [];
  let surveyed: Hazard | null = null;
  let massSource: "model estimate" | "user" = "user";
  let table: AssessmentTable | null = null;
  let previous: AssessmentTable | null = null;
  let lang: Lang = "en";
  let busy = false;
  let synthetic = false;
  /** The photo each hazard was last measured on, for re-shooting and before/after. */
  const captures = new Map<string, { dataUrl: string; capturedAt: string }>();
  const photos = new Map<string, BeforeAfter>();
  let tipResult: TipPrediction | null = null;
  let tiltSide: BaseSide | "auto" = "auto";
  let meter: TiltMeter | null = null;
  type TiltRecord = {
    object: string;
    side: BaseSide;
    predictedDeg: number;
    p5Deg: number;
    p95Deg: number;
    measuredDeg: number;
    differenceDeg: number;
    how: "jolt" | "button";
    photoCapturedAt: string;
    gravitySource: string;
    maskSource: string;
  };
  const tiltLog: TiltRecord[] = [];

  const samReady = () => api?.modelApiKeyConfigured === true && !synthetic;
  const sparkReady = () => api?.basetenApiKeyConfigured === true;

  function renderStatus(): void {
    const chip = (on: boolean, text: string) => `<span class="chip ${on ? "on" : "off"}">${text}</span>`;
    statusEl.innerHTML =
      chip(api?.modelApiKeyConfigured === true, `SAM 3.1 ${api?.modelApiKeyConfigured ? "ready" : "no key"}`) +
      chip(sparkReady(), `Muse Spark Open ${sparkReady() ? "ready" : "no key"}`) +
      chip(gravity.hasSignal(), `Gravity ${gravity.hasSignal() ? "live" : "waiting"}`);
    btnSurvey.disabled = !sparkReady() || !still || busy;
    btnAgent.disabled = !sparkReady() || hazards.length === 0 || busy;
    btnLocal.disabled = hazards.length === 0 || busy;
  }

  function setHint(text: string, tone: "info" | "warn" = "info"): void {
    hint.textContent = text;
    hint.className = `hint ${tone}`;
  }

  function renderTools(): void {
    toolsEl.innerHTML = TOOLS[kind]
      .map((t) => `<button type="button" data-tool="${t.id}" class="${t.id === tool ? "on" : ""}">${t.label}</button>`)
      .join("");
    const manual = !samReady() || (tool === "object" && marks.polygonDraft.length > 0);
    if (kind === "tilt" && tool === "object") {
      setHint(manual ? "Tap the standing object's outline corner by corner, then Close shape." : "Tap the object standing on the board. SAM 3.1 outlines it.");
    } else {
      setHint(HINTS[tool][manual ? "manual" : "sam"]);
    }
    describeEl.classList.toggle("hidden", kind === "tilt");
    scaleGrid.classList.toggle("hidden", kind === "tilt");
    btnSurvey.classList.toggle("hidden", kind === "tilt");
    tiltPanel.classList.toggle("hidden", kind !== "tilt");
    btnClose.classList.toggle("hidden", !(tool === "object" && marks.polygonDraft.length > 0));
  }

  function knownLength(): { metres: number; label: string } | null {
    const preset = scalePreset.value;
    if (preset === "card") return { metres: CREDIT_CARD_LONG_SIDE_M, label: "bank card 85.6 mm" };
    if (preset === "custom") {
      const mm = Number(scaleCustom.value);
      return mm > 0 ? { metres: mm / 1000, label: `custom ${Math.round(mm)} mm` } : null;
    }
    return { metres: A4_LONG_SIDE_M, label: "A4 297 mm" };
  }

  function scale(): Scale | null {
    const known = knownLength();
    if (marks.scaleTaps.length !== 2 || !known) return null;
    return scaleFromTaps(marks.scaleTaps[0], marks.scaleTaps[1], known.metres, known.label);
  }

  function metric(k: string, v: string, bad = false): string {
    return `<div class="metric${bad ? " bad" : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  }

  function tipGeometry(p: TipPrediction): EdgeResult["geometry"] {
    const g = p.geometry;
    const other = p.sides[g.side === "min" ? "max" : "min"].corner;
    return {
      com: g.com,
      edge: g.corner,
      supportPoint: other,
      plumb: still?.plumb ?? plumbFromDown({ x: 0, y: 1 }),
      supportSide: g.side === "max" ? -1 : 1,
      comHeightAboveEdgePx: g.hPx,
      dPx: g.dPx,
    };
  }

  function recompute(): void {
    edgeResult = null;
    ladderResult = null;
    tipResult = null;
    notesEl.innerHTML = "";
    let message = "";
    if (still) {
      try {
        const s: Scale | null = scale();
        if (kind === "edge") {
          if (!marks.object) throw new Error("Mark the object.");
          if (!marks.support && !(marks.manualEdge && marks.manualSupportPoint)) {
            throw new Error(marks.manualEdge ? "Tap a point on the table (Table)." : "Mark the table, or tap its edge.");
          }
          if (!s) throw new Error("Mark a known length with two taps.");
          edgeResult = measureEdge({
            imageWidth: still.width,
            imageHeight: still.height,
            plumb: still.plumb,
            gravitySource: still.gravitySource,
            gravityNoiseRad: still.gravityNoiseRad,
            object: marks.object.mask,
            objectSource: marks.object.source,
            support: marks.support?.mask,
            supportSource: marks.support?.source,
            manualEdge: marks.manualEdge,
            manualSupportPoint: marks.manualSupportPoint,
            scale: s,
            floorPoint: marks.floorPoint,
            cameraPitchDeg: still.pitchDeg,
          });
          notesEl.innerHTML = [...edgeResult.notes, `Scale: ${s.source}.`].map((n) => `<li>${escapeText(n)}</li>`).join("");
        } else if (kind === "tilt") {
          if (!marks.object) throw new Error("Mark the object standing on the board.");
          const out = measureTip({
            object: marks.object.mask,
            objectSource: marks.object.source,
            plumb: still.plumb,
            gravitySource: still.gravitySource,
            gravityNoiseRad: still.gravityNoiseRad,
            side: tiltSide,
          });
          tipResult = out.prediction;
          notesEl.innerHTML = out.notes.map((n) => `<li>${escapeText(n)}</li>`).join("");
        } else {
          if (marks.ladder.length < 2) throw new Error("Tap the ladder's foot, then its top.");
          ladderResult = measureLadder({
            foot: marks.ladder[0],
            top: marks.ladder[1],
            plumb: still.plumb,
            gravitySource: still.gravitySource,
            gravityNoiseRad: still.gravityNoiseRad,
            scale: s ?? undefined,
            maskSource: "manual",
            cameraPitchDeg: still.pitchDeg,
          });
        }
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      // The tilt check needs only the object: no table, scale or floor.
      const tilting = kind === "tilt";
      drawStill(stillCanvas, still.canvas, {
        object: marks.object?.mask,
        support: tilting ? undefined : marks.support?.mask,
        polygonDraft: marks.polygonDraft,
        scaleTaps: tilting ? [] : marks.scaleTaps,
        scaleLabel: knownLength()?.label ?? "",
        floorPoint: tilting ? undefined : marks.floorPoint,
        manualEdge: marks.manualEdge,
        manualSupportPoint: marks.manualSupportPoint,
        ladder: marks.ladder,
        geometry: edgeResult?.geometry ?? (tipResult ? tipGeometry(tipResult) : undefined),
        dM: edgeResult?.measurement.dM,
        marginLabel: tipResult ? `tips at ${tipResult.geometry.angleDeg.toFixed(1)}°` : undefined,
        plumb: still.plumb,
        label: `${still.origin === "synthetic" ? "SYNTHETIC · " : ""}gravity: ${still.gravitySource}`,
      });
    }
    const pitchMetric = () =>
      still?.pitchDeg === null || still?.pitchDeg === undefined
        ? metric("Camera pitch", "no sensor")
        : metric("Camera pitch", `${Math.abs(still.pitchDeg).toFixed(1)}°`, Math.abs(still.pitchDeg) > SIDE_VIEW_MAX_PITCH_DEG);
    if (edgeResult) {
      const m = edgeResult.measurement;
      metricsEl.innerHTML =
        metric("Margin d", `${formatLength(m.dM)} ± ${formatLength(m.dStdM)}`, m.dM <= 0) +
        metric("Margin, lower 5%", formatLength(m.dP5M), m.dP5M <= 0) +
        metric("Draws past the line", formatPercent(m.pUnstableNow), m.pUnstableNow >= 0.05) +
        metric("Phone tilt corrected", `${Math.abs(m.gravityTiltDeg).toFixed(1)}°`) +
        metric("Error if gravity ignored", formatLength(Math.abs(m.shiftWithoutGravityM))) +
        metric("Centre above edge", formatLength(m.comHeightAboveEdgeM)) +
        metric("Drop height", m.dropHeightM === null ? "not marked" : formatLength(m.dropHeightM)) +
        pitchMetric();
    } else if (ladderResult) {
      metricsEl.innerHTML =
        metric("Angle from ground", `${ladderResult.angleFromGroundDeg.toFixed(1)}° ± ${ladderResult.angleStdDeg.toFixed(1)}°`) +
        metric("4:1 rule", `${ladderReferenceDeg().toFixed(1)}°`) +
        metric("Phone tilt corrected", `${Math.abs(ladderResult.gravityTiltDeg).toFixed(1)}°`) +
        metric("Top height", ladderResult.topHeightM === null ? "mark a length" : formatLength(ladderResult.topHeightM)) +
        pitchMetric();
    } else if (tipResult && still) {
      const other = tipResult.sides[tipResult.side === "min" ? "max" : "min"];
      metricsEl.innerHTML =
        metric("Predicted tipping angle", `${tipResult.geometry.angleDeg.toFixed(1)}°`, tipResult.geometry.angleDeg <= 0) +
        metric("Range (5–95%)", `${tipResult.p5Deg.toFixed(1)}–${tipResult.p95Deg.toFixed(1)}°`) +
        metric("Other side", `${other.angleDeg.toFixed(1)}°`) +
        metric("Phone tilt corrected", `${Math.abs(imageTiltDeg(still.plumb)).toFixed(1)}°`) +
        pitchMetric();
    } else {
      metricsEl.innerHTML = "";
    }
    tiltPred.textContent = tipResult
      ? ` predicted ${tipResult.geometry.angleDeg.toFixed(1)}° (${tipResult.p5Deg.toFixed(1)}–${tipResult.p95Deg.toFixed(1)}°)`
      : "";
    btnTiltStart.disabled = !tipResult || meter !== null;
    if (message && still) setHint(message, "warn");
    else renderTools();
    updateAddButton();
  }

  function updateAddButton(): void {
    const measured = kind === "edge" ? edgeResult !== null : ladderResult !== null;
    const low = Number(fMassLow.value);
    const high = Number(fMassHigh.value);
    const massOk = kind === "ladder" || (fMassLow.value !== "" && fMassHigh.value !== "" && low >= 0 && high >= low);
    btnAdd.disabled = !measured || !massOk || busy;
    massNote.textContent =
      kind === "ladder"
        ? "A person on the ladder is assumed to weigh 60–100 kg (assumption)."
        : massSource === "model estimate"
          ? "Mass is Muse Spark Open's estimate from the photo. Change it if you know the real mass."
          : "Enter the mass you know, or use Find hazards for a model estimate.";
    const keep = target.value;
    target.innerHTML = [`<option value="new">Add as a new hazard</option>`]
      .concat(hazards.map((h) => `<option value="${h.id}">Replace ${h.id} (${escapeText(h.object)}): before / after</option>`))
      .join("");
    if ([...target.options].some((o) => o.value === keep)) target.value = keep;
  }

  function renderHazards(): void {
    sAssess.classList.toggle("hidden", hazards.length === 0);
    hazardsEl.innerHTML = hazards
      .map((h) => {
        const m = h.measurement;
        const fact =
          m?.type === "edge"
            ? `d ${formatLength(m.dM)} ± ${formatLength(m.dStdM)}`
            : m?.type === "ladder"
              ? `${m.angleFromGroundDeg.toFixed(1)}°`
              : "not measured";
        const change =
          m?.type === "edge" && h.before ? ` (was ${formatLength(h.before.dP5M)} at lower 5%, now ${formatLength(m.dP5M)})` : "";
        const reshoot =
          m?.type === "edge" && captures.has(h.id)
            ? `<button type="button" data-reshoot="${h.id}">Re-shoot after a fix</button>`
            : "";
        return `<div class="hz"><span><b>${h.id}</b> ${escapeText(h.object)}${h.support ? ` on ${escapeText(h.support)}` : ""} · ${fact}${change}</span>${reshoot}<button type="button" data-remove="${h.id}" aria-label="Remove ${h.id}">×</button></div>`;
      })
      .join("");
    renderStatus();
    updateAddButton();
  }

  function setStill(next: Still, isSynthetic = false): void {
    still = next;
    synthetic = isSynthetic;
    marks = emptyMarks();
    surveyed = null;
    surveyEl.innerHTML = "";
    sMark.classList.remove("hidden");
    tool = kind === "ladder" ? "foot" : "object";
    renderTools();
    recompute();
    renderStatus();
  }

  function loadSynthetic(): void {
    const scene = syntheticScene();
    const canvas = document.createElement("canvas");
    drawSyntheticScene(canvas, scene);
    kind = "edge";
    root.querySelectorAll<HTMLButtonElement>("#kinds button").forEach((x) => x.classList.toggle("on", x.dataset.kind === "edge"));
    setStill(
      stillFromSource(
        canvas,
        scene.width,
        scene.height,
        { plumb: scene.plumb, source: "synthetic", noiseRad: 0, sample: null, stationary: true },
        "synthetic",
      ),
      true,
    );
    if (!still) return;
    // A known scene: the masks are exact geometry, not SAM output.
    const k = still.width / scene.width;
    const scaled = (poly: Vec2[]) => poly.map((p) => ({ x: p.x * k, y: p.y * k }));
    marks.object = { mask: polygonMask(scaled(scene.objectPolygon)), source: "synthetic" };
    marks.support = { mask: polygonsMask(scene.supportPolygons.map(scaled), still.width, still.height), source: "synthetic" };
    marks.scaleTaps = scaled(scene.scaleTaps);
    marks.floorPoint = { x: scene.floorPoint.x * k, y: scene.floorPoint.y * k };
    scalePreset.value = "a4";
    fObject.value = "box";
    fSupport.value = "desk";
    fMassLow.value = "0.5";
    fMassHigh.value = "1";
    massSource = "user";
    tool = "floor";
    recompute();
    setHint(`SYNTHETIC scene: the phone is rolled by 6°. Expected d = ${formatLength(scene.expected.dM)}.`);
  }

  async function segmentAt(point: Vec2, which: "object" | "table"): Promise<void> {
    if (!still) return;
    busy = true;
    renderStatus();
    setHint(`SAM 3.1 is outlining the ${which}…`);
    try {
      const out = await samAtPoint(still.dataUrl, { width: still.width, height: still.height }, point);
      const chosen = pickMask(out.masks, "area");
      if (!chosen) {
        busy = false;
        recompute();
        setHint(`SAM 3.1 found nothing at that point (${out.latencyMs} ms). Tap again or draw it by hand.`, "warn");
        return;
      }
      const mark: ObjectMark = { mask: maskFromRuns(chosen), source: "sam-3.1" };
      if (which === "object") {
        marks.object = mark;
        tool = kind === "tilt" ? "object" : "table";
      } else {
        marks.support = mark;
        marks.manualSupportPoint = undefined;
        tool = marks.scaleTaps.length === 2 ? "floor" : "scale";
      }
      busy = false;
      recompute();
    } catch (error) {
      const text = error instanceof ApiError ? error.message : String(error);
      if (which === "object") marks.polygonDraft.push(point);
      else marks.manualSupportPoint = point;
      busy = false;
      recompute();
      setHint(`SAM 3.1 failed: ${text}. Draw it by hand instead.`, "warn");
    } finally {
      busy = false;
      renderStatus();
    }
  }

  function onTap(event: PointerEvent): void {
    if (!still || busy) return;
    const p = canvasPoint(stillCanvas, event);
    switch (tool) {
      case "object":
        if (samReady() && marks.polygonDraft.length === 0) {
          void segmentAt(p, "object");
          return;
        }
        marks.polygonDraft.push(p);
        break;
      case "table":
        if (samReady()) {
          void segmentAt(p, "table");
          return;
        }
        marks.manualSupportPoint = p;
        if (!marks.manualEdge) tool = "edge";
        break;
      case "edge":
        marks.manualEdge = p;
        if (!marks.support && !marks.manualSupportPoint) tool = "table";
        else if (marks.scaleTaps.length < 2) tool = "scale";
        break;
      case "scale":
        marks.scaleTaps = marks.scaleTaps.length >= 2 ? [p] : [...marks.scaleTaps, p];
        if (marks.scaleTaps.length === 2) tool = kind === "edge" ? "floor" : "foot";
        break;
      case "floor":
        marks.floorPoint = p;
        break;
      case "foot":
        marks.ladder = [p, ...marks.ladder.slice(1, 2)];
        tool = "top";
        break;
      case "top":
        marks.ladder = [marks.ladder[0] ?? p, p];
        if (marks.scaleTaps.length < 2) tool = "scale";
        break;
    }
    recompute();
  }

  function undo(): void {
    if (marks.polygonDraft.length > 0) marks.polygonDraft.pop();
    else if (tool === "scale" && marks.scaleTaps.length > 0) marks.scaleTaps.pop();
    else if (tool === "floor" && marks.floorPoint) marks.floorPoint = undefined;
    else if (tool === "edge" && marks.manualEdge) marks.manualEdge = undefined;
    else if (tool === "table") {
      marks.support = undefined;
      marks.manualSupportPoint = undefined;
    } else if (tool === "object") marks.object = undefined;
    else if (tool === "top" || tool === "foot") marks.ladder.pop();
    recompute();
  }

  function renderSurvey(items: Hazard[], note: string): void {
    surveyEl.innerHTML =
      `<p class="tiny">${escapeText(note)}</p>` +
      items
        .map(
          (h) => `<div class="cand"><div><b>${escapeText(h.object)}</b>${h.support ? ` on ${escapeText(h.support)}` : ""}${
            h.massKg ? ` · ${h.massKg.low}–${h.massKg.high} kg (${h.massKg.source})` : ""
          }${h.sharpEdgeDown ? " · sharp" : ""}<br><span class="tiny">${escapeText(h.note?.en ?? "")}</span></div>
          <button type="button" data-use="${h.id}">Use</button></div>`,
        )
        .join("");
    surveyEl.querySelectorAll<HTMLButtonElement>("[data-use]").forEach((b) =>
      b.addEventListener("click", () => {
        const h = items.find((x) => x.id === b.dataset.use);
        if (h) void useCandidate(h);
      }),
    );
  }

  async function useCandidate(h: Hazard): Promise<void> {
    surveyed = h;
    kind = h.kind === "ladder" ? "ladder" : "edge";
    root.querySelectorAll<HTMLButtonElement>("#kinds button").forEach((x) => x.classList.toggle("on", x.dataset.kind === kind));
    fObject.value = h.object;
    fSupport.value = h.support ?? "";
    fSharp.checked = h.sharpEdgeDown === true;
    if (h.massKg && kind === "edge") {
      fMassLow.value = String(h.massKg.low);
      fMassHigh.value = String(h.massKg.high);
      massSource = "model estimate";
    }
    if (!still || kind !== "edge" || !samReady()) {
      tool = kind === "ladder" ? "foot" : "object";
      recompute();
      return;
    }
    busy = true;
    renderStatus();
    setHint(`SAM 3.1 is segmenting “${h.object}”${h.support ? ` and “${h.support}”` : ""}…`);
    let warning = "";
    try {
      const obj = await samConcept(still.dataUrl, h.object);
      const objMask = pickMask(obj.masks, "confidence");
      if (objMask) marks.object = { mask: maskFromRuns(objMask), source: "sam-3.1" };
      else warning = `SAM 3.1 found no “${h.object}”. Tap it with Object instead.`;
      if (h.support) {
        const sup = await samConcept(still.dataUrl, h.support);
        const supMask = pickMask(sup.masks, "area");
        if (supMask) marks.support = { mask: maskFromRuns(supMask), source: "sam-3.1" };
      }
      tool = marks.scaleTaps.length === 2 ? "floor" : "scale";
    } catch (error) {
      warning = `SAM 3.1 failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
      renderStatus();
      recompute();
      if (warning) setHint(warning, "warn");
    }
  }

  function addHazard(): void {
    if (kind === "tilt") return;
    const hazardKind = kind;
    const measurement = hazardKind === "edge" ? edgeResult?.measurement : ladderResult ?? undefined;
    if (!measurement) return;
    const replace = target.value !== "new" ? target.value : null;
    const free = [1, 2, 3, 4, 5, 6, 7, 8].find((n) => !hazards.some((h) => h.id === `h${n}`));
    if (!replace && free === undefined) {
      setHint("Eight hazards is the limit for one assessment.", "warn");
      return;
    }
    const id = replace ?? `h${free}`;
    const old = replace ? hazards.find((h) => h.id === replace) : undefined;
    const oldCapture = replace ? captures.get(replace) : undefined;
    const object = fObject.value.trim() || (kind === "ladder" ? "ladder" : "object");
    const hazard: Hazard = {
      id,
      kind: hazardKind,
      object,
      ...(fSupport.value.trim() && kind === "edge" ? { support: fSupport.value.trim() } : {}),
      ...(surveyed?.below ? { below: surveyed.below } : {}),
      ...(surveyed?.material ? { material: surveyed.material } : {}),
      sharpEdgeDown: fSharp.checked,
      massKg:
        kind === "ladder"
          ? { low: 60, high: 100, source: "assumption" }
          : { low: Number(fMassLow.value), high: Number(fMassHigh.value), source: massSource },
      measurement,
    };
    if (old?.measurement?.type === "edge" && measurement.type === "edge" && oldCapture) {
      hazard.before = { dM: old.measurement.dM, dP5M: old.measurement.dP5M, capturedAt: oldCapture.capturedAt };
      if (still) photos.set(id, { before: oldCapture.dataUrl, after: still.dataUrl });
    } else {
      photos.delete(id);
    }
    if (still) captures.set(id, { dataUrl: still.dataUrl, capturedAt: still.capturedAt });
    hazards = replace ? hazards.map((h) => (h.id === replace ? hazard : h)) : [...hazards, hazard];
    hideGhost();
    renderHazards();
  }

  function showGhost(id: string): void {
    const capture = captures.get(id);
    if (!capture) return;
    ghost.src = capture.dataUrl;
    ghost.classList.remove("hidden");
    ghostNote.textContent = `Re-shooting ${id}: make the fix (for example move the object inward), then stand where you stood before. The earlier photo shows faintly over the camera so you can line up the edge, then capture and mark it again. It will replace ${id} and keep the earlier margin for before and after.`;
    ghostNote.classList.remove("hidden");
    target.value = id;
  }

  function hideGhost(): void {
    ghost.classList.add("hidden");
    ghost.removeAttribute("src");
    ghostNote.classList.add("hidden");
  }

  function traceItem(line: TraceLine): string {
    switch (line.type) {
      case "mode":
        return `<li class="mode">${line.mode === "tools" ? "Native tool calls" : `JSON tool protocol${line.reason ? ` (${escapeText(line.reason)})` : ""}`}</li>`;
      case "turn":
        return `<li class="turn">Turn ${line.n} · ${escapeText(line.toolCalls.join(", ") || "no tool call")} · ${line.tokens.toLocaleString("en-US")} tokens · ${(line.latencyMs / 1000).toFixed(1)} s</li>`;
      case "tool": {
        if (line.error) return `<li class="bad">${escapeText(line.name)} ✗ ${escapeText(line.error)}</li>`;
        const fields = Object.entries(line.result ?? {})
          .filter(([, v]) => typeof v === "number")
          .slice(0, 4)
          .map(([k, v]) => `${k} ${formatField(k, v as number)}`)
          .join(", ");
        const args = typeof line.args === "object" && line.args !== null ? (line.args as Record<string, unknown>) : {};
        const about = Object.values(args)
          .filter((v) => typeof v === "string")
          .join(", ");
        return `<li class="tool"><code>${line.id}</code> ${escapeText(line.name)}(${escapeText(about)}) → ${escapeText(fields)}</li>`;
      }
      case "check":
        return line.ok
          ? `<li class="ok">Number check: accepted</li>`
          : `<li class="bad">Number check: sent back (${line.problems.length})<ul>${line.problems
              .map((p) => `<li>${escapeText(p)}</li>`)
              .join("")}</ul></li>`;
      case "final":
        return `<li class="ok">Table ready</li>`;
      case "error":
        return `<li class="bad">Error: ${escapeText(line.message)}</li>`;
    }
  }

  function showTable(next: AssessmentTable): void {
    previous = table;
    table = next;
    renderTable(tableEl, next, lang, previous, photos);
    exportsEl.classList.remove("hidden");
  }

  async function runAgent(): Promise<void> {
    if (hazards.length === 0) return;
    busy = true;
    renderStatus();
    traceEl.innerHTML = "";
    try {
      const result = await assess({ hazards, place: placeInput.value, imageDataUrl: still?.dataUrl }, (line) => {
        traceEl.insertAdjacentHTML("beforeend", traceItem(line));
      });
      showTable(result);
    } catch (error) {
      traceEl.insertAdjacentHTML("beforeend", `<li class="bad">${escapeText(error instanceof Error ? error.message : String(error))}</li>`);
    } finally {
      busy = false;
      renderStatus();
    }
  }

  function runLocal(): void {
    traceEl.innerHTML = `<li class="mode">Computed in this page without the agent: the same tools with fixed template text.</li>`;
    try {
      const { table: result, results } = localAssessment(hazards, {
        place: placeInput.value,
        createdAt: new Date().toISOString().slice(0, 10),
      });
      for (const r of results) {
        traceEl.insertAdjacentHTML("beforeend", traceItem({ type: "tool", id: r.id, name: r.tool, args: r.args, result: r.result }));
      }
      showTable(result);
    } catch (error) {
      traceEl.insertAdjacentHTML("beforeend", `<li class="bad">${escapeText(error instanceof Error ? error.message : String(error))}</li>`);
    }
  }

  function saveCapture(): void {
    if (!still) return;
    const stamp = still.capturedAt.replace(/[:.]/g, "-");
    const a = document.createElement("a");
    a.href = still.dataUrl;
    a.download = `capture-${stamp}.jpg`;
    document.body.append(a);
    a.click();
    a.remove();
    const m = edgeResult?.measurement ?? ladderResult;
    downloadText(
      `capture-${stamp}.json`,
      "application/json",
      JSON.stringify(
        {
          capturedAt: still.capturedAt,
          origin: still.origin,
          image: { width: still.width, height: still.height },
          gravity: {
            source: still.gravitySource,
            sample: still.gravitySample,
            plumbDown: still.plumb.down,
            noiseRad: still.gravityNoiseRad,
            stationary: still.stationary,
            pitchDeg: still.pitchDeg,
          },
          marks: {
            scaleTaps: marks.scaleTaps,
            knownLength: knownLength(),
            floorPoint: marks.floorPoint ?? null,
            manualEdge: marks.manualEdge ?? null,
            manualSupportPoint: marks.manualSupportPoint ?? null,
            ladder: marks.ladder,
            objectSource: marks.object?.source ?? null,
            supportSource: marks.support?.source ?? null,
          },
          measurement: m ?? null,
          rulerMeasuredDM: null,
          note: "For EVAL.md: fill rulerMeasuredDM with the margin measured by ruler, in metres.",
        },
        null,
        2,
      ),
    );
  }

  // Wiring.
  $("#btn-motion").addEventListener("click", () => {
    void (async () => {
      const motion = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
      try {
        const result = await requestMotionPermission(motion);
        setHint(`Motion sensors: ${result}.`);
      } catch (error) {
        setHint(`Motion sensors: ${error instanceof Error ? error.message : String(error)}`, "warn");
      }
      renderStatus();
    })();
  });
  $("#btn-camera").addEventListener("click", () => {
    void (async () => {
      try {
        stream = await startCamera(live);
        liveStage.classList.remove("hidden");
        btnCapture.disabled = false;
        const loop = () => {
          if (!stream) return;
          drawLiveOverlay(liveOverlay, live, gravity.reading());
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      } catch (error) {
        setHint(`Camera: ${error instanceof Error ? error.message : String(error)}`, "warn");
      }
    })();
  });
  btnCapture.addEventListener("click", () => {
    if (!live.videoWidth) return;
    const reading = gravity.reading();
    const g = reading
      ? {
          plumb: reading.plumb,
          source: "sensor" as const,
          noiseRad: reading.noiseRad,
          sample: reading.sample,
          stationary: reading.stationary,
          pitchDeg: reading.pitchDeg,
        }
      : { plumb: plumbFromDown({ x: 0, y: 1 }), source: "image vertical (assumed)" as const, noiseRad: 0, sample: null, stationary: false };
    const reshooting = !ghost.classList.contains("hidden") ? target.value : null;
    setStill(stillFromSource(live, live.videoWidth, live.videoHeight, g, "camera"));
    if (reshooting && [...target.options].some((o) => o.value === reshooting)) target.value = reshooting;
    if (!reading) setHint("No gravity reading: the photo's vertical is assumed. Allow motion sensors for a real plumb line.", "warn");
    else if (reading.flat) setHint("The phone was nearly flat, so the plumb line is unreliable. Hold it upright and capture again.", "warn");
    else if (Math.abs(reading.pitchDeg) > SIDE_VIEW_MAX_PITCH_DEG)
      setHint(
        `The camera was pitched ${Math.abs(reading.pitchDeg).toFixed(0)}°, so this is not a side view and distances may be foreshortened. Hold the phone level with the edge and capture again.`,
        "warn",
      );
  });
  $<HTMLInputElement>("#file").addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      setStill(
        stillFromSource(
          img,
          img.naturalWidth,
          img.naturalHeight,
          { plumb: plumbFromDown({ x: 0, y: 1 }), source: "image vertical (assumed)", noiseRad: 0, sample: null, stationary: false },
          "upload",
        ),
      );
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
  $("#btn-synthetic").addEventListener("click", loadSynthetic);
  root.querySelectorAll<HTMLButtonElement>("#kinds button").forEach((b) =>
    b.addEventListener("click", () => {
      kind = b.dataset.kind === "ladder" ? "ladder" : b.dataset.kind === "tilt" ? "tilt" : "edge";
      root.querySelectorAll<HTMLButtonElement>("#kinds button").forEach((x) => x.classList.toggle("on", x === b));
      tool = kind === "ladder" ? "foot" : "object";
      recompute();
    }),
  );
  toolsEl.addEventListener("click", (event) => {
    const b = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tool]");
    if (!b) return;
    tool = b.dataset.tool as Tool;
    renderTools();
  });
  stillCanvas.addEventListener("pointerup", onTap);
  $("#btn-undo").addEventListener("click", undo);
  btnClose.addEventListener("click", () => {
    if (marks.polygonDraft.length >= 3) {
      marks.object = { mask: polygonMask(marks.polygonDraft), source: "manual" };
      marks.polygonDraft = [];
      tool = kind === "tilt" ? "object" : "table";
    }
    recompute();
  });
  btnSurvey.addEventListener("click", () => {
    if (!still) return;
    const image = still.dataUrl;
    void (async () => {
      busy = true;
      renderStatus();
      surveyEl.innerHTML = `<p class="tiny">Muse Spark Open is looking at the photo…</p>`;
      try {
        const out = await survey(image);
        renderSurvey(
          out.hazards,
          `Muse Spark Open listed ${out.hazards.length} candidate(s) in ${(out.latencyMs / 1000).toFixed(1)} s. Masses are its estimates.`,
        );
      } catch (error) {
        surveyEl.innerHTML = `<p class="hint warn">${escapeText(error instanceof Error ? error.message : String(error))}</p>`;
      } finally {
        busy = false;
        renderStatus();
      }
    })();
  });
  [scalePreset, scaleCustom].forEach((el) => el.addEventListener("change", recompute));
  [fMassLow, fMassHigh].forEach((el) =>
    el.addEventListener("input", () => {
      massSource = "user";
      updateAddButton();
    }),
  );
  btnAdd.addEventListener("click", addHazard);
  root.querySelectorAll<HTMLButtonElement>("#tilt-side button").forEach((b) =>
    b.addEventListener("click", () => {
      tiltSide = b.dataset.side === "min" || b.dataset.side === "max" ? b.dataset.side : "auto";
      root.querySelectorAll<HTMLButtonElement>("#tilt-side button").forEach((x) => x.classList.toggle("on", x === b));
      recompute();
    }),
  );
  btnTiltStart.addEventListener("click", () => {
    if (!tipResult || !still) return;
    const prediction = tipResult;
    const photo = still;
    const object = fObject.value.trim() || "object";
    meter?.stop();
    meter = new TiltMeter({
      onTilt: (deg) => {
        tiltNow.textContent = `${deg.toFixed(1)}°`;
      },
      onTip: (tip) => {
        const difference = tip.tiltDeg - prediction.geometry.angleDeg;
        tiltLog.push({
          object,
          side: prediction.side,
          predictedDeg: prediction.geometry.angleDeg,
          p5Deg: prediction.p5Deg,
          p95Deg: prediction.p95Deg,
          measuredDeg: tip.tiltDeg,
          differenceDeg: difference,
          how: tip.how,
          photoCapturedAt: photo.capturedAt,
          gravitySource: photo.gravitySource,
          maskSource: marks.object?.source ?? "manual",
        });
        tiltLogEl.insertAdjacentHTML(
          "beforeend",
          `<li class="ok">${escapeText(object)}: tipped at ${tip.tiltDeg.toFixed(1)}° (${tip.how === "jolt" ? "landing detected" : "tapped"}) · predicted ${prediction.geometry.angleDeg.toFixed(1)}° (${prediction.p5Deg.toFixed(1)}–${prediction.p95Deg.toFixed(1)}°) · difference ${difference >= 0 ? "+" : ""}${difference.toFixed(1)}°</li>`,
        );
        tiltNow.textContent = `${tip.tiltDeg.toFixed(1)}°`;
        meter = null;
        btnTiltTipped.disabled = true;
        btnTiltStart.disabled = false;
        btnTiltSave.disabled = false;
      },
    });
    meter.start();
    tiltNow.textContent = "0.0°";
    btnTiltStart.disabled = true;
    btnTiltTipped.disabled = false;
    setHint("Keep the board level for a moment: the first readings count as level. Then raise one end slowly.");
  });
  btnTiltTipped.addEventListener("click", () => meter?.tipped());
  btnTiltSave.addEventListener("click", () => {
    downloadText(
      `tilt-check-${new Date().toISOString().slice(0, 10)}.json`,
      "application/json",
      JSON.stringify(
        {
          note: "Predicted tipping angle from one side photo (uniform density, no sliding assumed) against the board angle measured by the phone lying on the board. Jolt detection: threshold and look-back are assumptions.",
          results: tiltLog,
        },
        null,
        2,
      ),
    );
  });
  hazardsEl.addEventListener("click", (event) => {
    const again = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-reshoot]");
    if (again?.dataset.reshoot) {
      showGhost(again.dataset.reshoot);
      if (!stream) setHint("Start the camera to re-shoot. The earlier photo will show faintly over it.", "warn");
      liveStage.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const b = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-remove]");
    if (!b) return;
    const id = b.dataset.remove ?? "";
    hazards = hazards.filter((h) => h.id !== id);
    captures.delete(id);
    photos.delete(id);
    renderHazards();
  });
  tableEl.addEventListener("change", (event) => {
    const sel = (event.target as HTMLElement).closest<HTMLSelectElement>("select[data-slot]");
    if (!sel || !table) return;
    const slot = sel.dataset.slot as GradeSlot;
    table = setGrade(table, sel.dataset.row ?? "", slot, Number(sel.value));
    renderTable(tableEl, table, lang, previous, photos);
  });
  btnAgent.addEventListener("click", () => void runAgent());
  btnLocal.addEventListener("click", runLocal);
  root.querySelectorAll<HTMLButtonElement>("#langs button").forEach((b) =>
    b.addEventListener("click", () => {
      lang = b.dataset.lang === "ko" ? "ko" : "en";
      root.querySelectorAll<HTMLButtonElement>("#langs button").forEach((x) => x.classList.toggle("on", x === b));
      if (table) renderTable(tableEl, table, lang, previous, photos);
    }),
  );
  $("#btn-csv").addEventListener("click", () => {
    if (table) downloadCsv(table, lang);
  });
  $("#btn-print").addEventListener("click", () => {
    if (table) openPrintable(table, lang);
  });
  $("#btn-save").addEventListener("click", saveCapture);
  $("#btn-check").addEventListener("click", () => {
    void (async () => {
      const out = $("#check-out");
      out.textContent = "Calling Muse Spark Open…";
      try {
        const r = await sparkCheck();
        out.textContent = `Muse Spark Open answered “${r.reply.trim()}” in ${(r.latencyMs / 1000).toFixed(1)} s. Native tool calls: ${
          r.toolCallsSupported === null ? "unknown" : r.toolCallsSupported ? "yes" : "no"
        }${r.toolError ? ` (${r.toolError})` : ""}.`;
      } catch (error) {
        out.textContent = error instanceof Error ? error.message : String(error);
      }
    })();
  });

  void (async () => {
    api = await getStatus();
    renderStatus();
    if (still) renderTools();
  })();
  renderStatus();
  setInterval(renderStatus, 1500);
  const demo = new URLSearchParams(location.search).get("demo");
  if (demo === "tilt") {
    loadSynthetic();
    kind = "tilt";
    root.querySelectorAll<HTMLButtonElement>("#kinds button").forEach((x) => x.classList.toggle("on", x.dataset.kind === "tilt"));
    tool = "object";
    recompute();
  }
  if (demo === "synthetic" || demo === "assess") {
    loadSynthetic();
    if (demo === "assess") {
      addHazard();
      runLocal();
    }
  }
}
