import { configureStore, createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { api } from '../services/api.js';
const blank = { forms: [], responses: [], load: 'idle' };
const initialState = { ...blank, auth: { user: null, status: 'idle', clerkUserId: null, error: null } };
export const loadDashboard = createAsyncThunk('app/load', async () => {
    const [forms, responses] = await Promise.all([api.listForms(), api.activity()]);
    return { forms, responses };
}, {
    condition: (clerkUserId, { getState }) => {
        const auth = getState().auth;
        return auth.status === 'ready' && auth.clerkUserId === clerkUserId;
    },
});
export const loadProfile = createAsyncThunk('auth/profile', () => api.ensureProfile(), {
    condition: (clerkUserId, { getState }) => {
        const auth = getState().auth;
        return auth.status === 'error' || auth.clerkUserId !== clerkUserId;
    },
});
export const fetchForm = createAsyncThunk('app/fetchForm', (id) => api.getForm(id));
export const createForm = createAsyncThunk('app/create', (b) => api.createForm(b));
export const duplicateForm = createAsyncThunk('app/duplicate', (id) => api.duplicate(id));
export const removeForm = createAsyncThunk('app/remove', async (id) => { await api.removeForm(id); return id; });
export const setStatus = createAsyncThunk('app/status', (a) => api.setStatus(a.id, a.status));
export const updateForm = createAsyncThunk('forms/update', ({ id, ...body }) => api.patchForm(id, body));
export const saveProfile = createAsyncThunk('settings/save', (b) => api.saveSettings(b));
export const deleteAccount = createAsyncThunk('settings/delete', () => api.deleteAccount());
const clearWorkspaceData = s => {
    s.forms = [];
    s.responses = [];
    s.load = 'idle';
    s.loadError = undefined;
};
const upsert = (s, f) => {
    const i = s.forms.findIndex(x => x.id === f.id);
    if (i < 0)
        s.forms.unshift(f);
    else
        s.forms[i] = { ...s.forms[i], ...f };
};
const slice = createSlice({
    name: 'app', initialState,
    reducers: {
        clearAuthProfile: (s) => {
            clearWorkspaceData(s);
            s.auth = { user: null, status: 'idle', clerkUserId: null, error: null };
        },
        responseDeleted: (s, a) => {
            const form = s.forms.find(f => f.id === a.payload.formId);
            if (form?.responseCount != null)
                form.responseCount = Math.max(0, form.responseCount - 1);
            s.responses = s.responses.filter(r => r.id !== a.payload.responseId);
        },
    },
    extraReducers: b => {
        b.addCase(loadDashboard.pending, s => { s.load = 'loading'; s.loadError = undefined; })
            .addCase(loadDashboard.fulfilled, (s, a) => {
                if (s.auth.status !== 'ready' || s.auth.clerkUserId !== a.meta.arg)
                    return;
                s.load = 'ready';
                s.forms = a.payload.forms;
                s.responses = a.payload.responses;
            })
            .addCase(loadDashboard.rejected, (s, a) => {
                if (s.auth.status !== 'ready' || s.auth.clerkUserId !== a.meta.arg)
                    return;
                s.load = 'error';
                s.loadError = a.error.message;
            })
            .addCase(fetchForm.fulfilled, (s, a) => upsert(s, a.payload))
            .addCase(createForm.fulfilled, (s, a) => upsert(s, a.payload))
            .addCase(duplicateForm.fulfilled, (s, a) => upsert(s, a.payload))
            .addCase(updateForm.fulfilled, (s, a) => upsert(s, a.payload))
            .addCase(setStatus.fulfilled, (s, a) => upsert(s, a.payload))
            .addCase(removeForm.fulfilled, (s, a) => { s.forms = s.forms.filter(f => f.id !== a.payload); s.responses = s.responses.filter(r => r.formId !== a.payload); })
            .addCase(saveProfile.fulfilled, (s, a) => { s.auth.user = a.payload; })
            .addCase(loadProfile.pending, (s, a) => {
                if (s.auth.clerkUserId !== a.meta.arg)
                    clearWorkspaceData(s);
                s.auth.status = 'loading';
                s.auth.clerkUserId = a.meta.arg;
                s.auth.error = null;
            })
            .addCase(loadProfile.fulfilled, (s, a) => {
                if (s.auth.clerkUserId !== a.meta.arg) return;
                s.auth.user = a.payload;
                s.auth.status = 'ready';
            })
            .addCase(loadProfile.rejected, (s, a) => {
                if (s.auth.clerkUserId !== a.meta.arg) return;
                s.auth.status = 'error';
                s.auth.error = a.error.message ?? 'Could not load your account profile.';
            });
    },
});
export const store = configureStore({ reducer: slice.reducer });
export const responseDeleted = slice.actions.responseDeleted;
export const clearAuthProfile = slice.actions.clearAuthProfile;
export const useAppDispatch = () => useDispatch();
export const useAppSelector = useSelector;
