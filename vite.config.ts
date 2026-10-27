import { defineConfig } from "vitest/config";
import { dispatchApi } from "./server/dispatch.js";

function collectBody(req: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default defineConfig({
  plugins: [
    {
      name: "dev-api",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          void (async () => {
            if (!req.url || !req.url.startsWith("/api")) {
              next();
              return;
            }
            try {
              const host = req.headers.host ?? "localhost";
              const url = `http://${host}${req.url}`;
              const headers = new Headers();
              for (const [key, value] of Object.entries(req.headers)) {
                if (typeof value === "string") headers.set(key, value);
                else if (Array.isArray(value)) headers.set(key, value.join(", "));
              }
              const method = req.method ?? "GET";
              const body =
                method === "GET" || method === "HEAD"
                  ? undefined
                  : await collectBody(req);
              const request = new Request(url, {
                method,
                headers,
                body: body ? new Uint8Array(body) : undefined,
              });
              const response = await dispatchApi(request);
              res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                res.setHeader(key, value);
              });
              if (!response.body) {
                res.end();
                return;
              }
              // Stream the body so NDJSON progress reaches the page as it happens.
              const reader = response.body.getReader();
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
              }
              res.end();
            } catch (error) {
              next(error);
            }
          })();
        });
      },
    },
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
