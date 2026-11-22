import { useAuth } from '@clerk/react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { loadProfile, useAppDispatch, useAppSelector } from '../store';
import { Button } from './ui.jsx';
export default function RequireAuth({ children }) {
    const { isLoaded, isSignedIn, userId } = useAuth();
    const { status, error } = useAppSelector(s => s.auth);
    const dispatch = useAppDispatch();
    const loc = useLocation();
    if (!isLoaded)
        return <div className="grid min-h-screen place-items-center text-neutral-500"><Loader2 className="animate-spin"/></div>;
    if (!isSignedIn)
        return <Navigate to="/login" replace state={{ from: loc.pathname }}/>;
    if (status === 'error')
        return <div className="grid min-h-screen place-items-center p-6 text-center"><div><p role="alert" className="mb-3 text-sm text-red-600">{error}</p><Button onClick={() => dispatch(loadProfile(userId))}>Retry</Button></div></div>;
    if (status !== 'ready')
        return <div className="grid min-h-screen place-items-center text-neutral-500"><Loader2 className="animate-spin"/></div>;
    return <>{children}</>;
}
