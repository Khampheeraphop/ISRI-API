import { assertEquals } from "jsr:@std/assert";
import type { DatabaseClient } from "../supabase/functions/isri-api/_shared/types.ts";
import { LocationRepository } from "../supabase/functions/isri-api/repositories/locationRepository.ts";

function repositoryWithUsage({
  incidents = 0,
  schedules = 0,
  mapLocationIds = [],
}: {
  incidents?: number;
  schedules?: number;
  mapLocationIds?: string[];
}) {
  const db = {
    from(table: string) {
      return {
        select(_columns: string, options?: { head?: boolean }) {
          if (table === "floor_plans") {
            return Promise.resolve({
              data: [
                {
                  layout: {
                    elements: mapLocationIds.map((locationId) => ({
                      locationId,
                    })),
                  },
                },
              ],
              error: null,
            });
          }
          return {
            eq() {
              return Promise.resolve({
                data: options?.head ? null : [],
                count: table === "incidents" ? incidents : schedules,
                error: null,
              });
            },
          };
        },
      };
    },
  } as unknown as DatabaseClient;

  return new LocationRepository(db);
}

Deno.test(
  "location usage protects QR codes referenced by operations or a floor plan",
  async () => {
    const locationId = "11111111-1111-4111-8111-111111111111";

    assertEquals(await repositoryWithUsage({}).isInUse(locationId), false);
    assertEquals(
      await repositoryWithUsage({ incidents: 1 }).isInUse(locationId),
      true,
    );
    assertEquals(
      await repositoryWithUsage({ schedules: 1 }).isInUse(locationId),
      true,
    );
    assertEquals(
      await repositoryWithUsage({ mapLocationIds: [locationId] }).isInUse(
        locationId,
      ),
      true,
    );
  },
);
