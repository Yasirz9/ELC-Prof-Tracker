import { supabaseAdmin } from "@/integrations/supabase/client.server";

export { supabaseAdmin };

export async function requireSuperAdminUser(accessToken: string): Promise<string> {
  if (!accessToken) throw new Error("Unauthorized");
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Unauthorized");
  const { data: rows } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "super_admin")
    .maybeSingle();
  if (!rows) throw new Error("Forbidden: super admin only.");
  return data.user.id;
}
