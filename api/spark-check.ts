import { handleSparkCheck } from "../server/routes.js";

export function POST(request: Request): Promise<Response> {
  return handleSparkCheck(request);
}
