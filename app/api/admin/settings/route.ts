import { ok, parseBody } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { recordAdminAction, requestIp } from "@/lib/server/audit";
import { getSettings, updateSettings } from "@/lib/server/settings";
import { settingsPatchSchema } from "@/lib/validation/admin-schemas";

// GET /api/admin/settings -> SystemSettings
export async function GET() {
  const auth = await requireStaff("admin");
  if ("response" in auth) return auth.response;
  return ok(await getSettings());
}

// PATCH /api/admin/settings -> SystemSettings
export async function PATCH(request: Request) {
  const auth = await requireStaff("admin");
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, settingsPatchSchema);
  if ("response" in parsed) return parsed.response;

  const before = await getSettings();
  const after = await updateSettings(parsed.data, auth.uid);

  const changed = Object.keys(parsed.data).filter(
    (k) => before[k as keyof typeof before] !== after[k as keyof typeof after]
  );
  if (changed.length > 0) {
    await recordAdminAction({
      actorUserId: auth.uid,
      action: "setting.update",
      targetType: "setting",
      targetId: changed.join(","),
      summary: `Changed ${changed.join(", ")}`,
      metadata: { before, after },
      ip: requestIp(request),
    });
  }

  return ok(after);
}
