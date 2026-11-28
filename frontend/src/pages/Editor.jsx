import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { ArrowLeft, Undo2, Redo2, Eye, Check, Loader2 } from 'lucide-react';
import { useAppDispatch, useAppSelector, updateForm, setStatus } from '../store';
import { newField } from '../services/fieldTypes';
import { createLatestSaveQueue } from '../services/saveQueue';
import { validateFormContent } from '../services/validation';
import { normalizeFormSteps } from '../services/validation';
import { uid } from '../services/uid';
import { Button, Dialog, cn } from '../components/ui.jsx';
import { Library, Canvas, Properties } from './EditorPanels.jsx';
import WithForm from '../components/WithForm.jsx';
function reducer(h, a) {
    if (a.t === 'set')
        return { past: [...h.past.slice(-49), h.present], present: a.f, future: [] };
    if (a.t === 'undo')
        return h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h;
    return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
}
export default function Editor() {
    return <WithForm fullScreen>{form => <EditorInner key={form.id} initial={form}/>}</WithForm>;
}
function EditorInner({ initial }) {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const status = useAppSelector(s => s.forms.find(f => f.id === initial.id)?.status ?? 'draft');
    const user = useAppSelector(s => s.auth.user);
    const workspace = user?.workspaceName || (user?.name ? `${user.name.split(' ')[0]}'s workspace` : 'My workspace');
    const normalizedInitial = normalizeFormSteps(initial);
    const [h, hd] = useReducer(reducer, { past: [], present: normalizedInitial, future: [] });
    const form = h.present;
    const [selectedId, setSelectedId] = useState(null);
    const [panel, setPanel] = useState('canvas');
    const [confirm, setConfirm] = useState(false);
    const [saved, setSaved] = useState(true);
    const [activeStepId, setActiveStepId] = useState(normalizedInitial.steps[0]?.id ?? null);
    const lastSaved = useRef(normalizedInitial);
    const latestForm = useRef(normalizedInitial);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
    const [saveError, setSaveError] = useState(null);
    const [publishError, setPublishError] = useState(null);
    const saveQueue = useRef(null);
    if (!saveQueue.current) {
        saveQueue.current = createLatestSaveQueue(async f => {
            const invalid = validateFormContent(f);
            if (invalid) throw new Error(invalid);
            await dispatch(updateForm({ id: f.id, title: f.title, description: f.description, fields: f.fields, steps: f.steps, accent: f.accent })).unwrap();
            lastSaved.current = f;
        });
    }
    const queue = saveQueue.current;
    useLayoutEffect(() => {
        if (form !== latestForm.current) {
            latestForm.current = form;
            queue.setLatest(form);
        }
    }, [form, queue]);
    const flush = (snapshot = form) => {
        if (snapshot !== latestForm.current) {
            latestForm.current = snapshot;
            queue.setLatest(snapshot);
        }
        setSaved(false);
        return queue.flush().then(() => {
            if (queue.isSaved()) {
                setSaved(true);
                setSaveError(null);
            }
        }).catch(e => {
            setSaveError(e.message ?? 'Save failed');
            throw e;
        });
    };
    // Debounced autosave whenever the working copy changes.
    useEffect(() => {
        if (form === lastSaved.current)
            return;
        setSaved(false);
        const t = setTimeout(() => { void flush().catch(() => { }); }, 600);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form]);
    const edit = (fn) => hd({ t: 'set', f: fn(form) });
    const patchField = (fid, p) => edit(f => ({ ...f, fields: f.fields.map(x => (x.id === fid ? { ...x, ...p } : x)) }));
    const add = (type) => {
        const stepId = activeStepId ?? form.steps[0]?.id;
        const nf = { ...newField(type), stepId };
        edit(f => ({ ...f, fields: [...f.fields, nf] }));
        setSelectedId(nf.id);
    };
    const remove = (fid) => { edit(f => ({ ...f, fields: f.fields.filter(x => x.id !== fid) })); if (selectedId === fid)
        setSelectedId(null); };
    const duplicate = (fid) => edit(f => {
        const i = f.fields.findIndex(x => x.id === fid);
        const copy = { ...f.fields[i], id: uid(), label: `${f.fields[i].label} (copy)` };
        return { ...f, fields: [...f.fields.slice(0, i + 1), copy, ...f.fields.slice(i + 1)] };
    });
    const addStep = () => edit(f => {
        const id = uid();
        const nf = { ...newField('short_text', 'Untitled question', false), stepId: id };
        setActiveStepId(id);
        setSelectedId(nf.id);
        return {
            ...f,
            steps: [...f.steps, { id, title: `Step ${f.steps.length + 1}`, description: '', showIf: null }],
            fields: [...f.fields, nf],
        };
    });
    const updateStep = (stepId, patch) => edit(f => ({ ...f, steps: f.steps.map(step => step.id === stepId ? { ...step, ...patch } : step) }));
    const deleteStep = (stepId) => edit(f => {
        if (f.steps.length <= 1)
            return f;
        const index = f.steps.findIndex(step => step.id === stepId);
        const target = f.steps[index - 1]?.id ?? f.steps[index + 1]?.id;
        const remaining = f.steps.filter(step => step.id !== stepId);
        const fields = f.fields.map(field => field.stepId === stepId ? { ...field, stepId: target } : field);
        setActiveStepId(target);
        setSelectedId(null);
        return { ...f, steps: remaining, fields };
    });
    const duplicateStep = (stepId) => edit(f => {
        const index = f.steps.findIndex(step => step.id === stepId);
        const copyId = uid();
        const copyStep = { ...f.steps[index], id: copyId, title: `${f.steps[index].title} (copy)` };
        const copiedFields = f.fields.filter(field => field.stepId === stepId).map(field => ({
            ...field,
            id: uid(),
            label: `${field.label} (copy)`,
            stepId: copyId,
        }));
        setActiveStepId(copyId);
        return {
            ...f,
            steps: [...f.steps.slice(0, index + 1), copyStep, ...f.steps.slice(index + 1)],
            fields: [...f.fields, ...copiedFields],
        };
    });
    const reorderStep = (stepId, direction) => edit(f => {
        const index = f.steps.findIndex(step => step.id === stepId);
        const next = index + direction;
        if (next < 0 || next >= f.steps.length)
            return f;
        return { ...f, steps: arrayMove(f.steps, index, next) };
    });
    const onDragEnd = ({ active, over }) => {
        if (!over || active.id === over.id)
            return;
        edit(f => {
            const stepId = f.fields.find(x => x.id === active.id)?.stepId;
            if (!stepId)
                return f;
            const stepFields = f.fields.filter(x => x.stepId === stepId);
            const reordered = arrayMove(stepFields, stepFields.findIndex(x => x.id === active.id), stepFields.findIndex(x => x.id === over.id));
            if (reordered.length === 0)
                return f;
            let index = 0;
            return { ...f, fields: f.fields.map(field => field.stepId === stepId ? reordered[index++] : field) };
        });
    };
    const publish = async () => {
        setPublishError(null);
        try {
            await flush(form);
            await dispatch(setStatus({ id: form.id, status: 'published' })).unwrap();
            navigate(`/app/forms/${form.id}/share`);
        }
        catch (e) {
            setPublishError(e.message ?? 'Could not publish');
        }
    };
    const navigateAfterSave = async (path) => {
        try {
            await flush(form);
            navigate(path);
        } catch (error) {
            setSaveError(error.message ?? 'Save failed');
        }
    };
    const preview = () => navigateAfterSave(`/app/forms/${form.id}/preview`);
    const selected = form.fields.find(f => f.id === selectedId);
    const iconBtn = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100 disabled:opacity-40';
    return (<div className="flex h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-30 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line bg-white px-3 py-2 sm:h-14 sm:flex-nowrap sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button type="button" aria-label="Back to forms dashboard" title="Back to forms dashboard" onClick={() => void navigateAfterSave('/app')} className={iconBtn}><ArrowLeft size={17}/></button>
          <span className="hidden max-w-36 truncate text-sm text-neutral-500 md:block">{workspace}</span>
          <span aria-hidden="true" className="hidden text-neutral-300 md:block">/</span>
          <input aria-label="Form title" value={form.title} onChange={event => edit(current => ({ ...current, title: event.target.value }))} className="w-24 min-w-0 rounded-md bg-transparent px-1 py-1 text-sm font-medium text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent-500 sm:w-40 md:w-56"/>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <span className="mr-1 flex items-center gap-1 text-xs text-neutral-500" aria-live="polite">
            {saveError ? <button type="button" aria-label="Save failed, retry" onClick={() => void flush().catch(() => { })} title={saveError} className="text-red-600"><span className="hidden sm:inline">Save failed</span><span className="sm:hidden">!</span></button>
                : saved ? <span role="status" aria-label="All changes saved" title="All changes saved" className="flex items-center gap-1"><Check size={14}/><span className="hidden md:inline">All changes saved</span></span>
                    : <span role="status" aria-label="Saving" title="Saving..." className="flex items-center gap-1"><Loader2 size={14} className="animate-spin"/><span className="hidden md:inline">Saving...</span></span>}
          </span>
          <button aria-label="Undo" title="Undo" disabled={!h.past.length} onClick={() => hd({ t: 'undo' })} className={iconBtn}><Undo2 size={16}/></button>
          <button aria-label="Redo" title="Redo" disabled={!h.future.length} onClick={() => hd({ t: 'redo' })} className={iconBtn}><Redo2 size={16}/></button>
          <Button variant="secondary" size="sm" onClick={preview}><Eye size={14}/>Preview</Button>
          {status === 'published' ? <Button size="sm" onClick={() => void navigateAfterSave(`/app/forms/${form.id}/share`)}>Share</Button> : <Button size="sm" onClick={() => setConfirm(true)}>Publish</Button>}
        </div>
      </header>

      <div className="flex shrink-0 border-b border-line bg-white p-1 lg:hidden" role="tablist">
        {[['library', 'Add'], ['canvas', 'Form'], ['props', 'Properties']].map(([k, l]) => (<button key={k} role="tab" aria-selected={panel === k} onClick={() => setPanel(k)} className={cn('flex-1 rounded-md py-2 text-sm font-medium', panel === k ? 'bg-neutral-100' : 'text-neutral-500')}>{l}</button>))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_1fr_300px]">
        <aside className={cn('overflow-y-auto border-r border-line bg-white p-4 lg:block', panel !== 'library' && 'hidden')}><Library onAdd={t => { add(t); setPanel('canvas'); }}/></aside>
        <main className={cn('min-w-0 overflow-y-auto p-3 sm:p-5 lg:block', panel !== 'canvas' && 'hidden')}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <Canvas form={form} activeStepId={activeStepId} onActiveStep={setActiveStepId} selectedId={selectedId} onSelect={id => { setSelectedId(id); if (id)
        setPanel('props'); }} onMeta={p => edit(f => ({ ...f, ...p }))} onDuplicate={duplicate} onDelete={remove} onAddClick={() => setPanel('library')} onAddStep={addStep} onUpdateStep={updateStep} onDeleteStep={deleteStep} onDuplicateStep={duplicateStep} onReorderStep={reorderStep}/>
          </DndContext>
        </main>
        <aside className={cn('overflow-y-auto border-l border-line bg-white p-4 lg:block', panel !== 'props' && 'hidden')}>
          <Properties form={form} field={selected} onUpdate={p => selected && patchField(selected.id, p)} onMeta={p => edit(f => ({ ...f, ...p }))}/>
        </aside>
      </div>

      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Publish form?">
        <p>"{form.title || 'Untitled form'}" will get a public link and start accepting responses. You can unpublish at any time.</p>
        {publishError && <p role="alert" className="mt-3 text-red-600">{publishError}</p>}<div className="mt-6 flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={publish}>Publish</Button></div>
      </Dialog>
    </div>);
}
