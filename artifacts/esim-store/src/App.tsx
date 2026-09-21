import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  CreditCard,
  FileSearch,
  Globe2,
  HelpCircle,
  Home,
  LoaderCircle,
  MapPin,
  Minus,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserRound,
  Wifi,
  X,
} from 'lucide-react';
import {
  getGetEsimLookupQueryKey,
  getGetEsimOrderQueryKey,
  getGetEsimPlansQueryKey,
  getGetEsimTopupsQueryKey,
  type EsimOrder,
  type EsimPlan,
  useCreateEsimTopup,
  useCreateEsimOrder,
  useGetEsimLookup,
  useGetEsimOrder,
  useGetEsimPlans,
  useGetEsimTopups,
} from '@workspace/api-client-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient();
const ORDER_STORAGE_KEY = 'esim-onboard-last-orders';
const WELCOME_STORAGE_KEY = 'esim-onboard-welcome-seen';

type AuthUser = { id: string; name: string; email: string; role: string };
type RemoteOrder = EsimOrder & {
  location?: string;
  amountPhp?: number;
  paymentStatus?: string;
  esimStatus?: string;
  usedBytes?: number | null;
  remainingBytes?: number | null;
  createdAt?: string;
};
type CustomerDashboard = {
  user: AuthUser;
  activeEsims: RemoteOrder[];
  recentOrders: RemoteOrder[];
};

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  error: string;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Something went wrong');
  return data as T;
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    requestJson<{ user: AuthUser | null }>('/api/auth/me')
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);
  const login = useCallback(async (email: string, password: string) => {
    setError('');
    try {
      const result = await requestJson<{ user: AuthUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      setUser(result.user);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to log in';
      setError(message);
      throw cause;
    }
  }, []);
  const register = useCallback(async (name: string, email: string, password: string) => {
    setError('');
    try {
      const result = await requestJson<{ user: AuthUser }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
      setUser(result.user);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to create account';
      setError(message);
      throw cause;
    }
  }, []);
  const logout = useCallback(async () => {
    await requestJson('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);
  return <AuthContext.Provider value={{ user, isLoading, error, login, register, logout, clearError: () => setError('') }}>{children}</AuthContext.Provider>;
}

function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

function toEsimOrder(order: RemoteOrder): EsimOrder {
  return {
    orderNo: order.orderNo,
    transactionId: order.transactionId,
    packageCode: order.packageCode,
    packageName: order.packageName,
    pricePhp: order.amountPhp ?? order.pricePhp,
    status: order.esimStatus ?? order.status,
    smdpStatus: order.smdpStatus,
    iccid: order.iccid,
    esimTranNo: order.esimTranNo,
    qrCodeUrl: order.qrCodeUrl,
    shortUrl: order.shortUrl,
    totalVolumeBytes: order.totalVolumeBytes,
    dataGb: order.dataGb,
    totalDuration: order.totalDuration,
    durationUnit: order.durationUnit,
    expiresAt: order.expiresAt,
  };
}

function useCustomerDashboard() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<CustomerDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const refresh = useCallback(() => {
    if (!user) {
      setDashboard(null);
      return Promise.resolve();
    }
    setIsLoading(true);
    return requestJson<CustomerDashboard>('/api/customer/dashboard')
      .then(setDashboard)
      .catch(() => setDashboard(null))
      .finally(() => setIsLoading(false));
  }, [user]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { dashboard, isLoading, refresh };
}

function formatPhp(valuePhp: number | null | undefined) {
  if (valuePhp === null || valuePhp === undefined || Number.isNaN(valuePhp)) return '—';
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(valuePhp);
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Not available';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  return `${(value / 1024 ** 2).toFixed(0)} MB`;
}

function formatDuration(duration: number, unit: string) {
  const normalized = unit.toLowerCase();
  return `${duration} ${duration === 1 ? normalized.replace(/s$/, '') : normalized}`;
}

function formatData(plan: Pick<EsimPlan, 'dataGb' | 'volumeBytes'> | Pick<EsimOrder, 'dataGb' | 'totalVolumeBytes'>) {
  if ('dataGb' in plan && plan.dataGb) return `${plan.dataGb} GB`;
  const bytes = 'volumeBytes' in plan ? plan.volumeBytes : plan.totalVolumeBytes;
  return bytes ? `${(bytes / 1073741824).toFixed(1)} GB` : 'Pending';
}

function displayEsimStatus(order: EsimOrder, remainingBytes?: number | null) {
  if (order.expiresAt && new Date(order.expiresAt).getTime() < Date.now()) return 'Expired';
  if (!order.iccid) return 'Not Installed';
  if (remainingBytes !== null && remainingBytes !== undefined && remainingBytes <= 0) return 'Low Data';
  if (order.status.toUpperCase().includes('ACTIVE') || order.smdpStatus.toUpperCase().includes('ENABLED')) return 'Active';
  return order.status || 'Provisioning';
}

function readSavedOrders(): EsimOrder[] {
  try {
    const saved = window.localStorage.getItem(ORDER_STORAGE_KEY);
    return saved ? JSON.parse(saved) as EsimOrder[] : [];
  } catch {
    return [];
  }
}

function rememberOrder(order: EsimOrder) {
  const next = [order, ...readSavedOrders().filter((item) => item.orderNo !== order.orderNo)].slice(0, 8);
  window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(next));
}

function Brand() {
  return (
    <Link href="/" className="brand-mark" data-testid="link-brand-home">
      <span className="brand-symbol"><Wifi size={17} strokeWidth={2.7} /></span>
      <span className="brand-word">ESIM <em>ONBOARD</em></span>
    </Link>
  );
}

function Header() {
  const { user, isLoading } = useAuth();
  return (
    <header className="site-header">
      <Brand />
      <div className="header-actions">
        <span className="header-mode">{isLoading ? 'Loading' : user ? user.name : 'Guest mode'}</span>
        <Link href="/account" className="avatar" data-testid="display-account-avatar" aria-label="Open account">{user ? user.name.slice(0, 1).toUpperCase() : 'E'}</Link>
      </div>
    </header>
  );
}

const navItems = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/esims', label: 'My eSIMs', icon: Smartphone },
  { href: '/orders', label: 'Orders', icon: FileSearch },
  { href: '/account', label: 'Account', icon: UserRound },
];

function BottomNav() {
  const [location] = useLocation();
  return (
    <nav className="nav-dock" aria-label="Primary navigation">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? location === '/' : location.startsWith(href);
        return <Link key={href} href={href} className={`nav-item ${active ? 'active' : ''}`} data-testid={`nav-${label.toLowerCase().replace(/\s/g, '-')}`}><Icon /><span>{label}</span></Link>;
      })}
    </nav>
  );
}

function AppLayout({ children }: { children: ReactNode }) {
  return <div className="app-shell"><Header />{children}<BottomNav /></div>;
}

function WelcomeStrip() {
  const [visible, setVisible] = useState(() => {
    try { return window.localStorage.getItem(WELCOME_STORAGE_KEY) !== 'true'; } catch { return true; }
  });
  if (!visible) return null;
  const dismiss = () => {
    setVisible(false);
    window.localStorage.setItem(WELCOME_STORAGE_KEY, 'true');
  };
  return (
    <section className="welcome-strip" aria-label="Welcome to ESIM ONBOARD">
      <div><ShieldCheck size={18} /><div><strong>Welcome aboard.</strong><span>Browse live plans now, or check an existing eSIM as a guest.</span></div></div>
      <div className="welcome-actions"><Link href="/account" className="button-quiet">Create account</Link><Link href="/guest" className="button-quiet">Guest lookup</Link><button onClick={dismiss} aria-label="Dismiss welcome message">Dismiss</button></div>
    </section>
  );
}

function Dashboard({ lastOrder }: { lastOrder?: EsimOrder }) {
  return (
    <div className="dashboard-row">
      <section className="dashboard-card" data-testid="dashboard-card">
        <div className="card-label">At a glance</div>
        <h2>{lastOrder ? `${formatData(lastOrder)} ready` : 'Your eSIM, at a glance'}</h2>
        <p>{lastOrder ? `${lastOrder.packageName} · ${lastOrder.iccid ? 'Installed profile found' : 'Installation details pending'}` : 'Your active plan, balance, and QR code will live here.'}</p>
        <Link href={lastOrder ? `/order/${lastOrder.orderNo}` : '/esims'} className="dashboard-link">{lastOrder ? 'Open install details' : 'View my eSIMs'} <ArrowRight size={13} /></Link>
      </section>
      <section className="quick-actions">
        <h3>Quick access</h3>
        <Link href="/guest" className="quick-action"><FileSearch size={15} /> Look up with ICCID <ArrowRight size={13} /></Link>
        <Link href="/esims" className="quick-action"><Plus size={15} /> Add data or view plans <ArrowRight size={13} /></Link>
        <div className="conversion-note">Customer prices are shown in PHP. Payment is simulated until a provider is connected.</div>
      </section>
    </div>
  );
}

function PlanCard({ plan, index, selected, onCompare, onBuy }: {
  plan: EsimPlan; index: number; selected: boolean; onCompare: () => void; onBuy: () => void;
}) {
  const data = formatData(plan).split(' ');
  return (
    <article className="plan-card" style={{ animationDelay: `${index * 0.06}s` }} data-testid={`card-plan-${plan.packageCode}`}>
      <div className="plan-top">
        <div><div className="plan-location">{plan.location}</div><h3 className="plan-name">{plan.name}</h3></div>
        <button className={`plan-radio ${selected ? 'selected' : ''}`} onClick={onCompare} aria-label={`${selected ? 'Remove' : 'Add'} ${plan.name} from comparison`}><>{selected ? <Check size={13} /> : <Plus size={14} />}</></button>
      </div>
      <div className="plan-data"><strong>{data[0]}</strong><span>{data[1]}</span></div>
      <div className="plan-meta">
        <div className="meta-cell"><small>Valid for</small><b>{formatDuration(plan.duration, plan.durationUnit)}</b></div>
        <div className="meta-cell"><small>Network</small><b>{plan.speed}</b></div>
        <div className="meta-cell"><small>Activation</small><b>{plan.activeType === 1 ? 'On install' : 'On first use'}</b></div>
        <div className="meta-cell"><small>Top up</small><b>{plan.supportTopUp ? 'Available' : 'Unavailable'}</b></div>
      </div>
      <div className="plan-bottom">
        <div className="price">{formatPhp(plan.pricePhp)}</div>
        <button className="buy-link" onClick={onBuy}>Choose plan <ArrowRight size={13} /></button>
      </div>
    </article>
  );
}

function PurchaseModal({ plan, onClose }: { plan: EsimPlan; onClose: () => void }) {
  const [, navigate] = useLocation();
  const order = useCreateEsimOrder();
  const [step, setStep] = useState<'review' | 'payment'>('review');
  const [demoProcessing, setDemoProcessing] = useState(false);
  const submit = () => {
    setDemoProcessing(true);
    window.setTimeout(() => order.mutate({ data: { packageCode: plan.packageCode, count: 1 } }, {
      onSuccess: (result) => { rememberOrder(result); navigate(`/order/${result.orderNo}`); },
      onError: () => setDemoProcessing(false),
    }), 650);
  };
  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="purchase-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-title" data-testid="dialog-purchase">
        <div className="modal-header"><div><div className="section-kicker">Plan review</div><h2 id="purchase-title">Add data for your route</h2></div><button className="modal-close" onClick={onClose} aria-label="Close purchase dialog"><X size={15} /></button></div>
        <div className="purchase-summary">
          <div><span>Destination</span><strong>{plan.location}</strong></div>
          <div><span>Plan</span><strong>{plan.name}</strong></div>
          <div><span>Data and validity</span><strong>{formatData(plan)} · {formatDuration(plan.duration, plan.durationUnit)}</strong></div>
          <div className="purchase-total"><span>Total today</span><strong>{formatPhp(plan.pricePhp)}</strong></div>
        </div>
        <div className="demo-payment-banner" data-testid="banner-demo-payment"><ShieldCheck size={16} /><div><strong>Demo checkout only</strong><span>No customer payment is collected. This flow submits a live provisioning order after the test step.</span></div></div>
        {step === 'review' ? <p className="modal-note">Review the carrier plan first. The next screen is a clearly marked test payment step; nothing will be charged.</p> : <div className="demo-payment-panel">
          <div className="demo-payment-heading"><CreditCard size={17} /><div><strong>Test payment method</strong><span>Nothing will be charged</span></div></div>
          <div className="fake-payment-field"><span>Payment method</span><b>Demo card ···· 4242</b></div>
          <div className="fake-payment-field"><span>Billing total</span><b>{formatPhp(plan.pricePhp)}</b></div>
          <p className="conversion-note">This PHP price comes from the app pricing configuration. It is not a receipt or charge.</p>
        </div>}
        {order.isError && <div className="modal-error">We could not place this provisioning order. Please try again.</div>}
        <div className="modal-actions"><button className="button-quiet" onClick={step === 'payment' && !demoProcessing ? () => setStep('review') : onClose}>{step === 'payment' ? 'Back' : 'Not yet'}</button><button className="button-primary" onClick={step === 'review' ? () => setStep('payment') : submit} disabled={demoProcessing || order.isPending}>{demoProcessing || order.isPending ? <><LoaderCircle size={15} /> Provisioning</> : step === 'review' ? <>Review demo payment <ArrowRight size={14} /></> : <>Simulate payment and provision <ArrowRight size={14} /></>}</button></div>
      </section>
    </div>
  );
}

function ComparePanel({ plans, onClose, onRemove }: { plans: EsimPlan[]; onClose: () => void; onRemove: (code: string) => void }) {
  return <section className="compare-panel"><div className="compare-heading"><div><div className="eyebrow">Side by side</div><h3>Find your best fit</h3></div><button className="compare-close" onClick={onClose} aria-label="Close comparison"><X size={17} /></button></div><table className="compare-table"><thead><tr><th>Plan</th>{plans.map((plan) => <th key={plan.packageCode}>{plan.location}<button onClick={() => onRemove(plan.packageCode)} aria-label={`Remove ${plan.name}`}><Minus size={11} /></button></th>)}</tr></thead><tbody><tr><td>Data</td>{plans.map((plan) => <td key={plan.packageCode}>{formatData(plan)}</td>)}</tr><tr><td>Validity</td>{plans.map((plan) => <td key={plan.packageCode}>{formatDuration(plan.duration, plan.durationUnit)}</td>)}</tr><tr><td>Speed</td>{plans.map((plan) => <td key={plan.packageCode}>{plan.speed}</td>)}</tr><tr><td>Price</td>{plans.map((plan) => <td key={plan.packageCode}>{formatPhp(plan.pricePhp)}</td>)}</tr></tbody></table></section>;
}

function Catalog() {
  const plansQuery = useGetEsimPlans(undefined, { query: { queryKey: getGetEsimPlansQueryKey() } });
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('All destinations');
  const [compareCodes, setCompareCodes] = useState<string[]>([]);
  const [purchasePlan, setPurchasePlan] = useState<EsimPlan | null>(null);
  const [savedOrders] = useState<EsimOrder[]>(readSavedOrders);
  const { user } = useAuth();
  const { dashboard } = useCustomerDashboard();
  const plans = plansQuery.data?.plans ?? [];
  const regions = plansQuery.data?.regions ?? [];
  const filteredPlans = useMemo(() => plans.filter((plan) => {
    const matchesRegion = region === 'All destinations' || plan.location === region;
    return matchesRegion && `${plan.name} ${plan.location} ${plan.packageCode}`.toLowerCase().includes(search.toLowerCase().trim());
  }), [plans, region, search]);
  const comparePlans = compareCodes.map((code) => plans.find((plan) => plan.packageCode === code)).filter((plan): plan is EsimPlan => Boolean(plan));
  const regionCards = regions.map((item) => ({ name: item, plans: plans.filter((plan) => plan.location === item) })).filter((item) => item.plans.length > 0);
  const showRegionCards = !search.trim() && region === 'All destinations';
  const toggleCompare = (code: string) => setCompareCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : current.length < 3 ? [...current, code] : current);
  return (
    <AppLayout>
      <main className="main-frame">
        <section className="hero"><div className="hero-copy"><div className="eyebrow">Connectivity for the watch</div><h1>Stay online.<br /><span>Stay on course.</span></h1><p className="hero-subtitle">Fast, clear eSIM plans for seafarers. See what is left, know when it expires, and keep your next port within reach.</p></div><div className="hero-signal" aria-hidden="true"><b /><i /><Globe2 size={16} /><i /><b /></div></section>
        <WelcomeStrip />
      <Dashboard lastOrder={user ? dashboard?.recentOrders[0] ? toEsimOrder(dashboard.recentOrders[0]) : undefined : savedOrders[0]} />
        <section className="content-intro"><div><div className="section-kicker">Live carrier catalog</div><h2>Choose your next route</h2></div><span className="result-note">{plansQuery.data ? `${filteredPlans.length} of ${plansQuery.data.total} plans` : 'Loading live plans'}</span></section>
        <div className="filters"><label className="search-box"><Search size={15} className="filter-icon" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by country, region, plan, or data" aria-label="Search plans" /></label><button className="search-submit" type="button" onClick={() => document.querySelector<HTMLInputElement>('.search-box input')?.focus()}>Search Plans</button><label className="select-box"><MapPin size={14} className="filter-icon" /><select value={region} onChange={(event) => setRegion(event.target.value)} aria-label="Filter by destination"><option>All destinations</option>{regions.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} className="filter-icon" /></label><button className="compare-button" onClick={() => setCompareCodes(compareCodes.length ? compareCodes : filteredPlans.slice(0, 2).map((plan) => plan.packageCode))} disabled={!plans.length}><Sparkles size={14} /> Compare {compareCodes.length > 0 && `(${compareCodes.length})`}</button></div>
        {plansQuery.isLoading && <div className="plans-loading">{[1, 2, 3].map((item) => <div className="skeleton" key={item} />)}</div>}
        {plansQuery.isError && <div className="error-state"><span className="state-icon"><CircleAlert size={21} /></span><h3>Plans took a wrong turn</h3><p>We could not reach the live catalog. Your account is safe; please try again.</p><button className="button-dark" onClick={() => plansQuery.refetch()}><RefreshCw size={14} /> Try again</button></div>}
        {!plansQuery.isLoading && !plansQuery.isError && !filteredPlans.length && <div className="empty-state"><span className="state-icon"><PackageOpen size={21} /></span><h3>No plans match that search</h3><p>Try a broader destination or clear your search to see every live plan.</p><button className="button-dark" onClick={() => { setSearch(''); setRegion('All destinations'); }}>Clear filters</button></div>}
         {!plansQuery.isLoading && !plansQuery.isError && showRegionCards && <div className="region-grid">{regionCards.map((section) => <article className="region-card" key={section.name}><div className="card-label">{section.name} eSIM</div><h3>{section.name}</h3><div className="region-plan-preview">{section.plans.slice(0, 4).map((plan) => <button type="button" key={plan.packageCode} onClick={() => setPurchasePlan(plan)}><span>{plan.name}</span><b>{formatData(plan)}</b></button>)}</div><button className="region-browse" type="button" onClick={() => setRegion(section.name)}>Browse {section.name} <ArrowRight size={13} /></button></article>)}</div>}
         {!plansQuery.isLoading && !plansQuery.isError && !showRegionCards && filteredPlans.length > 0 && <div className="plans-grid">{filteredPlans.map((plan, index) => <PlanCard key={plan.packageCode} plan={plan} index={index} selected={compareCodes.includes(plan.packageCode)} onCompare={() => toggleCompare(plan.packageCode)} onBuy={() => setPurchasePlan(plan)} />)}</div>}
        {comparePlans.length >= 2 && <ComparePanel plans={comparePlans} onClose={() => setCompareCodes([])} onRemove={toggleCompare} />}
      </main>
      {purchasePlan && <PurchaseModal plan={purchasePlan} onClose={() => setPurchasePlan(null)} />}
    </AppLayout>
  );
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard?.writeText(value); } catch { /* clipboard can be unavailable in demo preview */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return <button className="copy-button" onClick={copy} aria-label={`Copy ${label}`} title={copied ? 'Copied' : `Copy ${label}`}>{copied ? <Check size={12} /> : <Clipboard size={12} />}</button>;
}

function EsimsPage() {
  const { user } = useAuth();
  const { dashboard, isLoading } = useCustomerDashboard();
  const [savedOrders] = useState<EsimOrder[]>(readSavedOrders);
  const orders = user ? (dashboard?.activeEsims ?? []).map(toEsimOrder) : savedOrders;
  const remoteLatest = dashboard?.activeEsims[0];
  const latest = orders[0];
  return <AppLayout><main className="page-frame"><section className="page-heading"><div><div className="section-kicker">Your connectivity</div><h1>My eSIMs</h1></div><Link href="/" className="button-primary"><Plus size={14} /> Add data</Link></section>
    {isLoading && <div className="plans-loading"><div className="skeleton" /><div className="skeleton" /></div>}
    {!isLoading && latest ? <article className="surface-card" data-testid="active-esim-card"><div className="card-label">Most recent profile</div><h2 className="plan-name">{latest.packageName}</h2><p className="lookup-note">{remoteLatest?.location ?? 'Carrier profile'}</p><div className="esim-meter pending"><span /></div><div className="esim-stat-row"><span>Allowance</span><strong>{formatData(latest)}</strong></div><div className="esim-stat-row"><span>Remaining data</span><strong>{formatBytes(remoteLatest?.remainingBytes)}</strong></div><div className="esim-stat-row"><span>Used data</span><strong>{formatBytes(remoteLatest?.usedBytes)}</strong></div><div className="esim-stat-row"><span>ICCID</span><strong>{latest.iccid ? `${latest.iccid.slice(0, 6)}…${latest.iccid.slice(-4)}` : 'Provisioning'}</strong></div><div className="esim-stat-row"><span>Status</span><strong>{displayEsimStatus(latest, remoteLatest?.remainingBytes)}</strong></div><div className="esim-stat-row"><span>Expires</span><strong>{latest.expiresAt ? new Date(latest.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Carrier pending'}</strong></div><div><Link className="topup-button" href={latest.iccid ? `/guest?iccid=${encodeURIComponent(latest.iccid)}` : '/guest'}><Plus size={13} /> Check top-up options</Link></div><Link href={`/order/${latest.orderNo}`} className="dashboard-link" style={{ position: 'static', marginTop: 16 }}>Open QR and install details <ArrowRight size={13} /></Link></article> : !isLoading && <div className="empty-state"><span className="state-icon"><Smartphone size={21} /></span><h3>No eSIMs saved yet</h3><p>Choose a live plan and your install details will appear here after provisioning.</p><Link href="/" className="button-dark">Browse live plans <ArrowRight size={14} /></Link></div>}
    <article className="surface-card"><div className="card-label">Need to reconnect?</div><h2 className="plan-name">Look up a profile by ICCID</h2><p className="lookup-note">Use the carrier identifier from your phone settings to find an existing installation. We will never pretend a lookup succeeded when the carrier is unavailable.</p><Link href="/guest" className="button-quiet" style={{ marginTop: 15 }}>Open guest lookup <ArrowRight size={13} /></Link></article>
  </main></AppLayout>;
}

function OrdersPage() {
  const { user } = useAuth();
  const { dashboard, isLoading } = useCustomerDashboard();
  const [savedOrders] = useState<EsimOrder[]>(readSavedOrders);
  const remoteOrders = dashboard?.recentOrders ?? [];
  const orders = user ? remoteOrders.map(toEsimOrder) : savedOrders;
  return <AppLayout><main className="page-frame"><section className="page-heading"><div><div className="section-kicker">{user ? 'Customer history' : 'Guest demo history'}</div><h1>Orders</h1></div><p>{orders.length} recent orders</p></section><article className="surface-card"><div className="card-label">Order history</div>{isLoading && <div className="plans-loading"><div className="skeleton" /></div>}{!isLoading && orders.length ? <div className="order-list" style={{ marginTop: 17 }}>{orders.map((order) => { const remote = remoteOrders.find((item) => item.orderNo === order.orderNo); return <Link href={`/order/${order.orderNo}`} className="order-list-item" key={order.orderNo}><div><strong>{order.packageName}</strong><span>{remote?.location ?? 'Guest order'} · {remote?.createdAt ? new Date(remote.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : order.orderNo} · {formatPhp(order.pricePhp)}</span><small>{remote?.paymentStatus ?? 'DEMO_NOT_CHARGED'} · {displayEsimStatus(order)}</small></div><span className={`status-badge ${order.qrCodeUrl ? 'status-ready' : 'status-pending'}`}>{order.qrCodeUrl ? 'Ready' : 'Processing'}</span><ArrowRight size={14} /></Link>; })}</div> : !isLoading && <div className="empty-inline"><PackageOpen size={17} /> No orders saved yet.</div>}<p className="lookup-note">{user ? 'Orders are stored in your customer account.' : 'Guest history is kept locally in this browser. Create an account to keep orders across devices.'}</p></article></main></AppLayout>;
}

function AccountPage() {
  const { user, isLoading, error, login, register, logout, clearError } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (mode === 'login') await login(email, password);
      else await register(name, email, password);
    } catch {
      // AuthContext exposes the server message.
    }
  };
  if (isLoading) return <AppLayout><main className="page-frame"><div className="page-skeleton" /></main></AppLayout>;
  if (!user) return <AppLayout><main className="page-frame"><section className="page-heading"><div><div className="section-kicker">Crew access</div><h1>{mode === 'login' ? 'Log in' : 'Create account'}</h1></div></section><article className="surface-card auth-card"><div className="card-label">Save your eSIMs across devices</div><h2 className="plan-name">{mode === 'login' ? 'Welcome back, crew.' : 'Keep your connection close.'}</h2><p className="lookup-note">Guest access stays open for browsing, purchase, and ICCID lookup. Create an account when you want persistent orders and dashboard data.</p><form className="auth-form" onSubmit={submit}>{mode === 'register' && <label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Your name" required /></label>}<label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" minLength={8} required /></label>{error && <div className="modal-error" role="alert">{error}</div>}<button className="button-primary" type="submit">{mode === 'login' ? 'Log in' : 'Create account'} <ArrowRight size={14} /></button></form><div className="auth-switch"><button type="button" onClick={() => { clearError(); setMode(mode === 'login' ? 'register' : 'login'); }}>{mode === 'login' ? 'Need an account? Create one' : 'Already registered? Log in'}</button><Link href="/" className="button-quiet">Continue as guest</Link></div></article></main></AppLayout>;
  return <AppLayout><main className="page-frame"><section className="page-heading"><div><div className="section-kicker">Crew settings</div><h1>Account</h1></div><button className="button-quiet" onClick={() => void logout()}>Log out</button></section><article className="surface-card"><div className="card-label">{user.role === 'admin' ? 'Administrator account' : 'Customer account'}</div><h2 className="plan-name">Welcome, {user.name}</h2><p className="lookup-note">{user.email}</p><div className="help-grid"><button className="help-tile" onClick={() => setSupportMessage('Support contact is not connected in this demo.')}><HelpCircle size={17} /><strong>Get help</strong><span>Installation and carrier guidance</span></button><button className="help-tile" onClick={() => setSupportMessage('Network status is available from each live order detail page.')}><Settings2 size={17} /><strong>Network status</strong><span>Check provisioning details</span></button></div>{user.role === 'admin' && <Link href="/admin" className="admin-link"><BarChart3 size={16} /> Open admin dashboard <ArrowRight size={13} /></Link>}{supportMessage && <p className="lookup-note" role="status">{supportMessage}</p>}</article><article className="surface-card"><div className="card-label">Pricing note</div><h2 className="plan-name">Clear numbers, no surprises</h2><p className="lookup-note">Customer-facing prices are shown in Philippine pesos. Demo checkout never charges money.</p></article></main></AppLayout>;
}

type AdminPlan = { packageCode: string; name: string; location: string; dataGb: number; duration: number; durationUnit: string; providerPricePhp: number; markupPhp: number; sellingPricePhp: number | null; customerPricePhp: number; enabled: boolean };
type AdminOverview = { totalOrders: number; totalCustomers: number; totalEsimsSold: number; activeEsims: number; revenuePhp: number; recentOrders: Array<{ orderNo: string; packageName: string; location: string; amountPhp: number; paymentStatus: string; esimStatus: string; createdAt: string }> };

function AdminPage() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [nextOverview, nextPlans, nextLogs] = await Promise.all([
        requestJson<AdminOverview>('/api/admin/overview'),
        requestJson<{ plans: AdminPlan[] }>('/api/admin/plans'),
        requestJson<{ logs: Array<Record<string, unknown>> }>('/api/admin/activity'),
      ]);
      setOverview(nextOverview); setPlans(nextPlans.plans); setLogs(nextLogs.logs);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Admin data could not be loaded'); }
  }, []);
  useEffect(() => { if (user?.role === 'admin') void refresh(); }, [refresh, user?.role]);
  if (!user || user.role !== 'admin') return <AppLayout><main className="page-frame"><div className="error-state"><span className="state-icon"><CircleAlert size={21} /></span><h3>Admin access required</h3><p>This dashboard is only available to authorized administrators.</p><Link href="/account" className="button-dark">Back to account</Link></div></main></AppLayout>;
  const updatePlan = async (plan: AdminPlan, field: 'markupPhp' | 'sellingPricePhp' | 'enabled', value: string | boolean) => {
    const numberValue = typeof value === 'boolean' ? null : Number(value);
    if (field !== 'enabled' && (numberValue === null || !Number.isFinite(numberValue) || numberValue < 0)) return;
    const result = await requestJson<{ markupPhp: number; sellingPricePhp: number | null; customerPricePhp: number; enabled: boolean }>(`/api/admin/plans/${encodeURIComponent(plan.packageCode)}`, { method: 'PATCH', body: JSON.stringify({ [field]: field === 'enabled' ? value : numberValue }) });
    setPlans((current) => current.map((item) => item.packageCode === plan.packageCode ? { ...item, ...result } : item));
    void refresh();
  };
  return <AppLayout><main className="page-frame admin-page"><section className="page-heading"><div><div className="section-kicker">Restricted workspace</div><h1>Admin dashboard</h1></div><button className="button-quiet" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button></section>{error && <div className="modal-error">{error}</div>}{overview && <><div className="admin-stat-grid">{[['Orders', overview.totalOrders], ['Customers', overview.totalCustomers], ['eSIMs sold', overview.totalEsimsSold], ['Active eSIMs', overview.activeEsims], ['Revenue', formatPhp(overview.revenuePhp)]].map(([label, value]) => <div className="admin-stat" key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}</div><article className="surface-card"><div className="card-label">Recent orders</div><div className="order-list">{overview.recentOrders.map((order) => <div className="order-list-item" key={order.orderNo}><div><strong>{order.packageName}</strong><span>{order.location} · {order.orderNo} · {formatPhp(order.amountPhp)}</span></div><span className="status-badge status-pending">{order.paymentStatus}</span></div>)}</div></article></> }<article className="surface-card"><div className="card-label">Plan management</div><h2 className="plan-name">Customer pricing</h2><p className="lookup-note">Provider cost stays in this protected admin view. Customers only receive the final selling price.</p><div className="admin-plan-list">{plans.map((plan) => <div className="admin-plan-row" key={plan.packageCode}><div><strong>{plan.name}</strong><span>{plan.location} · {plan.dataGb} GB · {plan.duration} {plan.durationUnit}</span></div><div className="admin-price-fields"><label>Markup<input type="number" min="0" step="1" value={plan.markupPhp} onChange={(event) => void updatePlan(plan, 'markupPhp', event.target.value)} /></label><label>Selling price<input type="number" min="0" step="1" value={plan.sellingPricePhp ?? ''} placeholder="Markup price" onChange={(event) => void updatePlan(plan, 'sellingPricePhp', event.target.value)} /></label><b>{formatPhp(plan.customerPricePhp)}</b><button className="button-quiet plan-status-button" type="button" onClick={() => void updatePlan(plan, 'enabled', !plan.enabled)}>{plan.enabled ? 'Enabled' : 'Disabled'}</button></div></div>)}</div></article><article className="surface-card"><div className="card-label">Activity log</div><h2 className="plan-name">Recent admin actions</h2><div className="activity-list">{logs.slice(0, 20).map((log, index) => <div className="activity-row" key={String(log.id ?? index)}><span>{log.createdAt ? new Date(String(log.createdAt)).toLocaleString() : '—'}</span><strong>{String(log.action ?? 'Activity')}</strong><small>{String(log.actor ?? 'Unknown')} · {String(log.result ?? '—')}</small></div>)}</div></article></main></AppLayout>;
}

function GuestPage() {
  const [iccid, setIccid] = useState(() => new URLSearchParams(window.location.search).get('iccid') ?? '');
  const [searchedIccid, setSearchedIccid] = useState(() => new URLSearchParams(window.location.search).get('iccid') ?? '');
  const [topupStep, setTopupStep] = useState<'review' | 'payment'>('review');
  const [selectedTopup, setSelectedTopup] = useState('');
  const lookupIccid = searchedIccid || '0000000000';
  const lookupQuery = useGetEsimLookup(
    { iccid: lookupIccid },
    {
      query: {
        enabled: searchedIccid.length >= 10,
        queryKey: getGetEsimLookupQueryKey({ iccid: searchedIccid }),
      },
    },
  );
  const topupsQuery = useGetEsimTopups(
    { iccid: lookupIccid },
    {
      query: {
        enabled: Boolean(lookupQuery.data?.supportTopUp) && searchedIccid.length >= 10,
        queryKey: getGetEsimTopupsQueryKey({ iccid: searchedIccid }),
      },
    },
  );
  const topupMutation = useCreateEsimTopup();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = iccid.replace(/\D/g, '');
    if (normalized.length < 10) return;
    setSelectedTopup('');
    setTopupStep('review');
    setSearchedIccid(normalized);
  };
  const lookup = lookupQuery.data;
  const selectedPlan = topupsQuery.data?.plans.find((plan) => plan.packageCode === selectedTopup);
  const submitTopup = () => {
    if (!selectedPlan) return;
    topupMutation.mutate({
      data: { iccid: searchedIccid, packageCode: selectedPlan.packageCode },
    });
  };

  return (
    <AppLayout>
      <main className="page-frame">
        <section className="page-heading">
          <div><div className="section-kicker">No account required</div><h1>Guest lookup</h1></div>
        </section>
        <article className="surface-card">
          <div className="card-label">Find an eSIM</div>
          <h2 className="plan-name">Enter your ICCID</h2>
          <p className="lookup-note">The ICCID is the long number shown in your phone’s cellular plan details. We only display information returned by the carrier.</p>
          <form className="lookup-form" onSubmit={submit}>
            <input value={iccid} onChange={(event) => setIccid(event.target.value)} inputMode="numeric" placeholder="Enter ICCID" aria-label="ICCID" />
            <button className="button-primary" type="submit" disabled={iccid.replace(/\D/g, '').length < 10 || lookupQuery.isFetching}>
              {lookupQuery.isFetching ? <><LoaderCircle size={14} /> Checking</> : 'Check ICCID'}
            </button>
          </form>
        </article>
        {lookupQuery.isError && <div className="error-state" style={{ marginTop: 14, padding: 25 }}><span className="state-icon"><CircleAlert size={19} /></span><h3>We could not find that eSIM</h3><p>Check the ICCID and try again. The carrier did not return a usable profile.</p><button className="button-dark" type="button" onClick={() => { setSearchedIccid(''); setIccid(''); }}>Try another ICCID</button></div>}
        {lookup && <article className="surface-card lookup-result">
          <div className="card-label">Carrier profile found</div>
          <div className="lookup-result-heading"><div><h2 className="plan-name">{lookup.packageName}</h2><p className="lookup-note">{lookup.iccid}</p></div><span className="status-badge status-ready">{lookup.status}</span></div>
          <div className="lookup-stats">
            <div><span>Remaining data</span><strong>{formatBytes(lookup.remainingBytes)}</strong></div>
            <div><span>Used data</span><strong>{formatBytes(lookup.usedBytes)}</strong></div>
            <div><span>Allowance</span><strong>{formatBytes(lookup.totalVolumeBytes)}</strong></div>
            <div><span>Expires</span><strong>{lookup.expiresAt ? new Date(lookup.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not available'}</strong></div>
          </div>
          {lookup.qrCodeUrl && <a className="install-link" href={lookup.qrCodeUrl} target="_blank" rel="noreferrer"><Smartphone size={14} /> Open carrier QR <ArrowRight size={13} /></a>}
          {lookup.supportTopUp ? <div className="topup-panel">
            <div className="card-label">Compatible top-ups</div>
            {topupsQuery.isLoading && <p className="lookup-note">Checking compatible carrier packages…</p>}
            {topupsQuery.isError && <p className="lookup-note">Compatible top-up packages could not be loaded.</p>}
            {!topupsQuery.isLoading && !topupsQuery.isError && !topupsQuery.data?.plans.length && <p className="lookup-note">The carrier did not return a compatible top-up package.</p>}
            {!!topupsQuery.data?.plans.length && <><select className="topup-select" value={selectedTopup} onChange={(event) => setSelectedTopup(event.target.value)} aria-label="Choose a compatible top-up"><option value="">Choose a compatible package</option>{topupsQuery.data.plans.map((plan) => <option key={plan.packageCode} value={plan.packageCode}>{formatData(plan)} · {formatDuration(plan.duration, plan.durationUnit)} · {formatPhp(plan.pricePhp)}</option>)}</select>{selectedPlan && <div className="topup-review">
              <div className="fake-payment-field"><span>Top-up total</span><b>{formatPhp(selectedPlan.pricePhp)}</b></div>
              <div className="demo-payment-banner"><ShieldCheck size={15} /><div><strong>Demo payment only</strong><span>No customer payment is collected. The final step submits a live carrier top-up.</span></div></div>
              {topupMutation.isSuccess ? <div className="success-state"><Check size={17} /><span>{topupMutation.data.message}</span></div> : <div className="modal-actions"><button className="button-quiet" type="button" onClick={() => setTopupStep(topupStep === 'review' ? 'payment' : 'review')}>{topupStep === 'review' ? 'Review payment' : 'Back'}</button><button className="button-primary" type="button" onClick={submitTopup} disabled={topupStep === 'review' || topupMutation.isPending}>{topupMutation.isPending ? <><LoaderCircle size={14} /> Processing</> : 'Simulate payment and top up'}</button></div>}
            </div>}</>}
          </div> : <p className="lookup-note">This eSIM does not report top-up support from the carrier.</p>}
        </article>}
        <p className="lookup-note">For a newly purchased eSIM, use Orders to open live provisioning and QR installation details.</p>
      </main>
    </AppLayout>
  );
}

function OrderPage() {
  const params = useParams<{ orderNo: string }>();
  const orderNo = params.orderNo ?? '';
  const orderQuery = useGetEsimOrder(orderNo, { query: { enabled: Boolean(orderNo), queryKey: getGetEsimOrderQueryKey(orderNo), refetchInterval: 4000 } });
  const order = orderQuery.data;
  const status = (order?.status ?? order?.smdpStatus ?? 'PROCESSING').toUpperCase();
  const ready = Boolean(order?.qrCodeUrl || order?.shortUrl || order?.iccid);
  const failed = status.includes('FAIL') || status.includes('ERROR');
  const statusClass = failed ? 'status-error' : ready ? 'status-ready' : 'status-pending';
  const statusLabel = failed ? 'Needs attention' : ready ? 'Ready to install' : 'Provisioning';
  return <AppLayout><main className="order-page"><Link href="/orders" className="back-link"><ArrowRight size={14} style={{ transform: 'rotate(180deg)' }} /> Back to orders</Link>{orderQuery.isLoading && <div className="page-skeleton" />}{orderQuery.isError && <div className="error-state" style={{ marginTop: 45 }}><span className="state-icon"><CircleAlert size={21} /></span><h3>We could not find that order</h3><p>The provisioning service did not return this order. Check the order number and try again.</p><button className="button-dark" onClick={() => orderQuery.refetch()}><RefreshCw size={14} /> Check again</button></div>}{order && !orderQuery.isError && <><section className="order-hero"><div><div className="section-kicker">Order {order.orderNo}</div><h1>Your connection is<br />coming online.</h1><p>Keep this page handy while you install your new plan.</p></div><div className={`status-badge ${statusClass}`}><span>●</span>{statusLabel}</div></section><section className="order-layout"><article className="qr-card"><div className="card-label">Install your eSIM</div><h2>Scan to connect</h2><p>Open cellular settings, choose Add eSIM, then scan this code when prompted.</p><div className={`qr-frame ${order.qrCodeUrl ? '' : 'qr-pending'}`}>{order.qrCodeUrl ? <img src={order.qrCodeUrl} alt="QR code to install your eSIM" /> : <><LoaderCircle size={24} /><span>{failed ? 'Provisioning needs attention' : 'Your QR code is on its way'}</span></>}</div>{order.shortUrl && <a className="install-link" href={order.shortUrl} target="_blank" rel="noreferrer"><Smartphone size={14} /> Open install link <ArrowRight size={13} /></a>}{!order.qrCodeUrl && !order.shortUrl && <p className="order-footnote">This page checks for provisioning updates automatically. You can safely leave it open.</p>}</article><article className="details-card"><div className="card-label">Order details</div><h2>{order.packageName}</h2><dl className="details-list"><div className="detail-row"><dt>Order number</dt><dd>{order.orderNo}<CopyValue value={order.orderNo} label="order number" /></dd></div><div className="detail-row"><dt>Data allowance</dt><dd>{formatData(order)}</dd></div><div className="detail-row"><dt>Validity</dt><dd>{order.totalDuration && order.durationUnit ? formatDuration(order.totalDuration, order.durationUnit) : 'Pending'}</dd></div><div className="detail-row"><dt>ICCID</dt><dd>{order.iccid ?? 'Pending'}{order.iccid && <CopyValue value={order.iccid} label="ICCID" />}</dd></div><div className="detail-row"><dt>Transaction</dt><dd>{order.transactionId}</dd></div>{order.expiresAt && <div className="detail-row"><dt>Expires</dt><dd>{new Date(order.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</dd></div>}</dl><p className="order-footnote"><ShieldCheck size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} /> Details are pulled directly from the carrier network.</p></article></section></>}</main></AppLayout>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={Catalog} /><Route path="/esims" component={EsimsPage} /><Route path="/orders" component={OrdersPage} /><Route path="/account" component={AccountPage} /><Route path="/admin" component={AdminPage} /><Route path="/guest" component={GuestPage} /><Route path="/order/:orderNo" component={OrderPage} /><Route component={() => <div className="page-frame"><div className="error-state"><span className="state-icon"><CircleAlert size={21} /></span><h3>That page is off the route</h3><p>Return home to browse connectivity plans.</p><Link href="/" className="button-dark">Go home</Link></div></div>} /></Switch></ErrorBoundary>;
}

function App() {
  return <AuthProvider><QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider></AuthProvider>;
}

export default App;