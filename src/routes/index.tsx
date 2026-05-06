import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCustomerByMdn, uploadProof } from "@/server/proofs.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { CheckCircle2, FileUp, Loader2, ShieldCheck } from "lucide-react";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, validateFile, validateMdn } from "@/lib/proof-utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Submit Payment Proof" },
      {
        name: "description",
        content: "Upload your payment proof securely. Enter your MDN, attach receipt, done.",
      },
      { property: "og:title", content: "Submit Payment Proof" },
      { property: "og:description", content: "Securely submit your payment receipt." },
    ],
  }),
  component: UploadPage,
});

type Customer = { mdn: string; name: string; region: "MTR" | "FTR"; exchange_id: string };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      resolve(res.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function UploadPage() {
  const lookup = useServerFn(getCustomerByMdn);
  const upload = useServerFn(uploadProof);

  const [mdn, setMdn] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    const err = validateMdn(mdn);
    if (err) return toast.error(err);
    setLookingUp(true);
    try {
      const res = await lookup({ data: { mdn } });
      if (!res.customer) {
        toast.error("No customer found for this MDN.");
        setCustomer(null);
      } else {
        setCustomer(res.customer as Customer);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lookup failed.");
    } finally {
      setLookingUp(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!customer || !file) return;
    const err = validateFile(file);
    if (err) return toast.error(err);
    setUploading(true);
    try {
      const fileBase64 = await fileToBase64(file);
      await upload({
        data: {
          mdn: customer.mdn,
          mimeType: file.type as (typeof ALLOWED_MIME_TYPES)[number],
          size: file.size,
          fileBase64,
        },
      });
      setDone(true);
      toast.success("Payment proof uploaded successfully!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function reset() {
    setMdn("");
    setCustomer(null);
    setFile(null);
    setDone(false);
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />
      <header className="border-b bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg text-primary-foreground"
              style={{ background: "var(--gradient-brand)" }}
            >
              <ShieldCheck className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight">Payment Proof</span>
          </div>
          <Link
            to="/admin"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Admin
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Submit your payment proof
          </h1>
          <p className="mt-3 text-muted-foreground">
            Enter your MDN to confirm your account, then upload a receipt (JPEG, PNG, or PDF up to 5 MB).
          </p>
        </div>

        {done ? (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <CheckCircle2 className="h-14 w-14 text-[oklch(0.62_0.16_155)]" />
              <h2 className="text-2xl font-semibold">Submission received</h2>
              <p className="max-w-sm text-muted-foreground">
                Thanks{customer ? `, ${customer.name}` : ""}. Your proof has been recorded against MDN{" "}
                <span className="font-medium text-foreground">{customer?.mdn}</span>.
              </p>
              <Button onClick={reset} variant="outline">
                Submit another
              </Button>
            </CardContent>
          </Card>
        ) : !customer ? (
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader>
              <CardTitle>Step 1 — Verify your MDN</CardTitle>
              <CardDescription>10–15 digit mobile number on your account.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLookup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mdn">MDN</Label>
                  <Input
                    id="mdn"
                    inputMode="numeric"
                    placeholder="e.g. 923001112233"
                    value={mdn}
                    onChange={(e) => setMdn(e.target.value.replace(/\D/g, ""))}
                    maxLength={15}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={lookingUp}>
                  {lookingUp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Continue
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader>
              <CardTitle>Step 2 — Upload your receipt</CardTitle>
              <CardDescription>
                JPEG, PNG, or PDF · max {MAX_FILE_SIZE / 1024 / 1024} MB
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-6 rounded-lg border bg-secondary/50 p-4">
                <div className="text-sm text-muted-foreground">Account verified</div>
                <div className="mt-1 text-base font-semibold">{customer.name}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">MDN {customer.mdn}</Badge>
                  <Badge variant="secondary">Region {customer.region}</Badge>
                  <Badge variant="secondary">Exchange {customer.exchange_id}</Badge>
                </div>
              </div>
              <form onSubmit={handleUpload} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="file">Receipt file</Label>
                  <Input
                    id="file"
                    type="file"
                    accept={ALLOWED_MIME_TYPES.join(",")}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setCustomer(null);
                      setFile(null);
                    }}
                  >
                    Back
                  </Button>
                  <Button type="submit" className="flex-1" disabled={!file || uploading}>
                    {uploading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileUp className="mr-2 h-4 w-4" />
                    )}
                    Upload proof
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Files are stored securely and only accessible to authorized admins.
        </p>
      </main>
    </div>
  );
}
