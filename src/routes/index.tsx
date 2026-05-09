import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCustomerByMdn, uploadProof } from "@/lib/proofs.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  CheckCircle2,
  Loader2,
  Search,
  Upload,
  Wallet,
  Receipt,
  ShieldCheck,
  ArrowLeft,
  FileText,
} from "lucide-react";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, validateFile, validateMdn } from "@/lib/proof-utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ELC Payment Record Tracker" },
      { name: "description", content: "Fetch your ELC account, view dues, and submit payment proof securely." },
    ],
  }),
  component: TrackerPage,
});

type Customer = {
  mdn: string;
  name: string;
  region: "MTR" | "FTR";
  exchange_id: string;
  executive_sales: string | null;
  due_amount: number;
  discount: number;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(((r.result as string).split(",")[1]) ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n || 0);

function TrackerPage() {
  const lookup = useServerFn(getCustomerByMdn);
  const upload = useServerFn(uploadProof);

  const [mdn, setMdn] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [existingProof, setExistingProof] = useState<{ uploaded_at: string; amount_paid: number } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [amountPaid, setAmountPaid] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);

  const remaining = useMemo(() => {
    if (!customer) return 0;
    return Math.max(0, Number(customer.due_amount) - Number(customer.discount));
  }, [customer]);

  async function handleFetch(e: React.FormEvent) {
    e.preventDefault();
    const err = validateMdn(mdn);
    if (err) return toast.error(err);
    setLookingUp(true);
    setDone(false);
    setExistingProof(null);
    try {
      const res = await lookup({ data: { mdn } });
      if (!res.customer) {
        setCustomer(null);
        toast.error("No record found for this MDN.");
      } else {
        const c = res.customer as any;
        setCustomer({
          mdn: c.mdn,
          name: c.name,
          region: c.region,
          exchange_id: c.exchange_id,
          executive_sales: c.executive_sales ?? null,
          due_amount: Number(c.due_amount ?? 0),
          discount: Number(c.discount ?? 0),
        });
        setExistingProof((res as any).existingProof ?? null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lookup failed.");
    } finally {
      setLookingUp(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customer) return toast.error("Fetch a record first.");
    if (!file) return toast.error("Please choose a payment proof file.");
    const fErr = validateFile(file);
    if (fErr) return toast.error(fErr);
    const amt = Number(amountPaid);
    if (!amountPaid || isNaN(amt) || amt <= 0) return toast.error("Enter a valid amount paid.");

    setUploading(true);
    try {
      const fileBase64 = await fileToBase64(file);
      await upload({
        data: {
          mdn: customer.mdn,
          mimeType: file.type as (typeof ALLOWED_MIME_TYPES)[number],
          size: file.size,
          fileBase64,
          amountPaid: amt,
        },
      });
      setDone(true);
      toast.success("Payment record submitted successfully!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed.");
    } finally {
      setUploading(false);
    }
  }

  function resetAll() {
    setMdn("");
    setCustomer(null);
    setAmountPaid("");
    setFile(null);
    setDone(false);
    setExistingProof(null);
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{
        background:
          "radial-gradient(1200px 600px at 10% -10%, oklch(0.62 0.2 255 / 0.18), transparent 60%), radial-gradient(900px 500px at 110% 10%, oklch(0.93 0.04 195 / 0.45), transparent 60%), var(--background)",
      }}
    >
      <Toaster richColors position="top-center" />

      {/* Header */}
      <header className="relative z-10 border-b border-border/50 bg-card/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-primary-foreground shadow-md"
              style={{ background: "var(--gradient-brand)" }}
            >
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight">ELC Payment Tracker</div>
              <div className="text-xs text-muted-foreground">Secure proof submission</div>
            </div>
          </div>
          <Link
            to="/admin"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            Admin
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-2xl px-6 py-10 sm:py-14">
        {/* Hero */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Encrypted · Admin-only access
          </div>
          <h1 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight">
            Track & Submit Your{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-brand)" }}
            >
              Payment
            </span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your MDN to view dues and upload a payment proof.
          </p>
        </div>

        <Card className="overflow-hidden border-border/60 shadow-[var(--shadow-card)]">
          <div className="h-1 w-full" style={{ background: "var(--gradient-brand)" }} />
          <CardContent className="p-6 sm:p-8 space-y-6">
            {/* MDN fetch */}
            <form onSubmit={handleFetch} className="space-y-2">
              <Label htmlFor="mdn" className="text-xs uppercase tracking-wider text-muted-foreground">
                MDN
              </Label>
              <div className="flex gap-2">
                <Input
                  id="mdn"
                  inputMode="numeric"
                  placeholder="Enter your MDN number"
                  value={mdn}
                  onChange={(e) => setMdn(e.target.value.replace(/\D/g, ""))}
                  maxLength={15}
                  required
                  className="h-11 text-base"
                />
                <Button
                  type="submit"
                  disabled={lookingUp}
                  className="h-11 min-w-[110px] shadow-sm"
                >
                  {lookingUp ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" /> Fetch
                    </>
                  )}
                </Button>
              </div>
            </form>

            {/* Customer details */}
            {customer && (
              <>
                <div className="rounded-xl border border-border/60 bg-gradient-to-br from-secondary/40 to-secondary/10 p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">
                        Customer
                      </div>
                      <div className="mt-0.5 text-lg font-semibold leading-tight">
                        {customer.name}
                      </div>
                    </div>
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-sm"
                      style={{ background: "var(--gradient-brand)" }}
                    >
                      {customer.region}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <Stat label="MDN" value={customer.mdn} mono />
                    <Stat label="Executive Sales" value={customer.executive_sales || "—"} />
                    <Stat label="Due Amount" value={fmt(customer.due_amount)} />
                    <Stat label="Discount" value={fmt(customer.discount)} accent />
                  </div>

                  <div className="mt-2 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Remaining Payable</span>
                    </div>
                    <span className="text-xl font-bold text-primary">
                      {fmt(remaining)}
                    </span>
                  </div>
                </div>

                {done ? (
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-[oklch(0.62_0.16_155)]/30 bg-[oklch(0.62_0.16_155)]/10 py-8 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[oklch(0.62_0.16_155)]/20">
                      <CheckCircle2 className="h-8 w-8 text-[oklch(0.62_0.16_155)]" />
                    </div>
                    <div className="text-lg font-semibold">Submission received</div>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Payment proof recorded against MDN{" "}
                      <span className="font-mono font-medium text-foreground">{customer.mdn}</span>.
                    </p>
                    <Button variant="outline" onClick={resetAll} className="mt-1">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Submit another
                    </Button>
                  </div>
                ) : existingProof ? (
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 py-8 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
                      <CheckCircle2 className="h-8 w-8 text-primary" />
                    </div>
                    <div className="text-lg font-semibold">
                      Proof already uploaded on{" "}
                      {new Date(existingProof.uploaded_at).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </div>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      A payment proof for MDN{" "}
                      <span className="font-mono font-medium text-foreground">{customer.mdn}</span>{" "}
                      has already been submitted. Re-upload is not allowed.
                    </p>
                    <Button variant="outline" onClick={resetAll} className="mt-1">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Check another MDN
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="amount" className="text-xs uppercase tracking-wider text-muted-foreground">
                        Amount Paid
                      </Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                          PKR
                        </span>
                        <Input
                          id="amount"
                          inputMode="decimal"
                          placeholder="0"
                          value={amountPaid}
                          onChange={(e) =>
                            setAmountPaid(e.target.value.replace(/[^\d.]/g, ""))
                          }
                          required
                          className="h-11 pl-12 text-base"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        Upload Payment Proof
                      </Label>
                      <label
                        htmlFor="file"
                        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-4 py-6 transition-colors hover:border-primary/50 hover:bg-secondary/50"
                      >
                        <FileText className="h-6 w-6 text-muted-foreground" />
                        <div className="text-sm font-medium">
                          {file ? file.name : "Click to choose a file"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          JPEG, PNG, or PDF · max {MAX_FILE_SIZE / 1024 / 1024} MB
                        </div>
                        <input
                          id="file"
                          type="file"
                          accept={ALLOWED_MIME_TYPES.join(",")}
                          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                          required
                          className="hidden"
                        />
                      </label>
                    </div>

                    <Button
                      type="submit"
                      className="h-11 w-full shadow-md"
                      disabled={uploading || !file}
                    >
                      {uploading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      Submit Payment
                    </Button>
                  </form>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Your files are stored securely and only accessible to authorized admins.
        </p>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={[
          "mt-0.5 text-sm font-semibold",
          mono ? "font-mono" : "",
          accent ? "text-[oklch(0.62_0.16_155)]" : "",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}
