/**
 * Transpiles every file the API functions reach, one file at a time (the way
 * Vercel's Node runtime builds api/*.ts), into a temporary folder, then imports
 * each function and calls it. Catches import specifiers that only a bundler
 * would resolve. No network: model keys are cleared first.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "node_modules", ".check-api");
rmSync(out, { recursive: true, force: true });

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

for (const dir of ["api", "server", "src"]) {
  for (const file of walk(join(root, dir))) {
    if (!file.endsWith(".ts")) continue;
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
    });
    const target = join(out, relative(root, file)).replace(/\.ts$/, ".js");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, outputText);
  }
}
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

for (const key of ["MODEL_API_KEY", "META_API_KEY", "BASETEN_API_KEY"]) delete process.env[key];
const results = [];
for (const file of readdirSync(join(out, "api"))) {
  const mod = await import(pathToFileURL(join(out, "api", file)).href);
  const method = typeof mod.GET === "function" ? "GET" : "POST";
  const handler = mod[method];
  if (typeof handler !== "function") throw new Error(`${file} exports no GET or POST`);
  const response = await handler(
    new Request(`http://local/api/${file.replace(/\.js$/, "")}`, {
      method,
      ...(method === "POST" ? { body: "{}", headers: { "Content-Type": "application/json" } } : {}),
    }),
  );
  results.push(`${file} ${method} -> ${response.status}`);
}
console.log(results.join("\n"));
rmSync(out, { recursive: true, force: true });
