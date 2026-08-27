import { assertEquals } from "jsr:@std/assert";
import { optionsResponse } from "../supabase/functions/isri-api/_shared/http.ts";

Deno.test("CORS preflight supports browser clients from production and local development", () => {
  const response = optionsResponse();

  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    "GET, POST, PATCH, DELETE, OPTIONS",
  );
  assertEquals(
    response.headers.get("Access-Control-Allow-Headers"),
    "authorization, x-client-info, apikey, content-type",
  );
});
