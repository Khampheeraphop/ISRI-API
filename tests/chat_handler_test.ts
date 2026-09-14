import { assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createChatHandler } from "../supabase/functions/isri-chat/handler.ts";

const actor = "10000000-0000-4000-8000-000000000001";
function setup(options: { invalid?: boolean; pending?: boolean; quota?: boolean; configured?: boolean } = {}) {
  let modelCalls = 0;
  const calls: string[] = [];
  const client = createClient("https://fixture.invalid", "fixture-key", { global: { fetch: async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    if (url.pathname.endsWith("/auth/v1/user")) return options.invalid ? Response.json({ message: "invalid" }, { status: 401 }) : Response.json({ id: actor });
    if (url.pathname.endsWith("/profiles")) return Response.json([{ id: actor, role: "reporter", approval_status: options.pending ? "pending" : "approved" }]);
    if (url.pathname.endsWith("/consume_isri_chat_quota")) {
      assertEquals(JSON.parse(String(init?.body)), { p_user_id: actor });
      return Response.json(options.quota !== false);
    }
    throw new Error(`Unexpected database access: ${url.pathname}`);
  } } });
  const env: Record<string, string> = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-key", ...(options.configured === false ? {} : { GEMINI_API_KEY: "fixture", GEMINI_CHAT_MODEL: "fixture-model" }) };
  const handler = createChatHandler({ env: (key) => env[key], client: (() => client) as typeof createClient,
    generate: () => async () => { modelCalls++; return { mode: "out_of_scope", queries: [] }; },
  });
  const post = (body: unknown = { messages: [{ role: "user", text: "คำถามนอกระบบ" }] }, auth = true) => handler(new Request("https://fixture.invalid/functions/v1/isri-chat", { method: "POST", headers: auth ? { Authorization: "Bearer fixture-user-token", "Content-Type": "application/json" } : {}, body: JSON.stringify(body) }));
  return { handler, post, calls, modelCalls: () => modelCalls };
}

Deno.test("chat endpoint rejects missing/invalid JWT and unapproved users before AI or quota", async () => {
  for (const [options, auth, expected] of [[{}, false, 401], [{ invalid: true }, true, 401], [{ pending: true }, true, 403]] as const) {
    const context = setup(options);
    assertEquals((await context.post(undefined, auth)).status, expected);
    assertEquals(context.modelCalls(), 0);
    assertEquals(context.calls.some((call) => call.includes("quota")), false);
  }
});

Deno.test("chat endpoint rejects spoofed identity and stops on exhausted quota", async () => {
  const spoofed = setup();
  assertEquals((await spoofed.post({ userId: actor, role: "admin", messages: [{ role: "user", text: "hello" }] })).status, 400);
  assertEquals(spoofed.modelCalls(), 0);
  const limited = setup({ quota: false });
  assertEquals((await limited.post()).status, 429);
  assertEquals(limited.modelCalls(), 0);
});

Deno.test("chat endpoint reports missing configuration and supports approved account", async () => {
  const unavailable = setup({ configured: false });
  assertEquals((await unavailable.post()).status, 503);
  assertEquals(unavailable.modelCalls(), 0);
  const ready = setup();
  assertEquals((await ready.post()).status, 200);
  assertEquals(ready.modelCalls(), 1);
  assertEquals((await ready.handler(new Request("https://fixture.invalid", { method: "OPTIONS" }))).status, 204);
});
