import { handleModels } from "../server/routes.ts";

export function GET(request: Request): Promise<Response> {
  return handleModels(request);
}
