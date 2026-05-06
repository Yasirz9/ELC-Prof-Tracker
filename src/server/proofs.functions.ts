import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
      .select("mdn, name, region, exchange_id")
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
});

export const uploadProof = createServerFn({ method: "POST" })
  .inputValidator((input) => uploadSchema.parse(input))
  .handler(async ({ data }) => {
    // Verify the customer exists
    const { data: customer, error: cErr } = await supabaseAdmin
      .from("customers")
      .select("mdn, region, exchange_id")
      .eq("mdn", data.mdn)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!customer) throw new Error("Customer not found for this MDN.");

    const buffer = Buffer.from(data.fileBase64, "base64");
    if (buffer.byteLength !== data.size) {
      throw new Error("File size mismatch.");
    }
    if (buffer.byteLength > MAX_FILE_SIZE) {
      throw new Error("File too large.");
    }

    const storagePath = buildStoragePath(
      customer.region as Region,
      customer.exchange_id,
      customer.mdn,
      data.mimeType,
    );

    const { error: upErr } = await supabaseAdmin.storage
      .from("payment-proofs")
      .upload(storagePath, buffer, {
        contentType: data.mimeType,
        upsert: true,
      });
    if (upErr) throw new Error(upErr.message);

    // Upsert the proof record (uniqueness on mdn)
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
          uploaded_at: new Date().toISOString(),
        },
        { onConflict: "mdn" },
      );
    if (dbErr) throw new Error(dbErr.message);

    return { ok: true, storagePath };
  });

// ---------- Admin helpers ----------
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin access required.");
}

// ---------- Admin: list proofs ----------
export const listProofs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { region?: Region; exchangeId?: string; search?: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    let query = supabaseAdmin
      .from("payment_proofs")
      .select("id, mdn, region, exchange_id, storage_path, mime_type, size_bytes, uploaded_at")
      .order("uploaded_at", { ascending: false });
    if (data.region) query = query.eq("region", data.region);
    if (data.exchangeId) query = query.eq("exchange_id", data.exchangeId);
    if (data.search) query = query.ilike("mdn", `%${data.search}%`);
    const { data: rows, error } = await query.limit(1000);
    if (error) throw new Error(error.message);
    return { proofs: rows ?? [] };
  });

// ---------- Admin: signed URL for one file ----------
export const getSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { storagePath: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: signed, error } = await supabaseAdmin.storage
      .from("payment-proofs")
      .createSignedUrl(data.storagePath, 60 * 5);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

// ---------- Admin: bulk ZIP download ----------
const zipScopeSchema = z.object({
  region: z.enum(["MTR", "FTR"]).optional(),
  exchangeId: z.string().min(1).max(64).optional(),
});

export const getBulkZip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => zipScopeSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    let q = supabaseAdmin
      .from("payment_proofs")
      .select("storage_path, region, exchange_id, mdn, mime_type");
    if (data.region) q = q.eq("region", data.region);
    if (data.exchangeId) q = q.eq("exchange_id", data.exchangeId);
    const { data: rows, error } = await q.limit(2000);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) {
      throw new Error("No files match this scope.");
    }

    const files: Record<string, Uint8Array> = {};
    for (const row of rows) {
      const { data: blob, error: dErr } = await supabaseAdmin.storage
        .from("payment-proofs")
        .download(row.storage_path);
      if (dErr || !blob) continue;
      const buf = new Uint8Array(await blob.arrayBuffer());
      files[row.storage_path] = buf;
    }
    if (Object.keys(files).length === 0) {
      throw new Error("Failed to fetch files.");
    }

    files["_manifest.txt"] = strToU8(
      rows
        .map((r) => `${r.storage_path}\tMDN=${r.mdn}\tregion=${r.region}\texchange=${r.exchange_id}`)
        .join("\n"),
    );

    const zipped = zipSync(files, { level: 6 });
    const base64 = Buffer.from(zipped).toString("base64");
    return { base64, count: rows.length };
  });
