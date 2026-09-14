import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createChatHandler } from "./handler.ts";

Deno.serve(
  createChatHandler({ env: (key) => Deno.env.get(key), client: createClient }),
);
