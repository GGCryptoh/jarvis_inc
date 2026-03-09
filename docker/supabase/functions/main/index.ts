import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import executeSkill from "../execute-skill/index.ts";

// Static function registry (Deno sandbox blocks dynamic imports)
const FUNCTIONS: Record<string, (req: Request) => Promise<Response>> = {
  "execute-skill": executeSkill,
  health: async () =>
    new Response(JSON.stringify({ status: "ok", ts: Date.now() }), {
      headers: { "Content-Type": "application/json" },
    }),
};

serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const functionName = pathParts[0];

  if (!functionName) {
    return new Response(
      JSON.stringify({ functions: Object.keys(FUNCTIONS) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const handler = FUNCTIONS[functionName];
  if (!handler) {
    return new Response(
      JSON.stringify({ error: `Unknown function: ${functionName}`, available: Object.keys(FUNCTIONS) }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return handler(req);
});
