import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  supabaseAdmin,
  requireAdmin,
  scopeRegion,
  safeName,
  dateFolder,
  extFromMime,
} from "@/lib/proofs.server";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  buildStoragePath,
  validateMdn,
  type Region,
} from "@/lib/proof-utils";
import { zipSync } from "fflate";

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
    if (!customer) return { customer: null as null, existingProof: null as null };
    const { data: existing } = await supabaseAdmin
      .from("payment_proofs")
      .select("uploaded_at")
      .eq("mdn", data.mdn)
      .maybeSingle();
    return {
      customer,
      existingProof: existing ? { uploaded_at: existing.uploaded_at } : null,
    };
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

// ---------- Admin: list proofs ----------
const listSchema = z.object({
  accessToken: z.string().min(1),
  region: z.enum(["MTR","FTR","SLTR","CTR","GTR","LTR"]).optional(),
  exchangeId: z.string().min(1).max(64).optional(),
  executiveSales: z.string().min(1).max(128).optional(),
  search: z.string().min(1).max(64).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const listProofs = createServerFn({ method: "POST" })
  .inputValidator((input) => listSchema.parse(input))
  .handler(async ({ data }) => {
    const ctx = await requireAdmin(data.accessToken);
    const effRegion = scopeRegion(ctx, data.region);
    let query = supabaseAdmin
      .from("payment_proofs")
      .select(
        "id, mdn, region, exchange_id, executive_sales, storage_path, mime_type, size_bytes, amount_paid, uploaded_at",
      )
      .order("uploaded_at", { ascending: false });
    if (effRegion) query = query.eq("region", effRegion);
    if (data.exchangeId) query = query.eq("exchange_id", data.exchangeId);
    if (data.executiveSales) query = query.eq("executive_sales", data.executiveSales);
    if (data.search) query = query.ilike("mdn", `%${data.search}%`);
    if (data.fromDate) query = query.gte("uploaded_at", data.fromDate);
    if (data.toDate) query = query.lte("uploaded_at", data.toDate);
    const { data: rows, error } = await query.limit(2000);
    if (error) throw new Error(error.message);
    return { proofs: rows ?? [], scope: { region: ctx.region, role: ctx.role } };
  });

// ---------- Admin: stats by Executive Sales ----------
const statsSchema = z.object({
  accessToken: z.string().min(1),
  region: z.enum(["MTR","FTR","SLTR","CTR","GTR","LTR"]).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const getExecutiveStats = createServerFn({ method: "POST" })
  .inputValidator((input) => statsSchema.parse(input))
  .handler(async ({ data }) => {
    const ctx = await requireAdmin(data.accessToken);
    const effRegion = scopeRegion(ctx, data.region);
    let q = supabaseAdmin
      .from("payment_proofs")
      .select("executive_sales, region, amount_paid, uploaded_at");
    if (effRegion) q = q.eq("region", effRegion);
    if (data.fromDate) q = q.gte("uploaded_at", data.fromDate);
    if (data.toDate) q = q.lte("uploaded_at", data.toDate);
    const { data: rows, error } = await q.limit(10000);
    if (error) throw new Error(error.message);
    const agg = new Map<string, { count: number; total: number; region: string }>();
    let totalCount = 0;
    let totalAmount = 0;
    for (const r of rows ?? []) {
      const key = `${r.executive_sales || "(Unassigned)"}|${r.region}`;
      const cur = agg.get(key) ?? { count: 0, total: 0, region: r.region };
      cur.count += 1;
      cur.total += Number(r.amount_paid ?? 0);
      agg.set(key, cur);
      totalCount += 1;
      totalAmount += Number(r.amount_paid ?? 0);
    }
    const stats = Array.from(agg.entries())
      .map(([k, v]) => ({
        executive_sales: k.split("|")[0],
        region: v.region,
        count: v.count,
        total: v.total,
      }))
      .sort((a, b) => b.total - a.total);
    return {
      stats,
      totalCount,
      totalAmount,
      scope: { region: ctx.region, role: ctx.role },
    };
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

// ---------- Admin: bulk ZIP (date/region structure + Excel summary) ----------
const zipSchema = z.object({
  accessToken: z.string().min(1),
  region: z.enum(["MTR","FTR","SLTR","CTR","GTR","LTR"]).optional(),
  exchangeId: z.string().min(1).max(64).optional(),
  executiveSales: z.string().min(1).max(128).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const getBulkZip = createServerFn({ method: "POST" })
  .inputValidator((input) => zipSchema.parse(input))
  .handler(async ({ data }) => {
    const ctx = await requireAdmin(data.accessToken);
    const effRegion = scopeRegion(ctx, data.region);

    // Fetch proofs
    let q = supabaseAdmin
      .from("payment_proofs")
      .select(
        "storage_path, region, exchange_id, executive_sales, mdn, mime_type, amount_paid, uploaded_at",
      );
    if (effRegion) q = q.eq("region", effRegion);
    if (data.exchangeId) q = q.eq("exchange_id", data.exchangeId);
    if (data.executiveSales) q = q.eq("executive_sales", data.executiveSales);
    if (data.fromDate) q = q.gte("uploaded_at", data.fromDate);
    if (data.toDate) q = q.lte("uploaded_at", data.toDate);
    const { data: rows, error } = await q.limit(5000);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) throw new Error("No proofs match this scope.");

    // Fetch all customers (for full reference list)
    let cq = supabaseAdmin
      .from("customers")
      .select("mdn, name, region, exchange_id, executive_sales, due_amount, discount");
    if (effRegion) cq = cq.eq("region", effRegion);
    const { data: customers, error: cErr } = await cq.limit(20000);
    if (cErr) throw new Error(cErr.message);

    const proofByMdn = new Map(rows.map((r) => [r.mdn, r]));

    // Build files
    const files: Record<string, Uint8Array> = {};
    for (const row of rows) {
      const { data: blob, error: dErr } = await supabaseAdmin.storage
        .from("payment-proofs")
        .download(row.storage_path);
      if (dErr || !blob) continue;
      const folder = `${dateFolder(row.uploaded_at)}/${safeName(row.region)}`;
      const fname = `${safeName(row.mdn)}.${extFromMime(row.mime_type)}`;
      files[`${folder}/${fname}`] = new Uint8Array(await blob.arrayBuffer());
    }
    if (Object.keys(files).length === 0) throw new Error("Failed to fetch files.");

    // Build Excel summary with ALL customers + proof status
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Customers");
    ws.columns = [
      { header: "MDN", key: "mdn", width: 16 },
      { header: "Name", key: "name", width: 28 },
      { header: "Region", key: "region", width: 8 },
      { header: "Exchange ID", key: "exchange_id", width: 14 },
      { header: "Executive Sales", key: "executive_sales", width: 22 },
      { header: "Due Amount", key: "due_amount", width: 14 },
      { header: "Discount", key: "discount", width: 12 },
      { header: "Proof Status", key: "status", width: 14 },
      { header: "Amount Paid", key: "amount_paid", width: 14 },
      { header: "Uploaded At", key: "uploaded_at", width: 22 },
      { header: "Storage Path", key: "storage_path", width: 50 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" },
    };

    for (const c of customers ?? []) {
      const p = proofByMdn.get(c.mdn);
      ws.addRow({
        mdn: c.mdn,
        name: c.name,
        region: c.region,
        exchange_id: c.exchange_id,
        executive_sales: c.executive_sales ?? "",
        due_amount: Number(c.due_amount ?? 0),
        discount: Number(c.discount ?? 0),
        status: p ? "Submitted" : "Pending",
        amount_paid: p ? Number(p.amount_paid ?? 0) : "",
        uploaded_at: p ? new Date(p.uploaded_at).toISOString() : "",
        storage_path: p ? p.storage_path : "",
      });
    }
    // Also include any proofs whose customer rows are missing
    for (const r of rows) {
      if (!(customers ?? []).some((c) => c.mdn === r.mdn)) {
        ws.addRow({
          mdn: r.mdn,
          name: "(unknown)",
          region: r.region,
          exchange_id: r.exchange_id,
          executive_sales: r.executive_sales ?? "",
          due_amount: "",
          discount: "",
          status: "Submitted",
          amount_paid: Number(r.amount_paid ?? 0),
          uploaded_at: new Date(r.uploaded_at).toISOString(),
          storage_path: r.storage_path,
        });
      }
    }
    ws.autoFilter = { from: "A1", to: "K1" };

    const xlsxBuf = await wb.xlsx.writeBuffer();
    files["_summary.xlsx"] = new Uint8Array(xlsxBuf as ArrayBuffer);

    const zipped = zipSync(files, { level: 6 });
    const base64 = Buffer.from(zipped).toString("base64");
    return { base64, count: rows.length };
  });

// ---------- Admin: import customers from CSV (with validation) ----------
const importSchema = z.object({
  accessToken: z.string().min(1),
  rows: z
    .array(
      z.object({
        rowIndex: z.number().int(),
        mdn: z.string(),
        name: z.string(),
        region: z.string(),
        exchange_id: z.string(),
        executive_sales: z.string().optional().nullable(),
        due_amount: z.number().optional(),
        discount: z.number().optional(),
      }),
    )
    .min(1)
    .max(20000),
});

export const importCustomers = createServerFn({ method: "POST" })
  .inputValidator((input) => importSchema.parse(input))
  .handler(async ({ data }) => {
    const ctx = await requireAdmin(data.accessToken);
    const valid: {
      mdn: string;
      name: string;
      region: "MTR" | "FTR" | "SLTR" | "CTR" | "GTR" | "LTR";
      exchange_id: string;
      executive_sales: string | null;
      due_amount: number;
      discount: number;
    }[] = [];
    const errors: { row: number; message: string }[] = [];
    const seen = new Set<string>();

    for (const r of data.rows) {
      const mdn = (r.mdn || "").trim();
      const name = (r.name || "").trim();
      const region = (r.region || "").trim().toUpperCase();
      const exch = (r.exchange_id || "").trim();
      const exec = (r.executive_sales ?? "").toString().trim();

      if (!/^\d{10,15}$/.test(mdn)) {
        errors.push({ row: r.rowIndex, message: `Invalid MDN "${mdn}"` });
        continue;
      }
      if (!name) {
        errors.push({ row: r.rowIndex, message: "Missing name" });
        continue;
      }
      if (!["MTR","FTR","SLTR","CTR","GTR","LTR"].includes(region)) {
        errors.push({ row: r.rowIndex, message: `Region must be one of MTR/FTR/SLTR/CTR/GTR/LTR (got "${r.region}")` });
        continue;
      }
      if (ctx.region && region !== ctx.region) {
        errors.push({
          row: r.rowIndex,
          message: `Region ${region} outside your scope (${ctx.region})`,
        });
        continue;
      }
      if (!exch) {
        errors.push({ row: r.rowIndex, message: "Missing exchange_id" });
        continue;
      }
      if (seen.has(mdn)) {
        errors.push({ row: r.rowIndex, message: `Duplicate MDN ${mdn} in file` });
        continue;
      }
      seen.add(mdn);
      valid.push({
        mdn,
        name,
        region: region as "MTR" | "FTR" | "SLTR" | "CTR" | "GTR" | "LTR",
        exchange_id: exch,
        executive_sales: exec || null,
        due_amount: Number.isFinite(r.due_amount) ? Number(r.due_amount) : 0,
        discount: Number.isFinite(r.discount) ? Number(r.discount) : 0,
      });
    }

    if (valid.length === 0) {
      return { ok: false, inserted: 0, updated: 0, total: 0, errors };
    }

    // Determine which existed (for inserted vs updated count)
    const mdns = valid.map((v) => v.mdn);
    const { data: existing } = await supabaseAdmin
      .from("customers")
      .select("mdn")
      .in("mdn", mdns);
    const existingSet = new Set((existing ?? []).map((e) => e.mdn));

    const { error: upErr } = await supabaseAdmin
      .from("customers")
      .upsert(valid, { onConflict: "mdn" });
    if (upErr) throw new Error(upErr.message);

    // Propagate executive_sales to payment_proofs
    for (const v of valid) {
      if (v.executive_sales !== null) {
        await supabaseAdmin
          .from("payment_proofs")
          .update({ executive_sales: v.executive_sales })
          .eq("mdn", v.mdn);
      }
    }

    const updated = valid.filter((v) => existingSet.has(v.mdn)).length;
    const inserted = valid.length - updated;
    return { ok: true, inserted, updated, total: valid.length, errors };
  });
