import { handleModels } from "../server/routes.js";

export function GET(request: Request): Promise<Response> {
  return handleModels(request);
}
