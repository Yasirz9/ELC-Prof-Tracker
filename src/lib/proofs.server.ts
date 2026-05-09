import { supabaseAdmin } from "@/integrations/supabase/client.server";

export { supabaseAdmin };

export type AdminCtx = {
  userId: string;
  role: "admin" | "super_admin";
  region: "MTR" | "FTR" | null;
};

export async function requireAdmin(accessToken: string): Promise<AdminCtx> {
  if (!accessToken) throw new Error("Unauthorized");
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Unauthorized");
  const userId = data.user.id;
  const { data: rows, error: rErr } = await supabaseAdmin
    .from("user_roles")
    .select("role, region")
    .eq("user_id", userId)
    .in("role", ["admin", "super_admin"]);
  if (rErr) throw new Error(rErr.message);
  if (!rows || rows.length === 0) throw new Error("Forbidden: admin access required.");
  const sup = rows.find((r) => r.role === "super_admin");
  if (sup) return { userId, role: "super_admin", region: null };
  const adm = rows[0];
  return {
    userId,
    role: "admin",
    region: (adm.region as "MTR" | "FTR" | null) ?? null,
  };
}

export function scopeRegion(
  ctx: AdminCtx,
  requested?: "MTR" | "FTR",
): "MTR" | "FTR" | undefined {
  if (ctx.region) {
    if (requested && requested !== ctx.region) {
      throw new Error("Forbidden: outside your region.");
    }
    return ctx.region;
  }
  return requested;
}

export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "_");
}

export function dateFolder(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${day} ${month}`;
}

export function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "application/pdf") return "pdf";
  return "bin";
}
