import { useState } from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Copy, Trash2, Plus, X, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { FIELD_TYPES, hasOptions, hasPlaceholder } from '../services/fieldTypes';
import FieldInput from '../components/FieldInput.jsx';
import { Button, Input, Toggle, cn } from '../components/ui.jsx';
import { validateFieldDefinition } from '../services/validation';
export function Library({ onAdd }) {
    const [q, setQ] = useState('');
    const items = FIELD_TYPES.filter(f => f.label.toLowerCase().includes(q.toLowerCase()));
    return (<div className="space-y-5">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-3 text-neutral-400"/>
        <Input aria-label="Search fields" placeholder="Search element" className="pl-9" value={q} onChange={e => setQ(e.target.value)}/>
      </div>
      {['Text', 'Choice', 'Other'].map(g => {
            const group = items.filter(i => i.group === g);
            return group.length === 0 ? null : (<div key={g}>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">{g}</p>
            <div className="grid grid-cols-2 gap-2">
              {group.map(f => (<button key={f.type} onClick={() => onAdd(f.type)} className="flex flex-col items-center gap-2 rounded-lg border border-line bg-white px-2 py-4 text-xs font-medium hover:border-accent-500 hover:bg-accent-50">
                  <f.icon size={18}/>{f.label}
                </button>))}
            </div>
          </div>);
        })}
      {items.length === 0 && <p className="text-sm text-neutral-500">No matching elements.</p>}
    </div>);
}
function SortableField({ field, selected, onSelect, onDuplicate, onDelete }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
    return (<div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} onClick={onSelect} className={cn('group flex cursor-pointer gap-2 rounded-xl border bg-white p-4', selected ? 'border-accent-500 ring-2 ring-accent-100' : 'border-line', isDragging && 'z-10 opacity-70')}>
      <button aria-label="Drag to reorder" {...attributes} {...listeners} className="mt-1 h-6 cursor-grab text-neutral-400 hover:text-ink"><GripVertical size={16}/></button>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{field.label || 'Untitled question'}{field.required && <span className="ml-0.5 text-red-500">*</span>}</p>
            {field.description && <p className="text-xs text-neutral-500">{field.description}</p>}
          </div>
          <div className={cn('flex gap-1', !selected && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
            <button aria-label="Duplicate field" title="Duplicate" onClick={e => { e.stopPropagation(); onDuplicate(); }} className="grid h-7 w-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100"><Copy size={14}/></button>
            <button aria-label="Delete field" title="Delete" onClick={e => { e.stopPropagation(); onDelete(); }} className="grid h-7 w-7 place-items-center rounded-md text-red-500 hover:bg-red-50"><Trash2 size={14}/></button>
          </div>
        </div>
        <div className="pointer-events-none"><FieldInput field={field} disabled/></div>
      </div>
    </div>);
}
export function Canvas({ form, activeStepId, onActiveStep, selectedId, onSelect, onMeta, onDuplicate, onDelete, onAddClick, onAddStep, onUpdateStep, onDeleteStep, onDuplicateStep, onReorderStep }) {
    const activeStep = form.steps.find(step => step.id === activeStepId) ?? form.steps[0];
    const stepFields = form.fields.filter(field => field.stepId === activeStep?.id);
    return (<div className="dot-grid min-h-full rounded-xl border border-line p-4 sm:p-8" onClick={() => onSelect(null)}>
      <div className="mx-auto max-w-xl space-y-3" onClick={e => e.stopPropagation()}>
        <div className="rounded-xl border border-line bg-white p-5" style={{ borderTop: `4px solid ${form.accent}` }}>
          <input aria-label="Form title" value={form.title} onChange={e => onMeta({ title: e.target.value })} placeholder="Form title" className="w-full text-xl font-semibold outline-none"/>
          <textarea aria-label="Form description" value={form.description} onChange={e => onMeta({ description: e.target.value })} placeholder="Add a description" rows={2} className="mt-1 w-full resize-none text-sm text-neutral-600 outline-none"/>
        </div>
        <div className="flex gap-2 overflow-x-auto rounded-lg border border-line bg-white p-2">
          {form.steps.map((step, index) => (
            <button key={step.id} onClick={() => onActiveStep(step.id)} className={cn('shrink-0 rounded-md px-3 py-2 text-xs font-medium', activeStep?.id === step.id ? 'bg-ink text-white' : 'bg-neutral-100 text-neutral-600')}>
              {index + 1}. {step.title || 'Untitled step'}
            </button>
          ))}
          <button aria-label="Add step" onClick={onAddStep} className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-dashed border-neutral-300 text-neutral-500"><Plus size={14}/></button>
        </div>
        {activeStep && <div className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-2">
              <Input aria-label="Step title" value={activeStep.title} onChange={e => onUpdateStep(activeStep.id, { title: e.target.value })}/>
              <Input aria-label="Step description" value={activeStep.description ?? ''} onChange={e => onUpdateStep(activeStep.id, { description: e.target.value })} placeholder="Step description"/>
              <div className="grid gap-2 sm:grid-cols-3">
                <select aria-label="Step condition question" className="h-10 rounded-lg border border-line bg-white px-2 text-sm" value={activeStep.showIf?.fieldId ?? ''} onChange={e => onUpdateStep(activeStep.id, { showIf: e.target.value ? { fieldId: e.target.value, operator: 'equals', value: '' } : null })}>
                  <option value="">Always show step</option>
                  {form.fields.filter(field => field.stepId !== activeStep.id).map(field => <option key={field.id} value={field.id}>{field.label || 'Untitled question'}</option>)}
                </select>
                {activeStep.showIf && <>
                  <select aria-label="Step condition operator" className="h-10 rounded-lg border border-line bg-white px-2 text-sm" value={activeStep.showIf.operator} onChange={e => onUpdateStep(activeStep.id, { showIf: { ...activeStep.showIf, operator: e.target.value } })}>
                    <option value="equals">Equals</option>
                    <option value="not_equals">Does not equal</option>
                  </select>
                  <Input aria-label="Step condition value" value={activeStep.showIf.value ?? ''} onChange={e => onUpdateStep(activeStep.id, { showIf: { ...activeStep.showIf, value: e.target.value } })} placeholder="Answer value"/>
                </>}
              </div>
            </div>
            <div className="flex gap-1">
              <button aria-label="Move step up" title="Move step up" onClick={() => onReorderStep(activeStep.id, -1)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-neutral-100"><ChevronUp size={15}/></button>
              <button aria-label="Move step down" title="Move step down" onClick={() => onReorderStep(activeStep.id, 1)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-neutral-100"><ChevronDown size={15}/></button>
              <button aria-label="Duplicate step" title="Duplicate step" onClick={() => onDuplicateStep(activeStep.id)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-neutral-100"><Copy size={14}/></button>
              <button aria-label="Delete step" title="Delete step" disabled={form.steps.length <= 1} onClick={() => onDeleteStep(activeStep.id)} className="grid h-8 w-8 place-items-center rounded-md text-red-500 hover:bg-red-50 disabled:opacity-40"><Trash2 size={14}/></button>
            </div>
          </div>
        </div>}
        <SortableContext items={stepFields.map(f => f.id)} strategy={verticalListSortingStrategy}>
          {stepFields.map(f => (<SortableField key={f.id} field={f} selected={f.id === selectedId} onSelect={() => onSelect(f.id)} onDuplicate={() => onDuplicate(f.id)} onDelete={() => onDelete(f.id)}/>))}
        </SortableContext>
        <button onClick={onAddClick} className="flex h-16 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-white/70 text-sm text-neutral-600 hover:border-accent-500 lg:pointer-events-none lg:opacity-60">
          <Plus size={16}/>{form.fields.length === 0 ? 'Add your first field from the library' : 'Add field from the library'}
        </button>
      </div>
    </div>);
}
export const SWATCHES = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#e11d48', '#0a0a0a'];
const Row = ({ label, children }) => <label className="block space-y-1.5"><span className="text-xs font-medium text-neutral-600">{label}</span>{children}</label>;
const num = (v) => (v === '' ? undefined : Number(v));
export function Properties({ form, field, onUpdate, onMeta }) {
    const [tab, setTab] = useState('field');
    const opts = field?.options ?? [];
    const fieldValidationError = field ? validateFieldDefinition(field) : null;
    const addOption = () => {
        let number = opts.length + 1;
        while (opts.some(option => option.trim().toLocaleLowerCase() === `option ${number}`.toLocaleLowerCase())) number += 1;
        onUpdate({ options: [...opts, `Option ${number}`] });
    };
    const setBound = (bound, raw) => {
        const value = num(raw);
        if (value == null) {
            onUpdate({ [bound]: undefined });
        } else if (bound === 'min' && field.max != null && value > field.max) {
            onUpdate({ min: value, max: value });
        } else if (bound === 'max' && field.min != null && value < field.min) {
            onUpdate({ min: value, max: value });
        } else {
            onUpdate({ [bound]: value });
        }
    };
    return (<div>
      <div className="mb-4 flex rounded-lg bg-neutral-100 p-0.5 text-sm" role="tablist">
        {['field', 'theme'].map(t => (<button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('flex-1 rounded-md py-1.5 font-medium capitalize', tab === t ? 'bg-white shadow-sm' : 'text-neutral-500')}>{t === 'field' ? 'Field' : 'Theme'}</button>))}
      </div>
      {tab === 'theme' ? (<div className="space-y-3">
          <p className="text-xs font-medium text-neutral-600">Accent colour</p>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map(c => <button key={c} aria-label={`Accent ${c}`} aria-pressed={form.accent === c} onClick={() => onMeta({ accent: c })} style={{ background: c }} className={cn('h-8 w-8 rounded-full border-2', form.accent === c ? 'border-ink' : 'border-white ring-1 ring-line')}/>)}
          </div>
          <p className="text-xs text-neutral-500">Used for the header bar, buttons and ratings on the published form.</p>
        </div>) : !field ? (<p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-neutral-500">Select a field on the canvas to edit its properties.</p>) : (<div className="space-y-4">
          <Row label="Question label"><Input value={field.label} onChange={e => onUpdate({ label: e.target.value })}/></Row>
          <Row label="Description"><Input value={field.description ?? ''} onChange={e => onUpdate({ description: e.target.value })} placeholder="Help text"/></Row>
          {hasPlaceholder(field.type) && <Row label={field.type === 'checkbox' ? 'Checkbox text' : 'Placeholder'}><Input value={field.placeholder ?? ''} onChange={e => onUpdate({ placeholder: e.target.value })}/></Row>}
          <div className="flex items-center justify-between"><span className="text-sm font-medium">Required</span><Toggle label="Required" checked={field.required} onChange={v => onUpdate({ required: v })}/></div>
          <Row label="Step">
            <select className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm" value={field.stepId ?? form.steps[0]?.id} onChange={e => onUpdate({ stepId: e.target.value })}>
              {form.steps.map(step => <option key={step.id} value={step.id}>{step.title || 'Untitled step'}</option>)}
            </select>
          </Row>
          <div className="space-y-2 border-t border-line pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Conditional display</p>
            <Row label="Show this question only when">
              <select className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm" value={field.showIf?.fieldId ?? ''} onChange={e => onUpdate({ showIf: e.target.value ? { fieldId: e.target.value, operator: 'equals', value: '' } : null })}>
                <option value="">Always show</option>
                {form.fields.filter(source => source.id !== field.id).map(source => <option key={source.id} value={source.id}>{source.label || 'Untitled question'}</option>)}
              </select>
            </Row>
            {field.showIf && <div className="grid grid-cols-2 gap-2">
              <select aria-label="Condition operator" className="h-10 rounded-lg border border-line bg-white px-2 text-sm" value={field.showIf.operator} onChange={e => onUpdate({ showIf: { ...field.showIf, operator: e.target.value } })}>
                <option value="equals">Equals</option>
                <option value="not_equals">Does not equal</option>
              </select>
              <Input aria-label="Condition value" value={field.showIf.value ?? ''} onChange={e => onUpdate({ showIf: { ...field.showIf, value: e.target.value } })} placeholder="Answer value"/>
            </div>}
          </div>
          {hasOptions(field.type) && (<div className="space-y-2">
              <p className="text-xs font-medium text-neutral-600">Options</p>
              {opts.map((o, i) => (<div key={i} className="flex gap-2">
                  <Input aria-label={`Option ${i + 1}`} value={o} onChange={e => onUpdate({ options: opts.map((x, j) => (j === i ? e.target.value : x)) })}/>
                  <button aria-label={`Remove option ${i + 1}`} disabled={opts.length <= 1} onClick={() => onUpdate({ options: opts.filter((_, j) => j !== i) })} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"><X size={16}/></button>
                </div>))}
              <Button size="sm" variant="secondary" onClick={addOption} disabled={opts.length >= 100}><Plus size={14}/>Add option</Button>
            </div>)}
          {['short_text', 'long_text', 'number', 'rating', 'file'].includes(field.type) && (<div className="space-y-3 border-t border-line pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Validation</p>
              {field.type === 'rating' ? (<Row label="Number of stars (3–10)"><Input type="number" min={3} max={10} value={field.max ?? 5} onChange={e => onUpdate({ max: Math.min(10, Math.max(3, Number(e.target.value) || 5)) })}/></Row>) : field.type === 'file' ? (<Row label="Max file size (MB)"><Input type="number" min={1} value={field.max ?? ''} onChange={e => onUpdate({ max: num(e.target.value) })} placeholder="No limit"/></Row>) : (<div className="grid grid-cols-2 gap-3">
                  <Row label={field.type === 'number' ? 'Min value' : 'Min length'}><Input type="number" value={field.min ?? ''} onChange={e => setBound('min', e.target.value)}/></Row>
                  <Row label={field.type === 'number' ? 'Max value' : 'Max length'}><Input type="number" value={field.max ?? ''} onChange={e => setBound('max', e.target.value)}/></Row>
                </div>)}
            </div>)}
          {fieldValidationError && <p role="alert" className="text-xs text-red-600">{fieldValidationError}</p>}
        </div>)}
    </div>);
}
