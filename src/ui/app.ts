import { A4_LONG_SIDE_M, CREDIT_CARD_LONG_SIDE_M } from "../physics/constants.ts";
import type { MaskSource } from "../physics/evidence.ts";
import type { Vec2 } from "../physics/geometry.ts";
import { metersPerPixel, pixelDistance } from "../physics/scale.ts";
import { runTipoverPipeline, type PipelineResult } from "../pipeline/tipover-pipeline.ts";
import {
  drawSyntheticScene,
  expectedSyntheticDMetres,
  SYNTHETIC_SCENE,
  syntheticObjectMask,
} from "../pipeline/synthetic-scene.ts";
import {
  imageDownFromSample,
  isStationary,
  readScreenAngleDeg,
  requestMotionPermission,
  type DeviceAcceleration,
  type GravitySample,
} from "../sensors/gravity.ts";
import { drawOverlay } from "./overlay.ts";

type ApiStatus = {
  modelApiKeyConfigured: boolean;
  basetenApiKeyConfigured: boolean;
};

type Capture = {
  dataUrl: string;
  width: number;
  height: number;
  gravity: GravitySample;
  stationary: boolean;
};

const DISCLAIMER =
  "This app is an assessment aid. The supervisor makes the final judgment. It is not medical advice and it does not identify people.";

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `
    <header>
      <h1>Anchor and Orbit</h1>
      <p class="lede">Point your phone at a workspace. It finds what can fall, computes the physics, and writes a traceable margin.</p>
    </header>
    <aside class="disclaimer">${DISCLAIMER}</aside>
    <div id="api-banner" class="banner warn">Checking server key status…</div>
    <section>
      <h2>1. Gravity and photo</h2>
      <div class="row">
        <button id="btn-motion" type="button">Allow motion sensors</button>
        <button id="btn-camera" type="button">Start camera</button>
        <button id="btn-capture" type="button" class="primary" disabled>Capture</button>
      </div>
      <p id="sensor-note" class="tiny">HTTPS is required for sensors on a real phone. iOS asks for permission only after a tap.</p>
      <div class="stage" id="live-stage">
        <video id="live" autoplay playsinline muted></video>
      </div>
      <p id="gravity-readout" class="tiny">Gravity: waiting for a sample.</p>
    </section>
    <section>
      <h2>2. Scale</h2>
      <label for="scale-preset">Known length</label>
      <select id="scale-preset">
        <option value="a4-long">A4 long side (0.297 m, ISO 216)</option>
        <option value="credit-card">Credit card (0.0856 m, ISO/IEC 7810 ID-1)</option>
        <option value="custom">Custom metres</option>
      </select>
      <label for="scale-custom">Custom length (m)</label>
      <input id="scale-custom" type="number" min="0.01" step="0.001" value="0.297" />
      <p class="tiny">Tap two points on the still to mark that length. Until then, synthetic demo uses its built-in scale.</p>
    </section>
    <section>
      <h2>3. Object and edge</h2>
      <div class="row">
        <button id="btn-synthetic" type="button">Load synthetic example</button>
        <button id="btn-sam" type="button" disabled>Run SAM 3.1</button>
        <button id="btn-run" type="button" class="primary" disabled>Compute d</button>
      </div>
      <p class="tiny">SAM 3.1 stays disabled without a server key. Manual path: tap object corners, then the edge (two taps), then a point on the table.</p>
      <label for="concept">SAM concept (short noun phrase)</label>
      <input id="concept" type="text" value="box" />
      <p id="annotate-note" class="tiny">No still yet.</p>
    </section>
    <section>
      <h2>Result</h2>
      <div class="stage">
        <canvas id="result-canvas"></canvas>
      </div>
      <div id="metrics" class="metrics"></div>
      <div id="compare" class="card hidden"></div>
      <details>
        <summary>See evidence</summary>
        <pre id="evidence">No result yet.</pre>
      </details>
    </section>
  `;

  const apiBanner = must("#api-banner");
  const live = must("#live") as HTMLVideoElement;
  const btnMotion = must("#btn-motion") as HTMLButtonElement;
  const btnCamera = must("#btn-camera") as HTMLButtonElement;
  const btnCapture = must("#btn-capture") as HTMLButtonElement;
  const btnSynthetic = must("#btn-synthetic") as HTMLButtonElement;
  const btnSam = must("#btn-sam") as HTMLButtonElement;
  const btnRun = must("#btn-run") as HTMLButtonElement;
  const gravityReadout = must("#gravity-readout");
  const annotateNote = must("#annotate-note");
  const resultCanvas = must("#result-canvas") as HTMLCanvasElement;
  const metrics = must("#metrics");
  const evidenceEl = must("#evidence");
  const compareEl = must("#compare");
  const scalePreset = must("#scale-preset") as HTMLSelectElement;
  const scaleCustom = must("#scale-custom") as HTMLInputElement;
  const conceptInput = must("#concept") as HTMLInputElement;

  let api: ApiStatus | null = null;
  let stream: MediaStream | null = null;
  const gravityBuffer: DeviceAcceleration[] = [];
  let lastGravity: GravitySample | null = null;
  let capture: Capture | null = null;
  let previous: PipelineResult | null = null;
  const polygon: Vec2[] = [];
  let edge: Vec2[] = [];
  let supportToward: Vec2 | null = null;
  let scalePoints: Vec2[] = [];
  let maskSource: MaskSource = "manual";

  void loadStatus();
  window.addEventListener("devicemotion", onMotion);
  resultCanvas.addEventListener("click", onResultClick);

  btnMotion.addEventListener("click", () => {
    void (async () => {
      const motion = (
        window as unknown as {
          DeviceMotionEvent?: { requestPermission?: () => Promise<string> };
        }
      ).DeviceMotionEvent;
      const result = await requestMotionPermission(motion);
      gravityReadout.textContent = `Motion permission: ${result}`;
    })();
  });

  btnCamera.addEventListener("click", () => {
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        live.srcObject = stream;
        btnCapture.disabled = false;
      } catch (error) {
        gravityReadout.textContent =
          error instanceof Error ? error.message : "camera failed";
      }
    })();
  });

  btnCapture.addEventListener("click", () => {
    if (!live.videoWidth) {
      gravityReadout.textContent = "Camera is not ready.";
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = live.videoWidth;
    canvas.height = live.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(live, 0, 0);
    const gravity =
      lastGravity ??
      ({
        accelerationIncludingGravity: { x: 0, y: 0, z: 0 },
        screenAngleDeg: readScreenAngleDeg(screen.orientation),
        timestampMs: Date.now(),
      } satisfies GravitySample);
    capture = {
      dataUrl: canvas.toDataURL("image/jpeg", 0.85),
      width: canvas.width,
      height: canvas.height,
      gravity,
      stationary: isStationary(gravityBuffer),
    };
    maskSource = "manual";
    polygon.length = 0;
    edge = [];
    supportToward = null;
    scalePoints = [];
    annotateNote.textContent = capture.stationary
      ? "Still captured. Tap object corners, then two edge points, then the table."
      : "Still captured but the phone did not look stationary. Tap object corners, then two edge points, then the table.";
    showStill(canvas);
    btnRun.disabled = false;
  });

  btnSynthetic.addEventListener("click", () => {
    loadSynthetic();
  });

  btnSam.addEventListener("click", () => {
    void runSam();
  });

  btnRun.addEventListener("click", () => {
    runLocal();
  });

  if (new URLSearchParams(location.search).get("demo") === "synthetic") {
    loadSynthetic();
  }

  async function loadStatus(): Promise<void> {
    try {
      const res = await fetch("/api/status");
      api = (await res.json()) as ApiStatus;
      if (api.modelApiKeyConfigured) {
        apiBanner.className = "banner ok";
        apiBanner.textContent =
          "Model API key is configured on the server (value not shown). SAM 3.1 can be called.";
        btnSam.disabled = false;
      } else {
        apiBanner.className = "banner warn";
        apiBanner.textContent =
          "Model API key is not configured. Capture, gravity, and local physics work. SAM 3.1 and Muse calls are disabled — no invented results.";
        btnSam.disabled = true;
      }
    } catch {
      apiBanner.className = "banner warn";
      apiBanner.textContent =
        "Could not reach /api/status. Local physics still runs in this page.";
    }
  }

  function onMotion(event: DeviceMotionEvent): void {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const sample: DeviceAcceleration = { x: a.x, y: a.y, z: a.z };
    gravityBuffer.push(sample);
    if (gravityBuffer.length > 20) gravityBuffer.shift();
    lastGravity = {
      accelerationIncludingGravity: sample,
      screenAngleDeg: readScreenAngleDeg(screen.orientation),
      timestampMs: Date.now(),
    };
    const down = imageDownFromSample(lastGravity);
    gravityReadout.textContent =
      `a+g = (${sample.x.toFixed(2)}, ${sample.y.toFixed(2)}, ${sample.z.toFixed(2)}) · ` +
      `image down (u,v)=(${down.u.toFixed(2)}, ${down.v.toFixed(2)})` +
      (down.isFlat ? " · flat" : "");
  }

  function loadSynthetic(): void {
    const canvas = document.createElement("canvas");
    drawSyntheticScene(canvas);
    capture = {
      dataUrl: canvas.toDataURL("image/png"),
      width: SYNTHETIC_SCENE.width,
      height: SYNTHETIC_SCENE.height,
      gravity: {
        accelerationIncludingGravity: SYNTHETIC_SCENE.accelerationIncludingGravity,
        screenAngleDeg: 0,
        timestampMs: Date.now(),
      },
      stationary: true,
    };
    maskSource = "synthetic";
    polygon.length = 0;
    edge = [
      { x: SYNTHETIC_SCENE.edgeX, y: 40 },
      { x: SYNTHETIC_SCENE.edgeX, y: SYNTHETIC_SCENE.height - 20 },
    ];
    supportToward = SYNTHETIC_SCENE.supportToward;
    scalePoints = [];
    annotateNote.textContent =
      "SYNTHETIC example loaded. This is not a camera frame and not a SAM result.";
    const result = runTipoverPipeline({
      mask: syntheticObjectMask(),
      edgeA: edge[0],
      edgeB: edge[1],
      supportToward,
      metersPerPixel: SYNTHETIC_SCENE.metersPerPixel,
      metersPerPixelSigma: SYNTHETIC_SCENE.metersPerPixelSigma,
      comSigmaPx: SYNTHETIC_SCENE.comSigmaPx,
      edgeSigmaPx: SYNTHETIC_SCENE.edgeSigmaPx,
      maskSource: "synthetic",
      gravity: capture.gravity,
      assumptions: [
        "SYNTHETIC scene. Known rectangle on a vertical edge.",
        `Expected d (geometry) = ${expectedSyntheticDMetres().toFixed(4)} m.`,
      ],
    });
    showResult(canvas, result, edge[0], edge[1]);
    btnRun.disabled = false;
  }

  function runLocal(): void {
    if (!capture) {
      annotateNote.textContent = "Capture a still or load the synthetic example first.";
      return;
    }
    if (maskSource === "synthetic") {
      loadSynthetic();
      return;
    }
    if (polygon.length < 3 || edge.length < 2 || !supportToward) {
      annotateNote.textContent =
        "Need a polygon (≥3 taps), an edge (2 taps), and a table point.";
      return;
    }
    const mask = polygonToMask(polygon, capture.width, capture.height);
    const mpp = currentMetersPerPixel();
    const result = runTipoverPipeline({
      mask,
      edgeA: edge[0],
      edgeB: edge[1],
      supportToward,
      metersPerPixel: mpp,
      metersPerPixelSigma: 0,
      comSigmaPx: 1,
      edgeSigmaPx: 0.5,
      maskSource: "manual",
      gravity: capture.gravity,
      assumptions: [
        "Object mask is a user polygon (not SAM).",
        scalePoints.length === 2
          ? "Scale from two user taps."
          : "Scale uses the selected preset length over the image width (assumption until two scale taps exist).",
      ],
    });
    const image = new Image();
    image.onload = () => showResult(image, result, edge[0], edge[1]);
    image.src = capture.dataUrl;
  }

  async function runSam(): Promise<void> {
    if (!api?.modelApiKeyConfigured) {
      annotateNote.textContent = "SAM 3.1 is disabled: no server key.";
      return;
    }
    if (!capture) {
      annotateNote.textContent = "Capture a still first.";
      return;
    }
    annotateNote.textContent = "Calling SAM 3.1…";
    const res = await fetch("/api/sam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concept: conceptInput.value.trim(),
        imageUrl: capture.dataUrl,
      }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      records?: unknown;
    };
    if (!res.ok || !body.ok) {
      annotateNote.textContent = body.error ?? `SAM failed (${res.status})`;
      return;
    }
    annotateNote.textContent =
      "SAM 3.1 returned records. Official mask rasters are not decoded yet (확인 필요). Use boxes only after that is confirmed, or keep the manual / synthetic path.";
    maskSource = "sam-3.1";
  }

  function currentMetersPerPixel(): number {
    const preset = scalePreset.value;
    const known =
      preset === "credit-card"
        ? CREDIT_CARD_LONG_SIDE_M
        : preset === "custom"
          ? Number(scaleCustom.value)
          : A4_LONG_SIDE_M;
    if (scalePoints.length === 2 && capture) {
      return metersPerPixel(known, pixelDistance(scalePoints[0], scalePoints[1])).value;
    }
    if (!capture) return SYNTHETIC_SCENE.metersPerPixel;
    return metersPerPixel(known, capture.width).value;
  }

  function showStill(image: HTMLCanvasElement): void {
    const ctx = resultCanvas.getContext("2d");
    if (!ctx) return;
    resultCanvas.width = image.width;
    resultCanvas.height = image.height;
    ctx.drawImage(image, 0, 0);
  }

  function showResult(
    image: HTMLImageElement | HTMLCanvasElement,
    result: PipelineResult,
    edgeA: Vec2,
    edgeB: Vec2,
  ): void {
    if (previous) {
      compareEl.classList.remove("hidden");
      compareEl.innerHTML =
        `<strong>Before / after</strong><br>` +
        `Previous d = ${previous.d.value.toFixed(4)} m · P(unstable) = ${previous.pUnstable.toFixed(3)}<br>` +
        `Current d = ${result.d.value.toFixed(4)} m · P(unstable) = ${result.pUnstable.toFixed(3)}`;
    }
    previous = result;
    drawOverlay(resultCanvas, { image, result, edgeA, edgeB });
    const unstable = result.currentlyUnstable;
    metrics.innerHTML = `
      <div class="metric ${unstable ? "bad" : ""}"><div class="k">Margin d</div><div class="v">${result.d.value.toFixed(4)} m</div></div>
      <div class="metric ${unstable ? "bad" : ""}"><div class="k">Now unstable</div><div class="v">${unstable ? "yes" : "no"}</div></div>
      <div class="metric"><div class="k">P(unstable)</div><div class="v">${(result.pUnstable * 100).toFixed(1)}%</div></div>
      <div class="metric"><div class="k">MC std(d)</div><div class="v">${result.mc.dStd.toFixed(4)} m</div></div>
    `;
    evidenceEl.textContent = JSON.stringify(
      {
        maskSource: result.maskSource,
        gravity: result.gravity,
        com: result.com,
        mc: result.mc,
        evidence: result.evidence,
        disclaimer: DISCLAIMER,
      },
      null,
      2,
    );
  }

  function onResultClick(event: MouseEvent): void {
    if (!capture || maskSource === "synthetic") return;
    const pt = canvasPoint(resultCanvas, event);
    if (scalePoints.length < 2 && event.shiftKey) {
      scalePoints.push(pt);
      annotateNote.textContent = `Scale taps: ${scalePoints.length}/2`;
      return;
    }
    if (polygon.length < 8 && edge.length === 0) {
      polygon.push(pt);
      annotateNote.textContent = `Object corners: ${polygon.length}. Tap at least 3, then two edge points.`;
      return;
    }
    if (edge.length < 2) {
      edge.push(pt);
      annotateNote.textContent = `Edge points: ${edge.length}/2`;
      return;
    }
    supportToward = pt;
    annotateNote.textContent = "Table point set. Compute d.";
  }
}

function canvasPoint(canvas: HTMLCanvasElement, event: MouseEvent): Vec2 {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  return { x, y };
}

function polygonToMask(poly: Vec2[], width: number, height: number) {
  const data = new Uint8Array(width * height);
  if (poly.length < 3) return { width, height, data };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pointInPolygon({ x: x + 0.5, y: y + 0.5 }, poly)) {
        data[y * width + x] = 1;
      }
    }
  }
  return { width, height, data };
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    const intersect =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 0) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

function must(selector: string): HTMLElement {
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`missing ${selector}`);
  }
  return el;
}
