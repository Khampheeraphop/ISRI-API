const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("WEB_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
export const error = (message: string, status = 400) =>
  json({ error: message }, status);
export const optionsResponse = () =>
  new Response(null, { status: 204, headers: corsHeaders });

export function parsePath(req: Request) {
  const url = new URL(req.url);
  const marker = "/isri-api";
  const index = url.pathname.indexOf(marker);
  return {
    pathname:
      index >= 0
        ? url.pathname.slice(index + marker.length) || "/"
        : url.pathname,
    url,
  };
}

export async function parseJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
