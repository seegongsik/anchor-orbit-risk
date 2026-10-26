import { handleModels, handleSam, handleStatus } from "./routes.ts";

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export async function dispatchApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  if (path === "/api/status") return handleStatus(request);
  if (path === "/api/models") return handleModels(request);
  if (path === "/api/sam") return handleSam(request);
  return Response.json({ error: "not found" }, { status: 404 });
}
