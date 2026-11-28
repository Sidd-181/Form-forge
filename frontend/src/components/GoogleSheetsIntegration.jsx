import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Table2 } from 'lucide-react';
import { api } from '../services/api.js';
import { Button, Dialog, Toggle, cn } from './ui.jsx';

const initialConfig = { enabled: false, spreadsheetId: '', sheetId: '' };
const formatDate = value => value ? new Date(value).toLocaleString() : 'Not attempted yet';

function DeliveryStatus({ status }) {
    const success = status === 'success';
    const failed = status === 'failed';
    return <span className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        success ? 'bg-emerald-50 text-emerald-700' : failed ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700',
    )}>
      {success ? <CheckCircle2 size={13}/> : failed ? <AlertCircle size={13}/> : <Loader2 size={13} className={status === 'syncing' ? 'animate-spin' : ''}/>}
      {status === 'success' ? 'Success' : status === 'failed' ? 'Failed' : status === 'syncing' ? 'Syncing' : 'Pending'}
    </span>;
}

export default function GoogleSheetsIntegration({ form, onClose, oauthStatus }) {
    const [connection, setConnection] = useState(null);
    const [integration, setIntegration] = useState(initialConfig);
    const [spreadsheets, setSpreadsheets] = useState([]);
    const [worksheets, setWorksheets] = useState([]);
    const [deliveries, setDeliveries] = useState([]);
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState(
        oauthStatus === 'connected' ? 'Google account connected.' : oauthStatus === 'error' ? 'Google account connection was not completed.' : '',
    );

    const refreshDeliveries = async () => {
        const result = await api.googleSheetsForm(form.id);
        setIntegration(result.integration ?? initialConfig);
        setEnabled(result.integration?.enabled ?? false);
        setDeliveries(result.deliveries ?? []);
    };

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setError('');
            try {
                const [connected, formData] = await Promise.all([
                    api.googleSheetsConnection(),
                    api.googleSheetsForm(form.id),
                ]);
                if (cancelled) return;
                setConnection(connected);
                const config = formData.integration ?? initialConfig;
                setIntegration(config);
                setEnabled(config.enabled);
                setDeliveries(formData.deliveries ?? []);
                if (connected.connected) {
                    const spreadsheetList = await api.googleSheetsSpreadsheets();
                    if (cancelled) return;
                    setSpreadsheets(spreadsheetList);
                    if (config.spreadsheetId) {
                        const sheetList = await api.googleSheetsWorksheets(config.spreadsheetId);
                        if (cancelled) return;
                        setWorksheets(sheetList);
                    }
                }
            }
            catch (loadError) {
                if (!cancelled) setError(loadError.message ?? 'Could not load Google Sheets settings.');
            }
            finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [form.id]);

    const connect = async () => {
        setBusy(true);
        setError('');
        try {
            const result = await api.connectGoogleSheets({ returnTo: window.location.pathname });
            window.location.assign(result.authorizationUrl);
        }
        catch (connectError) {
            setError(connectError.message ?? 'Could not start Google authorization.');
            setBusy(false);
        }
    };

    const chooseSpreadsheet = async spreadsheetId => {
        const spreadsheet = spreadsheets.find(item => item.id === spreadsheetId);
        setIntegration(current => ({
            ...current,
            spreadsheetId,
            spreadsheetTitle: spreadsheet?.name ?? '',
            sheetId: '',
            sheetTitle: '',
        }));
        setWorksheets([]);
        setError('');
        if (!spreadsheetId) return;
        setBusy(true);
        try {
            setWorksheets(await api.googleSheetsWorksheets(spreadsheetId));
        }
        catch (sheetError) {
            setError(sheetError.message ?? 'Could not load worksheets.');
        }
        finally {
            setBusy(false);
        }
    };

    const save = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const sheet = worksheets.find(item => String(item.id) === String(integration.sheetId));
            const result = await api.saveGoogleSheetsForm(form.id, {
                enabled,
                spreadsheetId: integration.spreadsheetId,
                sheetId: Number(integration.sheetId),
            });
            setIntegration(result);
            setEnabled(result.enabled);
            setNotice('Google Sheets settings saved.');
            await refreshDeliveries();
            if (sheet)
                setIntegration(current => ({ ...current, sheetTitle: sheet.title }));
        }
        catch (saveError) {
            setError(saveError.message ?? 'Could not save Google Sheets settings.');
        }
        finally {
            setBusy(false);
        }
    };

    const retry = async deliveryId => {
        setBusy(true);
        setError('');
        try {
            await api.retryGoogleSheetsDelivery(form.id, deliveryId);
            await refreshDeliveries();
            setNotice('Delivery queued for retry.');
        }
        catch (retryError) {
            setError(retryError.message ?? 'Could not retry this delivery.');
        }
        finally {
            setBusy(false);
        }
    };

    const disconnect = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await api.disconnectGoogleSheets();
            setConnection(current => current ? { ...current, connected: false, email: '' } : current);
            setIntegration(initialConfig);
            setEnabled(false);
            setWorksheets([]);
            setDeliveries([]);
            setNotice('Google account disconnected.');
        }
        catch (disconnectError) {
            setError(disconnectError.message ?? 'Could not disconnect Google account.');
        }
        finally {
            setBusy(false);
        }
    };

    const startConnect = connection?.connected ? null : (
      <Button onClick={connect} disabled={busy || !connection?.configured}>
        <ExternalLink size={15}/>Connect Google account
      </Button>
    );

    return <Dialog open title="Google Sheets integration" onClose={onClose} wide>
      <div className="space-y-5">
        <p>Automatically send each new form response to a worksheet. Form answers are matched to columns by question label; missing headers are added automatically.</p>
        {oauthStatus === 'connected' && <p role="status" className="text-emerald-700">{notice}</p>}
        {oauthStatus === 'error' && <p role="alert" className="text-red-600">{notice}</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
        {loading ? <div role="status" className="flex items-center gap-2 py-5"><Loader2 size={16} className="animate-spin"/>Loading integration…</div> : <>
          <section className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">Google account</p>
                {connection?.connected
                    ? <p className="mt-1 text-sm text-neutral-500">Connected as {connection.email}</p>
                    : <p className="mt-1 text-sm text-neutral-500">OAuth access tokens are stored encrypted on the server.</p>}
              </div>
              {connection?.connected
                  ? <div className="flex items-center gap-2">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Connected</span>
                      <Button variant="secondary" size="sm" disabled={busy} onClick={disconnect}>Disconnect</Button>
                    </div>
                  : startConnect}
            </div>
            {connection && !connection.configured && <div className="mt-3 space-y-1 text-xs text-amber-700">
              <p>Google OAuth is not configured on the backend yet. Add your Google OAuth client ID and secret to <code>backend/.env</code>, then restart the backend.</p>
              <p>In <a className="underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud Credentials</a>, add this authorized redirect URI: <code>http://localhost:4000/api/integrations/google-sheets/callback</code>.</p>
            </div>}
          </section>

          {connection?.connected && <section className="space-y-4 rounded-xl border border-line p-4">
            <div className="flex items-center justify-between gap-3">
              <div><p className="font-medium">Send responses to Sheets</p><p className="text-xs text-neutral-500">You can pause or resume syncing at any time.</p></div>
              <Toggle label="Enable Google Sheets sync" checked={enabled} onChange={setEnabled}/>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-neutral-600">Spreadsheet</span>
              <select aria-label="Spreadsheet" value={integration.spreadsheetId ?? ''} disabled={busy} onChange={event => void chooseSpreadsheet(event.target.value)} className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm">
                <option value="">Choose a spreadsheet</option>
                {spreadsheets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-neutral-600">Worksheet</span>
              <select aria-label="Worksheet" value={integration.sheetId ?? ''} disabled={busy || !worksheets.length} onChange={event => {
                  const sheet = worksheets.find(item => String(item.id) === event.target.value);
                  setIntegration(current => ({ ...current, sheetId: event.target.value, sheetTitle: sheet?.title ?? '' }));
              }} className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm">
                <option value="">Choose a worksheet</option>
                {worksheets.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={save} disabled={busy || !integration.spreadsheetId || integration.sheetId === ''}>
                {busy ? <Loader2 size={15} className="animate-spin"/> : <Table2 size={15}/>}Save integration
              </Button>
              {notice && oauthStatus !== 'connected' && <span role="status" className="text-sm text-emerald-700">{notice}</span>}
            </div>
          </section>}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div><h3 className="font-medium">Recent deliveries</h3><p className="text-xs text-neutral-500">Most recent 30 form submissions.</p></div>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => {
                  setBusy(true);
                  refreshDeliveries().catch(refreshError => setError(refreshError.message ?? 'Could not refresh delivery logs.')).finally(() => setBusy(false));
              }}><RefreshCw size={14}/>Refresh</Button>
            </div>
            {deliveries.length ? <div className="max-h-64 space-y-2 overflow-y-auto">
              {deliveries.map(delivery => <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><DeliveryStatus status={delivery.status}/><span className="text-xs text-neutral-500">{formatDate(delivery.submittedAt)}</span></div>
                  {delivery.status === 'failed' && <p className="mt-1 break-words text-xs text-red-700">{delivery.error}</p>}
                  {delivery.status !== 'success' && <p className="mt-1 text-xs text-neutral-500">Attempts: {delivery.attempts} · Last attempt: {formatDate(delivery.lastAttemptAt)}</p>}
                </div>
                {delivery.status === 'failed' && <Button variant="secondary" size="sm" disabled={busy || !enabled} onClick={() => void retry(delivery.id)}>Retry</Button>}
              </div>)}
            </div> : <p className="rounded-lg border border-dashed border-line p-5 text-center text-sm text-neutral-500">No response deliveries yet.</p>}
          </section>
        </>}
        <div className="flex justify-end border-t border-line pt-4"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </Dialog>;
}
