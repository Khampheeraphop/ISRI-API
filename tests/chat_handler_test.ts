import { assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createChatHandler } from "../supabase/functions/isri-chat/handler.ts";

const actor = "10000000-0000-4000-8000-000000000001";
function setup(
  options: { invalid?: boolean; pending?: boolean; configured?: boolean } = {},
) {
  let modelCalls = 0;
  const client = createClient("https://fixture.invalid", "fixture-key", {
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/auth/v1/user"))
          return options.invalid
            ? Response.json({ message: "invalid" }, { status: 401 })
            : Response.json({ id: actor });
        if (url.pathname.endsWith("/profiles"))
          return Response.json([
            {
              id: actor,
              role: "reporter",
              approval_status: options.pending ? "pending" : "approved",
            },
          ]);
        throw new Error(`Unexpected database access: ${url.pathname}`);
      },
    },
  });
  const env: Record<string, string> = {
    SUPABASE_URL: "https://fixture.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-key",
    ...(options.configured === false
      ? {}
      : { GEMINI_API_KEY: "fixture", GEMINI_CHAT_MODEL: "fixture-model" }),
  };
  const handler = createChatHandler({
    env: (key) => env[key],
    client: (() => client) as typeof createClient,
    generate: () => async () => {
      modelCalls++;
      return { mode: "out_of_scope", queries: [] };
    },
  });
  const post = (
    body: unknown = { messages: [{ role: "user", text: "คำถามนอกระบบ" }] },
    auth = true,
  ) =>
    handler(
      new Request("https://fixture.invalid/functions/v1/isri-chat", {
        method: "POST",
        headers: auth
          ? {
              Authorization: "Bearer fixture-user-token",
              "Content-Type": "application/json",
            }
          : {},
        body: JSON.stringify(body),
      }),
    );
  return { handler, post, modelCalls: () => modelCalls };
}

Deno.test(
  "chat endpoint rejects missing/invalid JWT and unapproved users before AI",
  async () => {
    for (const [options, auth, expected] of [
      [{}, false, 401],
      [{ invalid: true }, true, 401],
      [{ pending: true }, true, 403],
    ] as const) {
      const context = setup(options);
      assertEquals((await context.post(undefined, auth)).status, expected);
      assertEquals(context.modelCalls(), 0);
    }
  },
);

Deno.test("chat endpoint rejects spoofed identity", async () => {
  const spoofed = setup();
  assertEquals(
    (
      await spoofed.post({
        userId: actor,
        role: "admin",
        messages: [{ role: "user", text: "hello" }],
      })
    ).status,
    400,
  );
  assertEquals(spoofed.modelCalls(), 0);
});

Deno.test(
  "chat endpoint reports missing configuration and supports approved account",
  async () => {
    const unavailable = setup({ configured: false });
    assertEquals((await unavailable.post()).status, 503);
    assertEquals(unavailable.modelCalls(), 0);
    const ready = setup();
    assertEquals((await ready.post()).status, 200);
    assertEquals(ready.modelCalls(), 1);
    assertEquals(
      (
        await ready.handler(
          new Request("https://fixture.invalid", { method: "OPTIONS" }),
        )
      ).status,
      204,
    );
  },
);
