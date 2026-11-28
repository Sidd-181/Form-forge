import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Monitor, Smartphone, Pencil } from 'lucide-react';
import WithForm from '../components/WithForm.jsx';
import FormRenderer from '../components/FormRenderer.jsx';
import { Badge, Button, cn } from '../components/ui.jsx';
import FormTabs from '../components/FormTabs.jsx';
function PreviewView({ form }) {
    const [device, setDevice] = useState('desktop');
    return (<div className="space-y-6">
      <FormTabs id={form.id} title={form.title}/>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <Badge tone={form.status === 'published' ? 'green' : 'neutral'}>{form.status === 'published' ? 'Published' : 'Draft'}</Badge>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label="Device">
              {[['desktop', Monitor], ['mobile', Smartphone]].map(([d, Icon]) => (<button key={d} aria-pressed={device === d} onClick={() => setDevice(d)} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm capitalize', device === d ? 'bg-ink text-white' : 'text-neutral-600')}><Icon size={14}/>{d}</button>))}
            </div>
            <Link to={`/app/forms/${form.id}/edit`}><Button variant="secondary" size="sm"><Pencil size={14}/>Edit</Button></Link>
            <Link to={`/app/forms/${form.id}/share`}><Button size="sm">Publish & share</Button></Link>
          </div>
        </div>
      </div>
      <div className="dot-grid rounded-xl border border-line p-4 sm:p-8">
        <div className={cn('mx-auto transition-all', device === 'mobile' ? 'max-w-[390px] rounded-[2rem] border-[10px] border-ink bg-canvas p-3' : 'max-w-2xl')}>
          <FormRenderer form={form} preview onSubmit={async () => { }}/>
        </div>
      </div>
    </div>);
}
export default function Preview() { return <WithForm>{f => <PreviewView key={f.id} form={f}/>}</WithForm>; }
