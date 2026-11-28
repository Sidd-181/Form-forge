import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download, Eye, Search, Trash2 } from 'lucide-react';
import WithForm from '../components/WithForm.jsx';
import FormTabs from '../components/FormTabs.jsx';
import { Button, Dialog, Input } from '../components/ui.jsx';
import { answerForResponseField, fieldsForResponse, fmtAnswer, responseFieldKey, useResponses } from '../services/responses';
import { api } from '../services/api.js';
const PAGE_SIZES = [10, 25, 50, 100];
const when = iso => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function SkeletonRows() {
    return <div aria-label="Loading responses" className="space-y-3 rounded-xl border border-line bg-white p-4">
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }, (_, cell) => <div key={cell} className="h-8 animate-pulse rounded bg-neutral-100"/> )}
      </div>)}
    </div>;
}

function FileDownload({ formId, file }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const download = async () => {
        setLoading(true);
        setError(null);
        try {
            const blob = await api.downloadFile(formId, file.fileId);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = file.name;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        catch (e) {
            setError(e.message || 'Could not download file.');
        }
        finally {
            setLoading(false);
        }
    };
    return <span className="inline-flex flex-col items-start gap-1">
      <Button size="sm" variant="secondary" onClick={download} disabled={loading}>{loading ? 'Downloading…' : `Download ${file.name}`}</Button>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </span>;
}

function ResponsesView({ form }) {
    const [searchText, setSearchText] = useState('');
    const [search, setSearch] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [questionId, setQuestionId] = useState('');
    const [answer, setAnswer] = useState('');
    const [status, setStatus] = useState('all');
    const [sortBy, setSortBy] = useState('submittedAt');
    const [sortOrder, setSortOrder] = useState('desc');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [selected, setSelected] = useState([]);
    const [open, setOpen] = useState(null);
    const [del, setDel] = useState(null);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState(null);
    const [exporting, setExporting] = useState('');

    useEffect(() => {
        const timer = window.setTimeout(() => setSearch(searchText.trim()), 250);
        return () => window.clearTimeout(timer);
    }, [searchText]);

    const query = useMemo(() => ({
        page,
        pageSize,
        q: search || undefined,
        from: from || undefined,
        fromOffsetMinutes: from ? new Date(`${from}T00:00:00`).getTimezoneOffset() : undefined,
        to: to || undefined,
        toOffsetMinutes: to ? new Date(`${to}T00:00:00`).getTimezoneOffset() : undefined,
        questionId: questionId || undefined,
        answer: answer.trim() || undefined,
        status,
        sortBy,
        sortOrder,
    }), [page, pageSize, search, from, to, questionId, answer, status, sortBy, sortOrder]);
    const { data, error, loading, reload, removeMany, updateStatus } = useResponses(form.id, query);
    const rows = data?.items ?? [];
    const total = data?.total ?? 0;
    const filteredTotal = data?.filteredTotal ?? 0;
    const pageCount = Math.max(1, Math.ceil(filteredTotal / pageSize));
    const columns = form.fields.slice(0, 4);
    const selectedOnPage = rows.filter(row => selected.includes(row.id)).length;
    const allOnPageSelected = rows.length > 0 && selectedOnPage === rows.length;

    useEffect(() => {
        setSelected([]);
    }, [page, pageSize, search, from, to, questionId, answer, status]);
    useEffect(() => {
        if (page > pageCount)
            setPage(pageCount);
    }, [page, pageCount]);

    const resetPage = () => setPage(1);
    const clearFilters = () => {
        setSearchText('');
        setSearch('');
        setFrom('');
        setTo('');
        setQuestionId('');
        setAnswer('');
        setStatus('all');
        resetPage();
    };

    const exportResponses = async format => {
        setExporting(format);
        setActionError(null);
        try {
            const blob = await api.exportResponses(form.id, { ...query, page: 1, format });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${(form.title || 'form').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-responses.${format === 'excel' ? 'xls' : 'csv'}`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        catch (e) {
            setActionError(e.message || 'Could not export responses.');
        }
        finally {
            setExporting('');
        }
    };

    const setResponseStatus = async (response, nextStatus) => {
        setBusy(true);
        setActionError(null);
        try {
            const updated = await updateStatus(response.id, nextStatus);
            if (open?.id === response.id)
                setOpen(updated);
            if (status !== 'all')
                reload();
        }
        catch (e) {
            setActionError(e.message || 'Could not update response status.');
        }
        finally {
            setBusy(false);
        }
    };

    const confirmDelete = async () => {
        if (!del)
            return;
        setBusy(true);
        setActionError(null);
        try {
            await removeMany(del.ids);
            if (open && del.ids.includes(open.id))
                setOpen(null);
            setSelected([]);
            setDel(null);
            if (rows.length === del.ids.length && page > 1)
                setPage(current => current - 1);
        }
        catch (e) {
            setDel(current => ({ ...current, error: e.message || 'Could not delete responses.' }));
        }
        finally {
            setBusy(false);
        }
    };

    const toggleSelectPage = checked => {
        setSelected(current => {
            const currentPageIds = new Set(rows.map(row => row.id));
            const remaining = current.filter(id => !currentPageIds.has(id));
            return checked ? [...remaining, ...currentPageIds] : remaining;
        });
    };

    return (<div className="space-y-6">
      <FormTabs id={form.id} title={form.title}/>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold tracking-tight">Responses</h1><p className="text-sm text-neutral-500">Review and manage form submissions.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => exportResponses('csv')} disabled={loading || filteredTotal === 0 || !!exporting}><Download size={15}/>{exporting === 'csv' ? 'Preparing CSV…' : 'Export CSV'}</Button>
          <Button variant="secondary" onClick={() => exportResponses('excel')} disabled={loading || filteredTotal === 0 || !!exporting}><Download size={15}/>{exporting === 'excel' ? 'Preparing Excel…' : 'Export Excel'}</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-white px-4 py-3"><p className="text-xs text-neutral-500">Total responses</p><p className="mt-1 text-2xl font-semibold">{loading && !data ? '—' : total}</p></div>
        <div className="rounded-xl border border-line bg-white px-4 py-3"><p className="text-xs text-neutral-500">Filtered results</p><p className="mt-1 text-2xl font-semibold">{loading && !data ? '—' : filteredTotal}</p></div>
      </div>

      {actionError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
      {error ? (<div role="alert" className="rounded-xl border border-line bg-white p-10 text-center"><p className="font-medium">Couldn't load responses</p><p className="mt-1 text-sm text-neutral-500">{error}</p><Button className="mt-4" onClick={reload}>Try again</Button></div>) : loading ? <SkeletonRows/> : (<>
        <section aria-label="Response filters" className="space-y-3 rounded-xl border border-line bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[220px] flex-1 text-xs font-medium text-neutral-600">Search answers
              <span className="relative mt-1 block"><Search size={16} className="absolute left-3 top-3 text-neutral-400"/><Input aria-label="Search answers" placeholder="Search all answers" className="pl-9" value={searchText} onChange={event => { setSearchText(event.target.value); resetPage(); }}/></span>
            </label>
            <label className="text-xs font-medium text-neutral-600">From<Input type="date" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value); resetPage(); }} className="mt-1 w-full sm:w-40"/></label>
            <label className="text-xs font-medium text-neutral-600">To<Input type="date" value={to} min={from || undefined} onChange={event => { setTo(event.target.value); resetPage(); }} className="mt-1 w-full sm:w-40"/></label>
            <label className="text-xs font-medium text-neutral-600">Status<select value={status} onChange={event => { setStatus(event.target.value); resetPage(); }} className="mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm sm:w-36"><option value="all">All statuses</option><option value="unread">Unread</option><option value="read">Read</option></select></label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-neutral-600">Question<select aria-label="Filter by question" value={questionId} onChange={event => { setQuestionId(event.target.value); setAnswer(''); resetPage(); }} className="mt-1 h-10 w-full min-w-48 rounded-lg border border-line bg-white px-3 text-sm sm:w-auto"><option value="">All questions</option>{form.fields.map(field => <option key={field.id} value={field.id}>{field.label || 'Untitled question'}</option>)}</select></label>
            <label className="min-w-48 flex-1 text-xs font-medium text-neutral-600">Answer contains<Input aria-label="Filter answer" placeholder={questionId ? 'Enter an answer' : 'Select a question first'} value={answer} disabled={!questionId} onChange={event => { setAnswer(event.target.value); resetPage(); }} className="mt-1"/></label>
            <label className="text-xs font-medium text-neutral-600">Sort by<select value={sortBy} onChange={event => { setSortBy(event.target.value); resetPage(); }} className="mt-1 h-10 w-full min-w-44 rounded-lg border border-line bg-white px-3 text-sm sm:w-auto"><option value="submittedAt">Submission date</option>{form.fields.map(field => <option key={field.id} value={field.id}>{field.label || 'Untitled question'}</option>)}</select></label>
            <Button variant="secondary" aria-label={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`} onClick={() => { setSortOrder(value => value === 'asc' ? 'desc' : 'asc'); resetPage(); }}><span>{sortOrder === 'asc' ? <ArrowUp size={15}/> : <ArrowDown size={15}/>}</span>{sortOrder === 'asc' ? 'Ascending' : 'Descending'}</Button>
            {(searchText || from || to || questionId || answer || status !== 'all') && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
          </div>
        </section>

        {total === 0 ? (<div className="rounded-xl border border-dashed border-line bg-white p-10 text-center">
          <p className="font-medium">No responses yet</p>
          <p className="mt-1 text-sm text-neutral-500">{form.status === 'published' ? 'Share your link to start collecting responses.' : 'Publish this form to start collecting responses.'}</p>
          <Link to={`/app/forms/${form.id}/share`}><Button className="mt-4">{form.status === 'published' ? 'Get the link' : 'Publish & share'}</Button></Link>
        </div>) : filteredTotal === 0 ? (<div className="rounded-xl border border-dashed border-line bg-white p-10 text-center"><p className="font-medium">No responses match these filters</p><p className="mt-1 text-sm text-neutral-500">Try changing or clearing the filters.</p></div>) : (<>
          {selected.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-neutral-100 px-4 py-2 text-sm">
            <span>{selected.length} selected</span><Button variant="danger" size="sm" onClick={() => setDel({ ids: selected })}><Trash2 size={14}/>Delete selected</Button>
          </div>}
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="border-b border-line bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select this page" checked={allOnPageSelected} onChange={event => toggleSelectPage(event.target.checked)}/></th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">Submitted</th>
                  {columns.map(field => <th key={responseFieldKey(field)} className="px-4 py-3 font-medium">{field.label || 'Untitled question'}</th>)}
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(response => (<tr key={response.id} className={response.status === 'unread' ? 'bg-accent-50/30' : ''}>
                  <td className="px-4 py-3"><input type="checkbox" aria-label={`Select response submitted ${when(response.submittedAt)}`} checked={selected.includes(response.id)} onChange={event => setSelected(current => event.target.checked ? [...current, response.id] : current.filter(id => id !== response.id))}/></td>
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-600">{when(response.submittedAt)}</td>
                  {columns.map(field => <td key={responseFieldKey(field)} className="max-w-[220px] truncate px-4 py-3">{answerForResponseField(response, field, form.fields) || <span className="text-neutral-400">—</span>}</td>)}
                  <td className="px-4 py-3"><button type="button" disabled={busy} onClick={() => setResponseStatus(response, response.status === 'read' ? 'unread' : 'read')} className={`rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${response.status === 'read' ? 'bg-neutral-100 text-neutral-600' : 'bg-blue-50 text-blue-700'}`}>{response.status === 'read' ? 'Read' : 'Unread'}</button></td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button aria-label="View response" title="View response" onClick={() => setOpen(response)} className="mr-1 inline-grid h-8 w-8 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100"><Eye size={16}/></button>
                    <button aria-label="Delete response" title="Delete response" onClick={() => setDel({ ids: [response.id] })} className="inline-grid h-8 w-8 place-items-center rounded-md text-red-500 hover:bg-red-50"><Trash2 size={16}/></button>
                  </td>
                </tr>))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-neutral-500">
              <span>Showing {filteredTotal === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredTotal)} of {filteredTotal} filtered ({total} total)</span>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">Rows<select aria-label="Rows per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); resetPage(); }} className="h-8 rounded border border-line bg-white px-2">{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
                <span>Page {page} of {pageCount}</span>
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => setPage(current => current + 1)}>Next</Button>
              </div>
            </div>
          </div>
        </>)}
      </>)}

      <Dialog open={!!open} onClose={() => setOpen(null)} title="Response details" wide>
        {open && (<>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
            <p>Submitted {when(open.submittedAt)}{open.completionSeconds != null && ` · completed in ${open.completionSeconds}s`}</p>
            <button type="button" disabled={busy} onClick={() => setResponseStatus(open, open.status === 'read' ? 'unread' : 'read')} className="rounded-full bg-neutral-100 px-2.5 py-1 font-medium text-neutral-700 disabled:opacity-50">Mark as {open.status === 'read' ? 'unread' : 'read'}</button>
          </div>
          <dl className="mt-4 space-y-4">
            {fieldsForResponse(open, form.fields).map(field => (<div key={responseFieldKey(field)}><dt className="text-xs font-medium text-neutral-500">{field.label || 'Untitled question'}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">
              {open.answers[field.id] && typeof open.answers[field.id] === 'object' && 'fileId' in open.answers[field.id]
                  ? <FileDownload formId={form.id} file={open.answers[field.id]}/>
                  : fmtAnswer(open.answers[field.id]) || <span className="text-neutral-400">No answer</span>}
            </dd></div>))}
          </dl>
          <div className="mt-6 flex justify-between">
            <Button variant="danger" size="sm" onClick={() => setDel({ ids: [open.id] })}><Trash2 size={14}/>Delete</Button>
            <Button variant="secondary" onClick={() => setOpen(null)}>Close</Button>
          </div>
        </>)}
      </Dialog>
      <Dialog open={!!del} onClose={() => !busy && setDel(null)} title={del?.ids.length > 1 ? `Delete ${del.ids.length} responses?` : 'Delete response?'}>
        <p>{del?.ids.length > 1 ? `${del.ids.length} selected responses` : 'This response'} will be permanently deleted. This can't be undone.</p>
        {del?.error && <p role="alert" className="mt-3 text-red-600">{del.error}</p>}
        <div className="mt-6 flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={confirmDelete}>{busy ? 'Deleting…' : 'Delete'}</Button></div>
      </Dialog>
    </div>);
}

export default function Responses() { return <WithForm>{form => <ResponsesView key={form.id} form={form}/>}</WithForm>; }
