import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  CreditCard,
  Globe2,
  LoaderCircle,
  MapPin,
  Minus,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wifi,
  X,
} from 'lucide-react';
import {
  getGetEsimBalanceQueryKey,
  getGetEsimOrderQueryKey,
  getGetEsimPlansQueryKey,
  type EsimPlan,
  useCreateEsimOrder,
  useGetEsimBalance,
  useGetEsimOrder,
  useGetEsimPlans,
} from '@workspace/api-client-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function Brand() {
  return (
    <Link href="/" className="brand-mark" data-testid="link-brand-home">
      <span className="brand-symbol"><Wifi size={18} strokeWidth={2.5} /></span>
      <span className="brand-word">roam<em>ly</em></span>
    </Link>
  );
}

function Header({ balance, loading }: { balance?: number; loading: boolean }) {
  return (
    <header className="site-header">
      <Brand />
      <div className="header-actions">
        <div className="balance-pill" data-testid="display-account-balance">
          <span className="balance-label">Account credit</span>
          {loading ? <span className="skeleton" style={{ height: 13, width: 50, borderRadius: 5 }} /> : <span className="balance-value">{balance === undefined ? '—' : `$${balance.toFixed(2)}`}</span>}
        </div>
        <span className="avatar" data-testid="display-account-avatar">R</span>
      </div>
    </header>
  );
}

function formatDuration(duration: number, unit: string) {
  const normalized = unit.toLowerCase();
  return `${duration} ${duration === 1 ? normalized.replace(/s$/, '') : normalized}`;
}

function formatData(plan: EsimPlan) {
  if (plan.dataGb) return `${plan.dataGb} GB`;
  return `${(plan.volumeBytes / 1073741824).toFixed(1)} GB`;
}

function PlanCard({ plan, index, selected, onCompare, onBuy }: {
  plan: EsimPlan; index: number; selected: boolean; onCompare: () => void; onBuy: () => void;
}) {
  return (
    <article className="plan-card" style={{ animationDelay: `${index * 0.06}s` }} data-testid={`card-plan-${plan.packageCode}`}>
      <div className="plan-top">
        <div>
          <div className="plan-location" data-testid={`text-plan-location-${plan.packageCode}`}>{plan.location}</div>
          <h3 className="plan-name" data-testid={`text-plan-name-${plan.packageCode}`}>{plan.name}</h3>
        </div>
        <button className={`plan-radio ${selected ? 'selected' : ''}`} onClick={onCompare} aria-label={`${selected ? 'Remove' : 'Add'} ${plan.name} from comparison`} data-testid={`button-compare-${plan.packageCode}`}>
          {selected ? <Check size={14} /> : <Plus size={15} />}
        </button>
      </div>
      <div className="plan-data"><strong data-testid={`text-plan-data-${plan.packageCode}`}>{formatData(plan).split(' ')[0]}</strong><span>{formatData(plan).split(' ')[1]}</span></div>
      <div className="plan-meta">
        <div className="meta-cell"><small>Valid for</small><b>{formatDuration(plan.duration, plan.durationUnit)}</b></div>
        <div className="meta-cell"><small>Network</small><b>{plan.speed}</b></div>
        <div className="meta-cell"><small>Activation</small><b>{plan.activeType === 1 ? 'On install' : 'On first use'}</b></div>
        <div className="meta-cell"><small>Top up</small><b>{plan.supportTopUp ? 'Available' : 'Not available'}</b></div>
      </div>
      <div className="plan-bottom">
        <div className="price" data-testid={`text-plan-price-${plan.packageCode}`}>${plan.priceUsd.toFixed(2)} {plan.retailPriceUsd > plan.priceUsd && <small>${plan.retailPriceUsd.toFixed(2)}</small>}</div>
        <button className="buy-link" onClick={onBuy} data-testid={`button-buy-${plan.packageCode}`}>Choose plan <ArrowRight size={14} /></button>
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
    window.setTimeout(() => {
      order.mutate({ data: { packageCode: plan.packageCode, count: 1 } }, {
        onSuccess: (result) => navigate(`/order/${result.orderNo}`),
        onError: () => setDemoProcessing(false),
      });
    }, 850);
  };
  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="purchase-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-title" data-testid="dialog-purchase">
        <div className="modal-header">
          <div><div className="section-kicker">Ready when you are</div><h2 id="purchase-title">Add data for your trip</h2></div>
          <button className="modal-close" onClick={onClose} aria-label="Close purchase dialog" data-testid="button-close-purchase"><X size={16} /></button>
        </div>
        <div className="purchase-summary">
          <div><span>Destination</span><strong>{plan.location}</strong></div>
          <div><span>Plan</span><strong>{plan.name}</strong></div>
          <div><span>Data & validity</span><strong>{formatData(plan)} · {formatDuration(plan.duration, plan.durationUnit)}</strong></div>
          <div className="purchase-total"><span>Total today</span><strong>${plan.priceUsd.toFixed(2)}</strong></div>
        </div>
        <div className="demo-payment-banner" data-testid="banner-demo-payment">
          <ShieldCheck size={17} />
          <div><strong>Demo checkout mode</strong><span>No customer payment is collected yet. This simulates checkout and uses account credit to provision the eSIM.</span></div>
        </div>
        {step === 'review' ? (
          <p className="modal-note">Review your plan first. The next step is a simulated payment screen for testing the complete customer journey.</p>
        ) : (
          <div className="demo-payment-panel" data-testid="panel-demo-payment">
            <div className="demo-payment-heading"><CreditCard size={18} /><div><strong>Test payment</strong><span>Nothing will be charged</span></div></div>
            <div className="fake-payment-field"><span>Payment method</span><b>Demo card ···· 4242</b></div>
            <div className="fake-payment-field"><span>Billing total</span><b>${plan.priceUsd.toFixed(2)} USD</b></div>
            <p className="modal-note">When real payments are added, this step will be replaced by a secure payment checkout.</p>
          </div>
        )}
        {order.isError && <div className="modal-error" data-testid="status-purchase-error">We could not place this order. Check your account credit and try again.</div>}
        <div className="modal-actions">
          <button className="button-quiet" onClick={step === 'payment' && !demoProcessing ? () => setStep('review') : onClose} data-testid="button-cancel-purchase">{step === 'payment' ? 'Back' : 'Not yet'}</button>
          <button className="button-primary" onClick={step === 'review' ? () => setStep('payment') : submit} disabled={demoProcessing || order.isPending} data-testid="button-confirm-purchase">
            {demoProcessing || order.isPending ? <><LoaderCircle size={16} className="spin" /> Provisioning</> : step === 'review' ? <>Continue to demo payment <ArrowRight size={15} /></> : <>Simulate payment & provision <ArrowRight size={15} /></>}
          </button>
        </div>
      </section>
    </div>
  );
}

function ComparePanel({ plans, onClose, onRemove }: { plans: EsimPlan[]; onClose: () => void; onRemove: (code: string) => void }) {
  return (
    <section className="compare-panel" data-testid="panel-plan-comparison">
      <div className="compare-heading"><div><div className="eyebrow">Side by side</div><h3>Find your best fit</h3></div><button className="compare-close" onClick={onClose} aria-label="Close comparison" data-testid="button-close-comparison"><X size={18} /></button></div>
      <table className="compare-table">
        <thead><tr><th>Plan</th>{plans.map((plan) => <th key={plan.packageCode}>{plan.location}<button onClick={() => onRemove(plan.packageCode)} aria-label={`Remove ${plan.name}`} data-testid={`button-remove-compare-${plan.packageCode}`}><Minus size={12} /></button></th>)}</tr></thead>
        <tbody>
          <tr><td>Data</td>{plans.map((plan) => <td key={plan.packageCode}>{formatData(plan)}</td>)}</tr>
          <tr><td>Validity</td>{plans.map((plan) => <td key={plan.packageCode}>{formatDuration(plan.duration, plan.durationUnit)}</td>)}</tr>
          <tr><td>Speed</td>{plans.map((plan) => <td key={plan.packageCode}>{plan.speed}</td>)}</tr>
          <tr><td>Price</td>{plans.map((plan) => <td key={plan.packageCode}>${plan.priceUsd.toFixed(2)}</td>)}</tr>
        </tbody>
      </table>
    </section>
  );
}

function Catalog() {
  const plansQuery = useGetEsimPlans(undefined, { query: { queryKey: getGetEsimPlansQueryKey() } });
  const balanceQuery = useGetEsimBalance({ query: { queryKey: getGetEsimBalanceQueryKey() } });
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('All destinations');
  const [compareCodes, setCompareCodes] = useState<string[]>([]);
  const [purchasePlan, setPurchasePlan] = useState<EsimPlan | null>(null);
  const plans = plansQuery.data?.plans ?? [];
  const regions = plansQuery.data?.regions ?? [];
  const filteredPlans = useMemo(() => plans.filter((plan) => {
    const matchesRegion = region === 'All destinations' || plan.location === region;
    const haystack = `${plan.name} ${plan.location} ${plan.packageCode}`.toLowerCase();
    return matchesRegion && haystack.includes(search.toLowerCase().trim());
  }), [plans, region, search]);
  const comparePlans = compareCodes.map((code) => plans.find((plan) => plan.packageCode === code)).filter((plan): plan is EsimPlan => Boolean(plan));
  const toggleCompare = (code: string) => setCompareCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : current.length < 3 ? [...current, code] : current);

  return (
    <div className="app-shell">
      <Header balance={balanceQuery.data?.balanceUsd} loading={balanceQuery.isLoading} />
      <main className="main-frame">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">Travel data, sorted</div>
            <h1>Go further.<br /><span>Stay connected.</span></h1>
            <p className="hero-subtitle">Simple eSIM plans for the places you are going. Pick your destination, land connected, and leave roaming surprises behind.</p>
          </div>
          <div className="route-line" aria-hidden="true"><span className="route-dot" /><i /><Globe2 size={17} /><i /><span className="route-dot" /></div>
        </section>
        <section className="content-intro">
          <div><div className="section-kicker">Live plan catalog</div><h2>Where are you headed?</h2></div>
          <span className="result-note" data-testid="text-plan-count">{plansQuery.data ? `${filteredPlans.length} of ${plansQuery.data.total} plans` : 'Loading live plans'}</span>
        </section>
        <div className="filters">
          <label className="search-box"><Search size={16} className="filter-icon" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search a country or region" aria-label="Search plans" data-testid="input-search-plans" /></label>
          <label className="select-box"><MapPin size={15} className="filter-icon" /><select value={region} onChange={(event) => setRegion(event.target.value)} aria-label="Filter by destination" data-testid="select-region"><option>All destinations</option>{regions.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={15} className="filter-icon" /></label>
          <button className="compare-button" onClick={() => setCompareCodes(compareCodes.length ? compareCodes : filteredPlans.slice(0, 2).map((plan) => plan.packageCode))} disabled={!plans.length} data-testid="button-open-comparison"><Sparkles size={15} /> Compare {compareCodes.length > 0 && `(${compareCodes.length})`}</button>
        </div>
        {plansQuery.isLoading && <div className="plans-loading" data-testid="state-plans-loading">{[1, 2, 3].map((item) => <div className="skeleton" key={item} />)}</div>}
        {plansQuery.isError && <div className="error-state" data-testid="state-plans-error"><span className="state-icon"><CircleAlert size={22} /></span><h3>Plans took a wrong turn</h3><p>We could not reach the live catalog. Your account is safe — please try again.</p><button className="button-dark" onClick={() => plansQuery.refetch()} data-testid="button-retry-plans"><RefreshCw size={15} /> Try again</button></div>}
        {!plansQuery.isLoading && !plansQuery.isError && !filteredPlans.length && <div className="empty-state" data-testid="state-plans-empty"><span className="state-icon"><PackageOpen size={22} /></span><h3>No plans match that search</h3><p>Try a broader destination or clear your search to see every live plan.</p><button className="button-dark" onClick={() => { setSearch(''); setRegion('All destinations'); }} data-testid="button-clear-filters">Clear filters</button></div>}
        {!plansQuery.isLoading && !plansQuery.isError && filteredPlans.length > 0 && <div className="plans-grid">{filteredPlans.map((plan, index) => <PlanCard key={plan.packageCode} plan={plan} index={index} selected={compareCodes.includes(plan.packageCode)} onCompare={() => toggleCompare(plan.packageCode)} onBuy={() => setPurchasePlan(plan)} />)}</div>}
        {comparePlans.length >= 2 && <ComparePanel plans={comparePlans} onClose={() => setCompareCodes([])} onRemove={(code) => toggleCompare(code)} />}
      </main>
      {purchasePlan && <PurchaseModal plan={purchasePlan} onClose={() => setPurchasePlan(null)} />}
    </div>
  );
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return <button className="copy-button" onClick={copy} aria-label={`Copy ${label}`} data-testid={`button-copy-${label}`} title={copied ? 'Copied' : `Copy ${label}`}>{copied ? <Check size={13} /> : <Clipboard size={13} />}</button>;
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

  return (
    <div className="app-shell">
      <header className="site-header"><Brand /><Link href="/" className="back-link" data-testid="link-back-catalog"><ArrowRight size={15} style={{ transform: 'rotate(180deg)' }} /> Browse plans</Link></header>
      <main className="order-page">
        <Link href="/" className="back-link" data-testid="link-order-back"><ArrowRight size={15} style={{ transform: 'rotate(180deg)' }} /> Back to catalog</Link>
        {orderQuery.isLoading && <div className="page-skeleton" data-testid="state-order-loading" />}
        {orderQuery.isError && <div className="error-state" style={{ marginTop: 50 }} data-testid="state-order-error"><span className="state-icon"><CircleAlert size={22} /></span><h3>We could not find that order</h3><p>The provisioning service did not return this order. Check the order number and try again.</p><button className="button-dark" onClick={() => orderQuery.refetch()} data-testid="button-retry-order"><RefreshCw size={15} /> Check again</button></div>}
        {order && !orderQuery.isError && <><section className="order-hero"><div><div className="section-kicker">Order {order.orderNo}</div><h1>Your trip is<br />coming online.</h1><p>Keep this page handy while you install your new plan.</p></div><div className={`status-badge ${statusClass}`} data-testid="status-order"><span>●</span>{statusLabel}</div></section><section className="order-layout">
          <article className="qr-card">
            <div className="card-label">Install your eSIM</div><h2>Scan to connect</h2><p>On your phone, open your cellular settings and add an eSIM. Scan this code when prompted.</p>
            <div className={`qr-frame ${order.qrCodeUrl ? '' : 'qr-pending'}`} data-testid="display-order-qr">{order.qrCodeUrl ? <img src={order.qrCodeUrl} alt="QR code to install your eSIM" /> : <><LoaderCircle size={25} /><span>{failed ? 'Provisioning needs a retry' : 'Your QR code is on its way'}</span></>}</div>
            {order.shortUrl && <a className="install-link" href={order.shortUrl} target="_blank" rel="noreferrer" data-testid="link-install-esim"><Smartphone size={15} /> Open install link <ArrowRight size={14} /></a>}
            {!order.qrCodeUrl && !order.shortUrl && <p className="order-footnote">This page checks for provisioning updates automatically. You can safely leave it open.</p>}
          </article>
          <article className="details-card">
            <div className="card-label">Order details</div><h2>{order.packageName}</h2>
            <dl className="details-list">
              <div className="detail-row"><dt>Order number</dt><dd data-testid="text-order-number">{order.orderNo}<CopyValue value={order.orderNo} label="order-number" /></dd></div>
              <div className="detail-row"><dt>Data allowance</dt><dd data-testid="text-order-data">{order.dataGb ? `${order.dataGb} GB` : order.totalVolumeBytes ? `${(order.totalVolumeBytes / 1073741824).toFixed(1)} GB` : 'Pending'}</dd></div>
              <div className="detail-row"><dt>Validity</dt><dd data-testid="text-order-duration">{order.totalDuration && order.durationUnit ? formatDuration(order.totalDuration, order.durationUnit) : 'Pending'}</dd></div>
              <div className="detail-row"><dt>ICCID</dt><dd data-testid="text-order-iccid">{order.iccid ?? 'Pending'}{order.iccid && <CopyValue value={order.iccid} label="ICCID" />}</dd></div>
              <div className="detail-row"><dt>Transaction</dt><dd data-testid="text-transaction-id">{order.transactionId}</dd></div>
              {order.expiresAt && <div className="detail-row"><dt>Expires</dt><dd data-testid="text-order-expiry">{new Date(order.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</dd></div>}
            </dl>
            <p className="order-footnote"><ShieldCheck size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} /> Your plan details are pulled directly from the carrier network.</p>
          </article>
        </section></>}
      </main>
    </div>
  );
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={Catalog} /><Route path="/order/:orderNo" component={OrderPage} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
