import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCustomerByMdn, uploadProof } from "@/server/proofs.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { CheckCircle2, Loader2, Search, Upload } from "lucide-react";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, validateFile, validateMdn } from "@/lib/proof-utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ELC Payment Record Tracker" },
      { name: "description", content: "Fetch your ELC account, view dues, and submit payment proof." },
    ],
  }),
  component: TrackerPage,
});

type Customer = {
  mdn: string;
  name: string;
  region: "MTR" | "FTR";
  exchange_id: string;
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
          due_amount: Number(c.due_amount ?? 0),
          discount: Number(c.discount ?? 0),
        });
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
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />

      <header className="border-b bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-bold tracking-tight uppercase">
            ELC Payment Record Tracker
          </h1>
          <Link
            to="/admin"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Admin
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="p-6 sm:p-8 space-y-6">
            <div className="text-center pb-4 border-b border-dashed">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
                ELC Payment Record Tracker
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Enter your MDN to view dues and submit payment proof
              </p>
            </div>

            {/* MDN fetch */}
            <form onSubmit={handleFetch} className="space-y-2">
              <Label htmlFor="mdn">MDN</Label>
              <div className="flex gap-2">
                <Input
                  id="mdn"
                  inputMode="numeric"
                  placeholder="Enter MDN"
                  value={mdn}
                  onChange={(e) => setMdn(e.target.value.replace(/\D/g, ""))}
                  maxLength={15}
                  required
                />
                <Button type="submit" disabled={lookingUp} className="min-w-[100px]">
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
                <div className="rounded-lg border bg-secondary/40 p-4 space-y-2 text-sm">
                  <Row label="Customer Name" value={customer.name} />
                  <Row label="Region" value={customer.region} />
                  <Row label="Exch ID" value={customer.exchange_id} />
                  <Row label="Due Amount" value={fmt(customer.due_amount)} />
                  <Row label="Discount" value={fmt(customer.discount)} />
                  <div className="border-t border-dashed pt-2 mt-2">
                    <Row
                      label="Remaining Payable"
                      value={fmt(remaining)}
                      strong
                    />
                  </div>
                </div>

                {done ? (
                  <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <CheckCircle2 className="h-12 w-12 text-[oklch(0.62_0.16_155)]" />
                    <div className="font-semibold">Submission received</div>
                    <p className="text-sm text-muted-foreground">
                      Payment proof recorded against MDN{" "}
                      <span className="font-medium text-foreground">{customer.mdn}</span>.
                    </p>
                    <Button variant="outline" onClick={resetAll}>
                      Submit another
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount Paid</Label>
                      <Input
                        id="amount"
                        inputMode="decimal"
                        placeholder="0"
                        value={amountPaid}
                        onChange={(e) =>
                          setAmountPaid(e.target.value.replace(/[^\d.]/g, ""))
                        }
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="file">Upload Payment Proof</Label>
                      <Input
                        id="file"
                        type="file"
                        accept={ALLOWED_MIME_TYPES.join(",")}
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        JPEG, PNG, or PDF · max {MAX_FILE_SIZE / 1024 / 1024} MB
                      </p>
                    </div>

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={uploading || !file}
                    >
                      {uploading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      Submit
                    </Button>
                  </form>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Files are stored securely and only accessible to authorized admins.
        </p>
      </main>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string | number;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold" : "font-medium"}>: {value}</span>
    </div>
  );
}
