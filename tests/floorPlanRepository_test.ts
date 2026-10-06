import { assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { FloorPlanRepository } from "../supabase/functions/isri-api/repositories/floorPlanRepository.ts";

type Row = Record<string, unknown>;

function fixture() {
  const plans: Row[] = [];
  const versions: Row[] = [];
  const db = createClient("http://fixture.invalid", "fixture-key", {
    global: {
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const table = url.pathname.split("/").pop()!;
        const source = table === "floor_plans" ? plans : versions;

        if (request.method === "GET") {
          let rows = [...source];
          const id = url.searchParams.get("id")?.replace(/^eq\./, "");
          if (id) rows = rows.filter((row) => row.id === id);
          const response = request.headers.get("accept")?.includes("vnd.pgrst.object")
            ? rows[0] ?? null
            : rows;
          return Response.json(response);
        }

        const rawBody = await request.json() as Row | Row[];
        const body = Array.isArray(rawBody) ? rawBody[0] : rawBody;
        if (request.method === "POST") {
          const row = {
            id: body.id ?? `${table}-${source.length + 1}`,
            created_at: "2026-10-06T00:00:00Z",
            updated_at: "2026-10-06T00:00:00Z",
            ...body,
          };
          source.push(row);
          const response = request.headers.get("accept")?.includes("vnd.pgrst.object")
            ? row
            : [row];
          return Response.json(response, { status: 201 });
        }

        if (request.method === "PATCH") {
          const id = url.searchParams.get("id")?.replace(/^eq\./, "");
          const row = source.find((candidate) => candidate.id === id)!;
          Object.assign(row, body);
          const response = request.headers.get("accept")?.includes("vnd.pgrst.object")
            ? row
            : [row];
          return Response.json(response);
        }

        return Response.json({ message: "unsupported fixture request" }, { status: 500 });
      },
    },
  });
  return { repo: new FloorPlanRepository(db), plans, versions };
}

Deno.test("floor plan save creates a version snapshot and increments it on edit", async () => {
  const { repo, plans, versions } = fixture();
  const first = await repo.save({
    building: "อาคาร A",
    floor: "ชั้น 1",
    name: "แผนผังชั้น 1",
    canvasWidth: 1600,
    canvasHeight: 1000,
    layout: { elements: [] },
    background: null,
    isPublished: false,
    userId: "admin-1",
  });

  assertEquals(first.version, 1);
  assertEquals(plans.length, 1);
  assertEquals(versions.map((row) => row.version), [1]);

  const second = await repo.save({
    id: String(first.id),
    building: "อาคาร A",
    floor: "ชั้น 1",
    name: "แผนผังชั้น 1",
    canvasWidth: 1600,
    canvasHeight: 1000,
    layout: {
      elements: [{
        id: "room-1",
        type: "room",
        name: "ห้องตรวจ",
        x: 10,
        y: 10,
        width: 30,
        height: 20,
        color: "#EDE9FE",
        locationId: null,
        parentId: null,
      }],
    },
    background: null,
    isPublished: true,
    userId: "admin-1",
  });

  assertEquals(second.version, 2);
  assertEquals(second.is_published, true);
  assertEquals(versions.map((row) => row.version), [1, 2]);
  assertEquals(versions[1].is_published, true);
});
