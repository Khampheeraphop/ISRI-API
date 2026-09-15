import { createClient } from "npm:@supabase/supabase-js@2";
import { HttpError, json, optionsResponse } from "../isri-api/_shared/http.ts";
import { allowedRoles, type AppRole } from "../isri-api/_shared/types.ts";
import { parseMessages } from "./policy.ts";
import { ChatRepository } from "./repository.ts";
import { answerChat, geminiGenerator } from "./service.ts";

async function boundedJson(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError("กรุณาระบุข้อความ");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 100000) {
      await reader.cancel();
      throw new HttpError("ข้อความยาวเกินไป", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError("รูปแบบข้อความไม่ถูกต้อง");
  }
}

export function createChatHandler(deps: {
  env: (key: string) => string | undefined;
  client: typeof createClient;
  generate?: typeof geminiGenerator;
}) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return optionsResponse();
    try {
      if (!["GET", "POST"].includes(req.method))
        throw new HttpError("Method not allowed", 405);
      const token = req.headers.get("Authorization");
      if (!token?.startsWith("Bearer "))
        throw new HttpError("กรุณาเข้าสู่ระบบ", 401);
      const url = deps.env("SUPABASE_URL"),
        key = deps.env("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !key) throw new HttpError("ระบบยังไม่พร้อมใช้งาน", 503);
      const db = deps.client(url, key, { auth: { persistSession: false } });
      const auth = await db.auth.getUser(token.slice(7));
      if (auth.error || !auth.data.user)
        throw new HttpError("กรุณาเข้าสู่ระบบใหม่", 401);
      const profile = await db
        .from("profiles")
        .select("id,role,approval_status")
        .eq("id", auth.data.user.id)
        .maybeSingle();
      if (profile.error) throw new HttpError("ตรวจสิทธิ์ไม่สำเร็จ", 503);
      if (
        profile.data?.approval_status !== "approved" ||
        !allowedRoles.has(profile.data.role)
      )
        throw new HttpError("บัญชีนี้ยังไม่มีสิทธิ์ใช้ผู้ช่วย", 403);
      const apiKey = deps.env("GEMINI_API_KEY")?.trim() ?? "";
      const model = deps.env("GEMINI_CHAT_MODEL")?.trim() ?? "";
      const enabled =
        deps.env("ISRI_CHAT_ENABLED") !== "false" &&
        Boolean(apiKey && /^[a-zA-Z0-9._-]+$/.test(model));
      if (req.method === "GET") return json({ data: { enabled } });
      if (!enabled)
        throw new HttpError(
          "ผู้ช่วย AI ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
          503,
        );
      const messages = parseMessages(await boundedJson(req));
      const repo = new ChatRepository(
        db,
        auth.data.user.id,
        profile.data.role as AppRole,
      );
      const reply = await answerChat({
        role: profile.data.role as AppRole,
        messages,
        generate: (deps.generate ?? geminiGenerator)(apiKey, model),
        read: (q) => repo.read(q),
      });
      return json({ data: reply });
    } catch (cause) {
      if (cause instanceof HttpError)
        return json({ error: cause.message }, cause.status);
      // Never log chat text, database rows, tokens, or provider response bodies.
      console.error("ISRI chat request failed");
      return json(
        { error: "ผู้ช่วยไม่สามารถตอบได้ในขณะนี้ กรุณาลองใหม่" },
        500,
      );
    }
  };
}
