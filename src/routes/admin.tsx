import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listProofs, getSignedUrl, getBulkZip } from "@/server/proofs.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Download, LogOut, ShieldCheck, Loader2, Package } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin · Payment Proofs" },
      { name: "description", content: "Admin dashboard for payment proof submissions." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

type Proof = {
  id: string;
  mdn: string;
  region: "MTR" | "FTR";
  exchange_id: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
};

function AdminPage() {
  const [session, setSession] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />
      {session ? <Dashboard /> : <LoginCard />}
    </div>
  );
}

function LoginCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/admin` },
        });
        if (error) throw error;
        toast.success("Account created. You can sign in now.");
        setMode("signin");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <Card className="w-full shadow-[var(--shadow-card)]">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg text-primary-foreground"
              style={{ background: "var(--gradient-brand)" }}
            >
              <ShieldCheck className="h-5 w-5" />
            </div>
            <span className="font-semibold">Admin access</span>
          </div>
          <CardTitle>{mode === "signin" ? "Sign in" : "Create admin account"}</CardTitle>
          <CardDescription>
            {mode === "signin"
              ? "Authorized admins only."
              : "After signup, an existing admin must grant you the admin role."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            <button
              type="button"
              className="w-full text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function Dashboard() {
  const list = useServerFn(listProofs);
  const sign = useServerFn(getSignedUrl);
  const zip = useServerFn(getBulkZip);

  const [proofs, setProofs] = useState<Proof[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState<string>("all");
  const [exchangeId, setExchangeId] = useState("");
  const [search, setSearch] = useState("");
  const [zipping, setZipping] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  async function getToken(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    if (!t) throw new Error("Not signed in");
    return t;
  }

  async function load() {
    setLoading(true);
    try {
      const accessToken = await getToken();
      const res = await list({
        data: {
          accessToken,
          region: region === "all" ? undefined : (region as "MTR" | "FTR"),
          exchangeId: exchangeId || undefined,
          search: search || undefined,
        },
      });
      setProofs(res.proofs as Proof[]);
      setForbidden(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      if (msg.toLowerCase().includes("forbidden") || msg.toLowerCase().includes("admin")) {
        setForbidden(true);
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDownload(p: Proof) {
    try {
      const { url } = await sign({ data: { storagePath: p.storage_path } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  }

  async function handleBulkZip() {
    setZipping(true);
    try {
      const res = await zip({
        data: {
          region: region === "all" ? undefined : (region as "MTR" | "FTR"),
          exchangeId: exchangeId || undefined,
        },
      });
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/zip" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const tag =
        region === "all" && !exchangeId
          ? "all"
          : `${region === "all" ? "all" : region}${exchangeId ? `-${exchangeId}` : ""}`;
      a.download = `payment-proofs-${tag}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Downloaded ${res.count} files.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ZIP failed");
    } finally {
      setZipping(false);
    }
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h2 className="text-2xl font-bold">Not an admin</h2>
        <p className="mt-2 text-muted-foreground">
          Your account is signed in but doesn't have the admin role yet.
        </p>
        <Button className="mt-6" variant="outline" onClick={() => supabase.auth.signOut()}>
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div>
      <header className="border-b bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg text-primary-foreground"
              style={{ background: "var(--gradient-brand)" }}
            >
              <ShieldCheck className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold">Admin Dashboard</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Card className="mb-6 shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <div className="space-y-2">
              <Label>Region</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="MTR">MTR</SelectItem>
                  <SelectItem value="FTR">FTR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Exchange ID</Label>
              <Input
                placeholder="e.g. EX-101"
                value={exchangeId}
                onChange={(e) => setExchangeId(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-2">
              <Label>Search MDN</Label>
              <Input
                placeholder="MDN…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-44"
              />
            </div>
            <Button onClick={load} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply filters
            </Button>
            <div className="ml-auto">
              <Button onClick={handleBulkZip} disabled={zipping || proofs.length === 0} variant="default">
                {zipping ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Package className="mr-2 h-4 w-4" />
                )}
                Download ZIP
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle>Submissions</CardTitle>
            <CardDescription>{proofs.length} record(s)</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>MDN</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Exchange</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proofs.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                      No submissions yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  proofs.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono">{p.mdn}</TableCell>
                      <TableCell><Badge variant="secondary">{p.region}</Badge></TableCell>
                      <TableCell>{p.exchange_id}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.mime_type}</TableCell>
                      <TableCell>{formatBytes(p.size_bytes)}</TableCell>
                      <TableCell>{new Date(p.uploaded_at).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => handleDownload(p)}>
                          <Download className="mr-2 h-3.5 w-3.5" /> Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
