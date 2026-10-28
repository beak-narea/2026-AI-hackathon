import { cookies } from "next/headers";
import { route } from "@/lib/api/handler";
import { DEMO_COOKIE } from "@/lib/supabase/server";

export const POST = route(async () => {
  const store = await cookies();
  store.delete(DEMO_COOKIE);
  return { ok: true };
}, { auth: false });
