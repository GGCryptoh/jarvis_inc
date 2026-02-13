import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const FUNCTION_DIR = "/home/deno/functions";

serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const functionName = pathParts[0];

  if (!functionName) {
    return new Response(JSON.stringify({ error: "Function name required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const mod = await import(`${FUNCTION_DIR}/${functionName}/index.ts`);
    if (typeof mod.default === "function") {
      return await mod.default(req);
    }
    return new Response(JSON.stringify({ error: "Function has no default export" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Function "${functionName}" not found: ${err}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
});
