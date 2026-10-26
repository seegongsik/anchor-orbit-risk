import { handleSam } from "../server/routes.ts";

export function POST(request: Request): Promise<Response> {
  return handleSam(request);
}
