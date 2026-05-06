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
      .select("mdn, name, region, exchange_id, due_amount, discount")
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
      .select("mdn, region, exchange_id")
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
      .select("id, mdn, region, exchange_id, storage_path, mime_type, size_bytes, uploaded_at")
      .order("uploaded_at", { ascending: false });
    if (data.region) query = query.eq("region", data.region);
    if (data.exchangeId) query = query.eq("exchange_id", data.exchangeId);
    if (data.search) query = query.ilike("mdn", `%${data.search}%`);
    if (data.fromDate) query = query.gte("uploaded_at", data.fromDate);
    if (data.toDate) query = query.lte("uploaded_at", data.toDate);
    const { data: rows, error } = await query.limit(1000);
    if (error) throw new Error(error.message);
    return { proofs: rows ?? [] };
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
});

export const getBulkZip = createServerFn({ method: "POST" })
  .inputValidator((input) => zipSchema.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.accessToken);

    let q = supabaseAdmin
      .from("payment_proofs")
      .select("storage_path, region, exchange_id, mdn, mime_type");
    if (data.region) q = q.eq("region", data.region);
    if (data.exchangeId) q = q.eq("exchange_id", data.exchangeId);
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
        .map((r) => `${r.storage_path}\tMDN=${r.mdn}\tregion=${r.region}\texchange=${r.exchange_id}`)
        .join("\n"),
    );

    const zipped = zipSync(files, { level: 6 });
    const base64 = Buffer.from(zipped).toString("base64");
    return { base64, count: rows.length };
  });
