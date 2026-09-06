#!/usr/bin/env sh
# M5 gate #4: with the AI module REMOVED from modules.json the app still builds and runs with no
# AI trace — no generated entry, no route, no menu, no table, nothing in the web build output.
set -eu
cd "$(dirname "$0")/../.."
cp modules.json /tmp/modules.json.bak
trap 'cp /tmp/modules.json.bak modules.json; bun run bootstrap >/dev/null 2>&1 || true' EXIT
bun -e '
  const f = "modules.json"; const j = JSON.parse(await Bun.file(f).text());
  j.modules = j.modules.filter((m) => m.name !== "AI"); await Bun.write(f, JSON.stringify(j, null, 2) + "\n");
'
echo "== bootstrap without AI"
bun run bootstrap | tail -3
echo "== no AI trace in generated registries"
! grep -rqiE "\"ai\"|'ai'|module:ai|/m/ai|ai_conversations" packages/module-kit/src/generated packages/db/src/generated apps/api/src/generated apps/web/src/generated packages/i18n/src/generated || { echo "AI trace found in generated files"; exit 1; }
test ! -d "apps/web/src/routes/(app)/m/ai" || { echo "AI routes still shimmed"; exit 1; }
echo "== typecheck + build without AI"
bun run typecheck >/dev/null
(cd apps/web && bun run build >/dev/null 2>&1)
! grep -rqE "/m/ai/|ai\.chat\." apps/web/build/server 2>/dev/null || { echo "AI trace in web build"; exit 1; }
echo "== openapi without AI"
# The app reads the validated env when handling a request; placeholders suffice (nothing connects).
DATABASE_URL=mysql://unit:unit@127.0.0.1:1/unit DB_DIALECT=mysql SCHEDULER_ENABLED=false bun --env-file=/dev/null -e 'const { app } = await import("./apps/api/src/app.ts"); const d = await (await app.handle(new Request("http://localhost/openapi.json"))).json(); const ai = Object.keys(d.paths).filter((p) => p.includes("/m/ai")); if (ai.length) { console.error("AI paths in OpenAPI", ai); process.exit(1); } console.log(`openapi: ${Object.keys(d.paths).length} paths, none under /m/ai`);'
echo "GATE M5 #4: LOLOS — tanpa modul AI, aplikasi ter-build & berjalan tanpa jejak AI"
