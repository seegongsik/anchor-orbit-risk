import { handleStatus } from "../server/routes.ts";

export function GET(request: Request): Promise<Response> {
  return handleStatus(request);
}
