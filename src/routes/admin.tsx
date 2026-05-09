import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  listProofs,
  getSignedUrl,
  getBulkZip,
  getExecutiveStats,
  importCustomers,
} from "@/lib/proofs.functions";
import {
  whoAmI,
  listUsers,
  createUser,
  deleteUser,
  updateUserRegion,
} from "@/lib/users.functions";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  Download,
  LogOut,
  ShieldCheck,
  Loader2,
  Package,
  Upload as UploadIcon,
  Users,
  FileSpreadsheet,
  TrendingUp,
  ArrowUpDown,
  Trash2,
  UserPlus,
  Camera,
} from "lucide-react";
import html2canvas from "html2canvas";

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
  executive_sales: string | null;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  amount_paid: number | null;
  uploaded_at: string;
};

type Me = { role: "super_admin" | "admin" | null; region: "MTR" | "FTR" | null; email?: string | null };

function AdminPage() {
  const [session, setSession] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
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
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
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
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Authorized admins only.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
              Sign in
            </Button>
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

const fmtPKR = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n || 0);

function Dashboard() {
  const list = useServerFn(listProofs);
  const sign = useServerFn(getSignedUrl);
  const zip = useServerFn(getBulkZip);
  const stats = useServerFn(getExecutiveStats);
  const importFn = useServerFn(importCustomers);
  const whoAmIFn = useServerFn(whoAmI);

  const [me, setMe] = useState<Me>({ role: null, region: null });
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState<string>("all");
  const [exchangeId, setExchangeId] = useState("");
  const [executiveSales, setExecutiveSales] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [zipping, setZipping] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const [statRows, setStatRows] = useState<
    { executive_sales: string; region: string; count: number; total: number; elc_count: number }[]
  >([]);
  const [totals, setTotals] = useState({ count: 0, amount: 0 });
  const [statFrom, setStatFrom] = useState("");
  const [statTo, setStatTo] = useState("");
  const [statRegion, setStatRegion] = useState<string>("all");
  const [statLoading, setStatLoading] = useState(false);
  const [sortKey, setSortKey] = useState<"executive_sales" | "region" | "count" | "elc_count">("count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const perfRef = useRef<HTMLDivElement>(null);

  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function getToken(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    if (!t) throw new Error("Not signed in");
    return t;
  }

  async function loadMe() {
    try {
      const accessToken = await getToken();
      const r = await whoAmIFn({ data: { accessToken } });
      setMe(r as Me);
      if (r.region) {
        setRegion(r.region);
        setStatRegion(r.region);
      }
      if (!r.role) setForbidden(true);
    } catch {
      setForbidden(true);
    }
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
          executiveSales: executiveSales || undefined,
          search: search || undefined,
          fromDate: fromDate ? new Date(fromDate + "T00:00:00").toISOString() : undefined,
          toDate: toDate ? new Date(toDate + "T23:59:59.999").toISOString() : undefined,
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

  async function loadStats() {
    setStatLoading(true);
    try {
      const accessToken = await getToken();
      const res = await stats({
        data: {
          accessToken,
          region: statRegion === "all" ? undefined : (statRegion as "MTR" | "FTR"),
          fromDate: statFrom ? new Date(statFrom + "T00:00:00").toISOString() : undefined,
          toDate: statTo ? new Date(statTo + "T23:59:59.999").toISOString() : undefined,
        },
      });
      setStatRows(res.stats);
      setTotals({ count: res.totalCount, amount: res.totalAmount });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stats failed");
    } finally {
      setStatLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadMe();
      await load();
      await loadStats();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedStats = useMemo(() => {
    const copy = [...statRows];
    copy.sort((a, b) => {
      let av: string | number = a[sortKey];
      let bv: string | number = b[sortKey];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = (bv as string).toLowerCase();
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [statRows, sortKey, sortDir]);

  function toggleSort(k: typeof sortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "executive_sales" || k === "region" ? "asc" : "desc");
    }
  }

  async function handleDownload(p: Proof) {
    try {
      const accessToken = await getToken();
      const { url } = await sign({ data: { accessToken, storagePath: p.storage_path } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  }

  async function handleBulkZip() {
    setZipping(true);
    try {
      const accessToken = await getToken();
      const res = await zip({
        data: {
          accessToken,
          region: region === "all" ? undefined : (region as "MTR" | "FTR"),
          exchangeId: exchangeId || undefined,
          executiveSales: executiveSales || undefined,
          fromDate: fromDate ? new Date(fromDate + "T00:00:00").toISOString() : undefined,
          toDate: toDate ? new Date(toDate + "T23:59:59.999").toISOString() : undefined,
        },
      });
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/zip" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const tag = executiveSales || (region === "all" ? "all" : region);
      a.download = `payment-proofs-${tag}-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Downloaded ${res.count} files (Excel summary included).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ZIP failed");
    } finally {
      setZipping(false);
    }
  }

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImporting(true);
    try {
      const text = await f.text();
      const { rows, errors: parseErrors } = parseCsv(text);
      if (rows.length === 0) {
        const detail = parseErrors.length ? `: ${parseErrors[0].message}` : "";
        throw new Error(`No valid rows found${detail}`);
      }
      const accessToken = await getToken();
      const res = await importFn({ data: { accessToken, rows } });
      const errCount = (res.errors?.length ?? 0) + parseErrors.length;
      if (res.ok) {
        toast.success(
          `Imported ${res.total} customers (${res.inserted} new, ${res.updated} updated)${errCount ? ` · ${errCount} skipped` : ""}.`,
        );
      } else {
        toast.error(`Import failed — ${errCount} errors. First: ${(res.errors?.[0]?.message ?? parseErrors[0]?.message) || "unknown"}`);
      }
      if (errCount > 0) {
        const all = [...parseErrors, ...(res.errors ?? [])].slice(0, 5);
        toast.message("Validation errors", {
          description: all.map((e) => `Row ${e.row}: ${e.message}`).join("\n"),
        });
      }
      await loadStats();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
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

  const lockedRegion = me.region; // null => super admin / all regions

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
            <div>
              <div className="text-lg font-semibold leading-tight">Admin Dashboard</div>
              <div className="text-xs text-muted-foreground">
                {me.role === "super_admin"
                  ? "Super Admin · all regions"
                  : `Admin · ${lockedRegion ?? "all"} region`}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">
              <TrendingUp className="mr-2 h-4 w-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="submissions">
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Submissions
            </TabsTrigger>
            <TabsTrigger value="customers">
              <Users className="mr-2 h-4 w-4" /> Customers
            </TabsTrigger>
            {me.role === "super_admin" && (
              <TabsTrigger value="users">
                <UserPlus className="mr-2 h-4 w-4" /> Users
              </TabsTrigger>
            )}
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="space-y-6">
            <Card className="shadow-[var(--shadow-card)]">
              <CardHeader>
                <CardTitle>Executive Sales Performance</CardTitle>
                <CardDescription>Payment proofs received per Executive Sales person.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-2">
                    <Label>Region</Label>
                    <Select
                      value={statRegion}
                      onValueChange={setStatRegion}
                      disabled={!!lockedRegion}
                    >
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {!lockedRegion && <SelectItem value="all">All</SelectItem>}
                        <SelectItem value="MTR">MTR</SelectItem>
                        <SelectItem value="FTR">FTR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>From</Label>
                    <Input type="date" value={statFrom} onChange={(e) => setStatFrom(e.target.value)} className="w-44" />
                  </div>
                  <div className="space-y-2">
                    <Label>To</Label>
                    <Input type="date" value={statTo} onChange={(e) => setStatTo(e.target.value)} className="w-44" />
                  </div>
                  <Button onClick={loadStats} disabled={statLoading}>
                    {statLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Apply
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setStatFrom("");
                      setStatTo("");
                      if (!lockedRegion) setStatRegion("all");
                      setTimeout(loadStats, 0);
                    }}
                  >
                    Clear
                  </Button>
                </div>

                <div ref={perfRef} className="space-y-4 bg-background p-2 rounded-lg">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <StatBox label="Total Proofs" value={totals.count.toString()} />
                    <StatBox
                      label="Executives"
                      value={new Set(statRows.map((s) => s.executive_sales)).size.toString()}
                    />
                    <StatBox
                      label="Total ELCs"
                      value={statRows.reduce((s, r) => s + (r.elc_count || 0), 0).toString()}
                    />
                  </div>

                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader className="bg-muted/50 sticky top-0">
                        <TableRow>
                          <SortHead label="Executive Sales" k="executive_sales" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                          <SortHead label="Region" k="region" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                          <SortHead label="Count of Proof <> ELC" k="count" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="text-right" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedStats.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                              No data for selected range.
                            </TableCell>
                          </TableRow>
                        ) : (
                          sortedStats.map((r, i) => (
                            <TableRow key={`${r.executive_sales}-${r.region}`} className={i % 2 ? "bg-muted/20" : ""}>
                              <TableCell className="font-medium">{r.executive_sales}</TableCell>
                              <TableCell>
                                <Badge variant="secondary">{r.region}</Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                <span className="text-primary font-semibold">{r.count}</span>
                                <span className="text-muted-foreground"> / {r.elc_count}</span>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button variant="outline" onClick={handlePrintScreen}>
                    <Camera className="mr-2 h-4 w-4" /> Print Screen
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Submissions */}
          <TabsContent value="submissions" className="space-y-6">
            <Card className="shadow-[var(--shadow-card)]">
              <CardContent className="flex flex-wrap items-end gap-3 pt-6">
                <div className="space-y-2">
                  <Label>Region</Label>
                  <Select value={region} onValueChange={setRegion} disabled={!!lockedRegion}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {!lockedRegion && <SelectItem value="all">All</SelectItem>}
                      <SelectItem value="MTR">MTR</SelectItem>
                      <SelectItem value="FTR">FTR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Executive Sales</Label>
                  <Input
                    placeholder="Name…"
                    value={executiveSales}
                    onChange={(e) => setExecutiveSales(e.target.value)}
                    className="w-48"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Exchange ID</Label>
                  <Input
                    placeholder="EXH…"
                    value={exchangeId}
                    onChange={(e) => setExchangeId(e.target.value)}
                    className="w-36"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Search MDN</Label>
                  <Input
                    placeholder="MDN…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="space-y-2">
                  <Label>From</Label>
                  <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
                </div>
                <div className="space-y-2">
                  <Label>To</Label>
                  <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
                </div>
                <Button onClick={load} disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Apply
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (!lockedRegion) setRegion("all");
                    setExchangeId("");
                    setExecutiveSales("");
                    setSearch("");
                    setFromDate("");
                    setToDate("");
                  }}
                >
                  Clear
                </Button>
                <div className="ml-auto">
                  <Button onClick={handleBulkZip} disabled={zipping || proofs.length === 0}>
                    {zipping ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Package className="mr-2 h-4 w-4" />
                    )}
                    Download ZIP + Excel
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
                      <TableHead>Executive Sales</TableHead>
                      <TableHead>Exchange</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {proofs.length === 0 && !loading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                          No submissions yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      proofs.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono">{p.mdn}</TableCell>
                          <TableCell><Badge variant="secondary">{p.region}</Badge></TableCell>
                          <TableCell>{p.executive_sales || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{p.exchange_id}</TableCell>
                          <TableCell className="text-right font-mono">{fmtPKR(Number(p.amount_paid ?? 0))}</TableCell>
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
          </TabsContent>

          {/* Customers (CSV upload) */}
          <TabsContent value="customers" className="space-y-6">
            <Card className="shadow-[var(--shadow-card)]">
              <CardHeader>
                <CardTitle>Import customers (CSV)</CardTitle>
                <CardDescription>
                  Upload a CSV file with all customer columns. Existing rows (matched by MDN) will be updated.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                  <div className="font-medium mb-2">Required columns (header row):</div>
                  <code className="block rounded bg-background px-3 py-2 text-xs">
                    mdn,name,region,exchange_id,executive_sales,due_amount,discount
                  </code>
                  <ul className="mt-3 list-disc pl-5 text-xs text-muted-foreground space-y-1">
                    <li><b>region</b> must be <code>MTR</code> or <code>FTR</code></li>
                    <li><b>mdn</b> 10–15 digits — unique key, duplicates in file are skipped</li>
                    <li><b>due_amount</b> &amp; <b>discount</b> are numbers (default 0)</li>
                    <li><b>executive_sales</b> is the sales person's name (optional)</li>
                    {lockedRegion && (
                      <li className="text-amber-600">
                        Your scope is region <b>{lockedRegion}</b>; rows for other regions will be skipped.
                      </li>
                    )}
                  </ul>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleCsvImport}
                    className="hidden"
                    id="csv-upload"
                  />
                  <Button asChild disabled={importing}>
                    <label htmlFor="csv-upload" className="cursor-pointer">
                      {importing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <UploadIcon className="mr-2 h-4 w-4" />
                      )}
                      Choose CSV file
                    </label>
                  </Button>
                  <a
                    href={`data:text/csv;charset=utf-8,${encodeURIComponent(
                      "mdn,name,region,exchange_id,executive_sales,due_amount,discount\n0300xxxxxxx,Sample Name,MTR,EXH0001,Ali Khan,1500,0\n",
                    )}`}
                    download="customers-template.csv"
                    className="text-sm text-primary underline"
                  >
                    Download template
                  </a>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users (super-admin only) */}
          {me.role === "super_admin" && (
            <TabsContent value="users" className="space-y-6">
              <UsersPanel />
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}

function SortHead({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  className,
}: {
  label: string;
  k: "executive_sales" | "region" | "count" | "elc_count";
  sortKey: string;
  sortDir: "asc" | "desc";
  onClick: (k: "executive_sales" | "region" | "count" | "elc_count") => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        onClick={() => onClick(k)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortKey === k ? "text-primary" : "opacity-40"}`} />
        {sortKey === k && <span className="text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </TableHead>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-gradient-to-br from-secondary/40 to-secondary/10 p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function UsersPanel() {
  const listFn = useServerFn(listUsers);
  const createFn = useServerFn(createUser);
  const deleteFn = useServerFn(deleteUser);
  const updateFn = useServerFn(updateUserRegion);

  type Row = {
    roleId: string;
    userId: string;
    email: string;
    role: string;
    region: string | null;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [region, setRegion] = useState<"MTR" | "FTR" | "ALL">("MTR");
  const [busy, setBusy] = useState(false);

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  async function load() {
    setLoading(true);
    try {
      const accessToken = await token();
      const r = await listFn({ data: { accessToken } });
      setRows(r.users);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const accessToken = await token();
      await createFn({ data: { accessToken, email, password: pwd, region } });
      toast.success("User created.");
      setEmail("");
      setPwd("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(userId: string) {
    if (!confirm("Delete this user?")) return;
    try {
      const accessToken = await token();
      await deleteFn({ data: { accessToken, userId } });
      toast.success("User deleted.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function onChangeRegion(userId: string, value: "MTR" | "FTR" | "ALL") {
    try {
      const accessToken = await token();
      await updateFn({ data: { accessToken, userId, region: value } });
      toast.success("Region updated.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <>
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle>Create regional admin</CardTitle>
          <CardDescription>
            Regional admins can only see and download data for their assigned region.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" minLength={6} value={pwd} onChange={(e) => setPwd(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Region</Label>
              <Select value={region} onValueChange={(v) => setRegion(v as "MTR" | "FTR" | "ALL")}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MTR">MTR</SelectItem>
                  <SelectItem value="FTR">FTR</SelectItem>
                  <SelectItem value="ALL">All regions</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <UserPlus className="mr-2 h-4 w-4" /> Create
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle>Existing users</CardTitle>
          <CardDescription>{rows.length} user(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.roleId}>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "super_admin" ? "default" : "secondary"}>{u.role}</Badge>
                    </TableCell>
                    <TableCell>
                      {u.role === "admin" ? (
                        <Select
                          value={u.region ?? "ALL"}
                          onValueChange={(v) => onChangeRegion(u.userId, v as "MTR" | "FTR" | "ALL")}
                        >
                          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MTR">MTR</SelectItem>
                            <SelectItem value="FTR">FTR</SelectItem>
                            <SelectItem value="ALL">All</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">all</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {u.role !== "super_admin" && (
                        <Button size="sm" variant="outline" onClick={() => onDelete(u.userId)}>
                          <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// Tiny CSV parser with row-level error collection
function parseCsv(text: string): {
  rows: Array<{
    rowIndex: number;
    mdn: string;
    name: string;
    region: string;
    exchange_id: string;
    executive_sales?: string | null;
    due_amount?: number;
    discount?: number;
  }>;
  errors: { row: number; message: string }[];
} {
  const errors: { row: number; message: string }[] = [];
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    errors.push({ row: 0, message: "File is empty or only has a header." });
    return { rows: [], errors };
  }
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (c === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/^\ufeff/, ""));
  const required = ["mdn", "name", "region", "exchange_id"];
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) {
    errors.push({ row: 1, message: `Missing required column(s): ${missing.join(", ")}` });
    return { rows: [], errors };
  }
  const idx = (k: string) => header.indexOf(k);
  const iMdn = idx("mdn"),
    iName = idx("name"),
    iRegion = idx("region"),
    iExch = idx("exchange_id"),
    iExec = idx("executive_sales"),
    iDue = idx("due_amount"),
    iDisc = idx("discount");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    const dueRaw = iDue >= 0 ? cols[iDue] : "";
    const discRaw = iDisc >= 0 ? cols[iDisc] : "";
    const due = dueRaw ? Number(dueRaw.replace(/,/g, "")) : 0;
    const disc = discRaw ? Number(discRaw.replace(/,/g, "")) : 0;
    if (dueRaw && Number.isNaN(due)) {
      errors.push({ row: i + 1, message: `Invalid due_amount "${dueRaw}"` });
      continue;
    }
    if (discRaw && Number.isNaN(disc)) {
      errors.push({ row: i + 1, message: `Invalid discount "${discRaw}"` });
      continue;
    }
    rows.push({
      rowIndex: i + 1,
      mdn: cols[iMdn] ?? "",
      name: cols[iName] ?? "",
      region: cols[iRegion] ?? "",
      exchange_id: cols[iExch] ?? "",
      executive_sales: iExec >= 0 ? cols[iExec] || null : null,
      due_amount: due,
      discount: disc,
    });
  }
  return { rows, errors };
}
