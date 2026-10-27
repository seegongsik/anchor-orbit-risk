import {
  handleAssess,
  handleModels,
  handleSam,
  handleSparkCheck,
  handleStatus,
  handleSurvey,
} from "./routes.js";

const ROUTES: Record<string, (request: Request) => Promise<Response>> = {
  "/api/status": handleStatus,
  "/api/models": handleModels,
  "/api/sam": handleSam,
  "/api/survey": handleSurvey,
  "/api/assess": handleAssess,
  "/api/spark-check": handleSparkCheck,
};

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export async function dispatchApi(request: Request): Promise<Response> {
  const path = normalizePath(new URL(request.url).pathname);
  const handler = ROUTES[path];
  if (!handler) return Response.json({ error: "not found" }, { status: 404 });
  return handler(request);
}
