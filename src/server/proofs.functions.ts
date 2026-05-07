import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  buildStoragePath,
  validateMdn,
  type Region,
} from "@/lib/proof-utils";
import { zipSync, strToU8 } from "fflate";

// ---------- Public: lookup customer ----------
export const getCustomerByMdn = createServerFn({ method: "POST" })
  .inputValidator((input: { mdn: string }) => {
    const err = validateMdn(input.mdn);
    if (err) throw new Error(err);
    return input;
  })
  .handler(async ({ data }) => {
    const { data: customer, error } = await supabaseAdmin
      .from("customers")
      .select("mdn, name, region, exchange_id, executive_sales, due_amount, discount")
      .eq("mdn", data.mdn)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!customer) return { customer: null as null };
    return { customer };
  });

// ---------- Public: upload proof ----------
const uploadSchema = z.object({
  mdn: z.string().regex(/^\d{10,15}$/),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  size: z.number().int().positive().max(MAX_FILE_SIZE),
  fileBase64: z.string().min(1),
  amountPaid: z.number().nonnegative(),
});

export const uploadProof = createServerFn({ method: "POST" })
  .inputValidator((input) => uploadSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: customer, error: cErr } = await supabaseAdmin
      .from("customers")
      .select("mdn, region, exchange_id, executive_sales")
      .eq("mdn", data.mdn)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!customer) throw new Error("Customer not found for this MDN.");

    const buffer = Buffer.from(data.fileBase64, "base64");
    if (buffer.byteLength !== data.size) throw new Error("File size mismatch.");
    if (buffer.byteLength > MAX_FILE_SIZE) throw new Error("File too large.");

    const storagePath = buildStoragePath(
      customer.region as Region,
      customer.exchange_id,
      customer.mdn,
      data.mimeType,
    );

    const { error: upErr } = await supabaseAdmin.storage
      .from("payment-proofs")
      .upload(storagePath, buffer, { contentType: data.mimeType, upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { error: dbErr } = await supabaseAdmin
      .from("payment_proofs")
      .upsert(
        {
          mdn: customer.mdn,
          region: customer.region,
          exchange_id: customer.exchange_id,
          executive_sales: customer.executive_sales ?? null,
          storage_path: storagePath,
          mime_type: data.mimeType,
          size_bytes: buffer.byteLength,
          amount_paid: data.amountPaid,
          uploaded_at: new Date().toISOString(),
        },
        { onConflict: "mdn" },
      );
    if (dbErr) throw new Error(dbErr.message);

    return { ok: true, storagePath };
  });

// ---------- Admin auth helper ----------
async function requireAdmin(accessToken: string): Promise<string> {
  if (!accessToken) throw new Error("Unauthorized");
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Unauthorized");
  const userId = data.user.id;
  const { data: roleRow, error: rErr } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (rErr) throw new Error(rErr.message);
  if (!roleRow) throw new Error("Forbidden: admin access required.");
  return userId;
}

// ---------- Admin: list proofs ----------
const listSchema = z.object({
  accessToken: z.string().min(1),
  region: z.enum(["MTR", "FTR"]).optional(),
  exchangeId: z.string().min(1).max(64).optional(),
  executiveSales: z.string().min(1).max(128).optional(),
  search: z.string().min(1).max(64).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const listProofs = createServerFn({ method: "POST" })
  .inputValidator((input) => listSchema.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.accessToken);
    let query = supabaseAdmin
      .from("payment_proofs")
      .select(
        "id, mdn, region, exchange_id, executive_sales, storage_path, mime_type, size_bytes, amount_paid, uploaded_at",
      )
      .order("uploaded_at", { ascending: false });
    if (data.region) query = query.eq("region", data.region);
    if (data.exchangeId) query = query.eq("exchange_id", data.exchangeId);
    if (data.executiveSales) query = query.eq("executive_sales", data.executiveSales);
    if (data.search) query = query.ilike("mdn", `%${data.search}%`);
    if (data.fromDate) query = query.gte("uploaded_at", data.fromDate);
    if (data.toDate) query = query.lte("uploaded_at", data.toDate);
    const { data: rows, error } = await query.limit(1000);
    if (error) throw new Error(error.message);
    return { proofs: rows ?? [] };
  });

// ---------- Admin: stats by Executive Sales ----------
const statsSchema = z.object({
  accessToken: z.string().min(1),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const getExecutiveStats = createServerFn({ method: "POST" })
  .inputValidator((input) => statsSchema.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.accessToken);
    let q = supabaseAdmin
      .from("payment_proofs")
      .select("executive_sales, amount_paid, uploaded_at");
    if (data.fromDate) q = q.gte("uploaded_at", data.fromDate);
    if (data.toDate) q = q.lte("uploaded_at", data.toDate);
    const { data: rows, error } = await q.limit(5000);
    if (error) throw new Error(error.message);
    const agg = new Map<string, { count: number; total: number }>();
    let totalCount = 0;
    let totalAmount = 0;
    for (const r of rows ?? []) {
      const key = r.executive_sales || "(Unassigned)";
      const cur = agg.get(key) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(r.amount_paid ?? 0);
      agg.set(key, cur);
      totalCount += 1;
      totalAmount += Number(r.amount_paid ?? 0);
    }
    const stats = Array.from(agg.entries())
      .map(([executive_sales, v]) => ({ executive_sales, count: v.count, total: v.total }))
      .sort((a, b) => b.count - a.count);
    return { stats, totalCount, totalAmount };
  });

// ---------- Admin: signed URL ----------
const signSchema = z.object({
  accessToken: z.string().min(1),
  storagePath: z.string().min(1).max(512),
});

export const getSignedUrl = createServerFn({ method: "POST" })
  .inputValidator((input) => signSchema.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.accessToken);
    const { data: signed, error } = await supabaseAdmin.storage
      .from("payment-proofs")
      .createSignedUrl(data.storagePath, 60 * 5);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

// ---------- Admin: bulk ZIP ----------
const zipSchema = z.object({
  accessToken: z.string().min(1),
  region: z.enum(["MTR", "FTR"]).optional(),
  exchangeId: z.string().min(1).max(64).optional(),
  executiveSales: z.string().min(1).max(128).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const getBulkZip = createServerFn({ method: "POST" })
  .inputValidator((input) => zipSchema.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.accessToken);

    let q = supabaseAdmin
      .from("payment_proofs")
      .select("storage_path, region, exchange_id, executive_sales, mdn, mime_type");
    if (data.region) q = q.eq("region", data.region);
    if (data.exchangeId) q = q.eq("exchange_id", data.exchangeId);
    if (data.executiveSales) q = q.eq("executive_sales", data.executiveSales);
    if (data.fromDate) q = q.gte("uploaded_at", data.fromDate);
    if (data.toDate) q = q.lte("uploaded_at", data.toDate);
    const { data: rows, error } = await q.limit(2000);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) throw new Error("No files match this scope.");

    const files: Record<string, Uint8Array> = {};
    for (const row of rows) {
      const { data: blob, error: dErr } = await supabaseAdmin.storage
        .from("payment-proofs")
        .download(row.storage_path);
      if (dErr || !blob) continue;
      files[row.storage_path] = new Uint8Array(await blob.arrayBuffer());
    }
    if (Object.keys(files).length === 0) throw new Error("Failed to fetch files.");

    files["_manifest.txt"] = strToU8(
      rows
        .map(
          (r) =>
            `${r.storage_path}\tMDN=${r.mdn}\tregion=${r.region}\texchange=${r.exchange_id}\texecutive=${r.executive_sales ?? ""}`,
        )
        .join("\n"),
    );

    const zipped = zipSync(files, { level: 6 });
    const base64 = Buffer.from(zipped).toString("base64");
    return { base64, count: rows.length };
  });

// ---------- Admin: import customers from CSV ----------
const importSchema = z.object({
  accessToken: z.string().min(1),
  rows: z
    .array(
      z.object({
        mdn: z.string().regex(/^\d{10,15}$/),
        name: z.string().min(1).max(200),
        region: z.enum(["MTR", "FTR"]),
        exchange_id: z.string().min(1).max(64),
        executive_sales: z.string().max(128).optional().nullable(),
        due_amount: z.number().nonnegative().optional(),
        discount: z.number().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(5000),
});

export const importCustomers = createServerFn({ method: "POST" })
  .inputValidator((input) => importSchema.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.accessToken);
    const payload = data.rows.map((r) => ({
      mdn: r.mdn,
      name: r.name,
      region: r.region,
      exchange_id: r.exchange_id,
      executive_sales: r.executive_sales || null,
      due_amount: r.due_amount ?? 0,
      discount: r.discount ?? 0,
    }));
    const { error } = await supabaseAdmin
      .from("customers")
      .upsert(payload, { onConflict: "mdn" });
    if (error) throw new Error(error.message);

    // Also propagate executive_sales updates onto existing payment_proofs rows
    for (const r of payload) {
      if (r.executive_sales !== null) {
        await supabaseAdmin
          .from("payment_proofs")
          .update({ executive_sales: r.executive_sales })
          .eq("mdn", r.mdn);
      }
    }

    return { ok: true, count: payload.length };
  });
