import { NavLink, useLocation } from 'react-router-dom';
import { cn } from './ui.jsx';
export default function FormTabs({ id, onTabNavigate }) {
    const tabs = [['edit', 'Edit'], ['preview', 'Preview'], ['share', 'Share'], ['responses', 'Responses'], ['analytics', 'Analytics']];
    const location = useLocation();
    const currentSection = location.pathname.replace(/\/+$/, '').split('/').pop();
    return (<div className="space-y-2">
      <nav aria-label="Form sections" className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([path, label]) => (<NavLink key={path} end to={`/app/forms/${id}/${path}`} onClick={event => {
            const modifiedClick = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button !== 0 && event.detail !== 0);
            if (!onTabNavigate || path === currentSection || modifiedClick)
                return;
            event.preventDefault();
            onTabNavigate(path);
        }} className={({ isActive }) => cn('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', isActive ? 'border-ink text-ink' : 'border-transparent text-neutral-500 hover:text-ink')}>{label}</NavLink>))}
      </nav>
    </div>);
}
