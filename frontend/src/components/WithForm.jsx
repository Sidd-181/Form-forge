import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { fetchForm, useAppDispatch, useAppSelector } from '../store';
import { Button } from './ui.jsx';
// Resolves the :id route param to a form (from the store, or fetched), with loading and not-found states.
export default function WithForm({ children, fullScreen = false }) {
    const { id = '' } = useParams();
    const dispatch = useAppDispatch();
    const form = useAppSelector(s => s.forms.find(f => f.id === id));
    const validId = /^[a-f\d]{24}$/i.test(id);
    const [load, setLoad] = useState({ id: null, status: 'loading', error: null });
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let current = true;
        if (!validId) {
            setLoad({ id, status: 'missing', error: null });
            return () => { current = false; };
        }
        if (form) {
            setLoad({ id, status: 'ready', error: null });
            return () => { current = false; };
        }
        setLoad({ id, status: 'loading', error: null });
        if (!id) {
            setLoad({ id, status: 'missing', error: null });
            return () => { current = false; };
        }
        dispatch(fetchForm(id)).unwrap().catch(error => {
            if (current) {
                setLoad({
                    id,
                    status: error?.message === 'Form not found' ? 'missing' : 'error',
                    error: error?.message ?? 'Could not load this form.',
                });
            }
        });
        return () => { current = false; };
    }, [dispatch, id, form, attempt, validId]);
    if (form && validId)
        return <>{children(form)}</>;
    if (load.id !== id || load.status === 'loading')
        return <div className={`grid ${fullScreen ? 'min-h-screen' : 'min-h-[40vh]'} place-items-center text-neutral-500`}><Loader2 className="animate-spin" aria-label="Loading form"/></div>;
    if (load.status === 'missing')
        return <div className="py-20 text-center"><h1 className="font-medium">Form not found</h1><Link to="/app" className="mt-2 inline-block text-sm text-accent-600">Back to dashboard</Link></div>;
    return <div className="py-20 text-center"><p role="alert" className="font-medium">Couldn’t load this form</p><p className="mt-2 text-sm text-neutral-500">{load.error}</p><Button className="mt-4" onClick={() => setAttempt(value => value + 1)}>Try again</Button></div>;
}
