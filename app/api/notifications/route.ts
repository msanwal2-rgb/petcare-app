import { listNotifications, markRead, unreadCount } from "@/lib/server/notifications";
import { ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { markReadSchema } from "@/lib/validation/schemas";

// GET /api/notifications -> { items, unread } — your own, newest first.
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const [items, unread] = await Promise.all([
    listNotifications(auth.uid),
    unreadCount(auth.uid),
  ]);
  return ok({ items, unread });
}

// POST /api/notifications -> { unread }
//
// Marks one notification read, or all of them when no id is given. Scoped to
// your own either way, so an id you don't own simply matches nothing.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, markReadSchema);
  if ("response" in parsed) return parsed.response;

  await markRead(auth.uid, parsed.data.id);
  return ok({ unread: await unreadCount(auth.uid) });
}
