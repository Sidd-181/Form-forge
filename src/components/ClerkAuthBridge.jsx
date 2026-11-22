import { useEffect } from 'react';
import { useAuth } from '@clerk/react';
import { clearAuthProfile, loadProfile, useAppDispatch } from '../store';
import { setAuthTokenGetter } from '../services/api';

export default function ClerkAuthBridge() {
    const { getToken, isLoaded, isSignedIn, userId } = useAuth();
    const dispatch = useAppDispatch();

    useEffect(() => {
        setAuthTokenGetter(getToken);
    }, [getToken]);

    useEffect(() => {
        if (!isLoaded)
            return;
        if (isSignedIn && userId)
            void dispatch(loadProfile(userId));
        else
            dispatch(clearAuthProfile());
    }, [dispatch, isLoaded, isSignedIn, userId]);

    return null;
}
