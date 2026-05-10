import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin, requireSuperAdminUserId } from "@/lib/proofs.server";

export const whoAmI = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => input)
  .handler(async ({ data }) => {
    const { data: u, error } = await supabaseAdmin.auth.getUser(data.accessToken);
    if (error || !u.user) throw new Error("Unauthorized");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role, region")
      .eq("user_id", u.user.id);
    const sup = (roles ?? []).find((r) => r.role === "super_admin");
    if (sup) return { role: "super_admin" as const, region: null as null, email: u.user.email };
    const adm = (roles ?? []).find((r) => r.role === "admin");
    if (adm)
      return {
        role: "admin" as const,
        region: (adm.region as "MTR" | "FTR" | "SLTR" | "CTR" | "GTR" | "LTR" | null) ?? null,
        email: u.user.email,
      };
    return { role: null, region: null as null, email: u.user.email };
  });

export const listUsers = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => input)
  .handler(async ({ data }) => {
    await requireSuperAdminUserId(data.accessToken);
    const { data: roleRows, error } = await supabaseAdmin
      .from("user_roles")
      .select("id, user_id, role, region");
    if (error) throw new Error(error.message);
    const userIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
    const users: { id: string; email: string | null }[] = [];
    for (const uid of userIds) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
      if (u?.user) users.push({ id: u.user.id, email: u.user.email ?? null });
    }
    const map = new Map(users.map((u) => [u.id, u.email]));
    return {
      users: (roleRows ?? []).map((r) => ({
        roleId: r.id,
        userId: r.user_id,
        email: map.get(r.user_id) ?? "(unknown)",
        role: r.role,
        region: r.region,
      })),
    };
  });

export const createUser = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        accessToken: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(6).max(72),
        region: z.enum(["MTR","FTR","SLTR","CTR","GTR","LTR","ALL"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireSuperAdminUserId(data.accessToken);
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create user");
    const region = data.region === "ALL" ? null : data.region;
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({
      user_id: created.user.id,
      role: "admin",
      region,
    });
    if (rErr) throw new Error(rErr.message);
    return { ok: true, userId: created.user.id };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; userId: string }) => input)
  .handler(async ({ data }) => {
    const me = await requireSuperAdminUserId(data.accessToken);
    if (data.userId === me) throw new Error("Cannot delete yourself.");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateUserRegion = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { accessToken: string; userId: string; region: "MTR" | "FTR" | "SLTR" | "CTR" | "GTR" | "LTR" | "ALL" }) => input,
  )
  .handler(async ({ data }) => {
    await requireSuperAdminUserId(data.accessToken);
    const region = data.region === "ALL" ? null : data.region;
    const { error } = await supabaseAdmin
      .from("user_roles")
      .update({ region })
      .eq("user_id", data.userId)
      .eq("role", "admin");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
