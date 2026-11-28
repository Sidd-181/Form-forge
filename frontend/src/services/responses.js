import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { responseDeleted, responsesDeleted, useAppDispatch } from '../store/index.js';
export function useResponses(formId, query) {
    const dispatch = useAppDispatch();
    const [state, setState] = useState({ data: null, error: null, loading: true });
    const [tick, setTick] = useState(0);
    const queryKey = JSON.stringify(query ?? null);
    useEffect(() => {
        let live = true;
        setState(current => ({ ...current, loading: true, error: null }));
        const requestQuery = queryKey === 'null' ? undefined : JSON.parse(queryKey);
        api.listResponses(formId, requestQuery)
            .then(data => live && setState({ data, error: null, loading: false }))
            .catch(e => live && setState(current => ({ ...current, error: e.message, loading: false })));
        return () => { live = false; };
    }, [formId, queryKey, tick]);
    const reload = useCallback(() => { setState({ data: null, error: null, loading: true }); setTick(t => t + 1); }, []);
    const remove = async rid => {
        await api.deleteResponse(formId, rid);
        setState(s => {
            if (Array.isArray(s.data))
                return { ...s, data: s.data.filter(response => response.id !== rid) };
            if (!s.data)
                return s;
            return { ...s, data: { ...s.data, items: s.data.items.filter(response => response.id !== rid), total: Math.max(0, s.data.total - 1), filteredTotal: Math.max(0, s.data.filteredTotal - 1) } };
        });
        dispatch(responseDeleted({ formId, responseId: rid }));
    };
    const removeMany = async responseIds => {
        const { deletedCount } = await api.deleteResponses(formId, responseIds);
        dispatch(responsesDeleted({ formId, responseIds, deletedCount }));
        setState(s => {
            if (!s.data || Array.isArray(s.data))
                return s;
            const deleted = new Set(responseIds);
            return { ...s, data: { ...s.data, items: s.data.items.filter(response => !deleted.has(response.id)), total: Math.max(0, s.data.total - deletedCount), filteredTotal: Math.max(0, s.data.filteredTotal - deletedCount) } };
        });
        return deletedCount;
    };
    const updateStatus = async (responseId, status) => {
        const response = await api.updateResponseStatus(formId, responseId, status);
        setState(s => {
            if (!s.data || Array.isArray(s.data))
                return s;
            return { ...s, data: { ...s.data, items: s.data.items.map(item => item.id === responseId ? response : item) } };
        });
        return response;
    };
    return { ...state, reload, remove, removeMany, updateStatus };
}
export const fmtAnswer = (a) => Array.isArray(a) ? a.join(', ') : typeof a === 'boolean' ? (a ? 'Yes' : 'No') : a && typeof a === 'object' && 'fileId' in a ? String(a.name ?? 'Uploaded file') : a == null ? '' : String(a);
export const responseFieldKey = field => `${field.id}\u0000${field.label}\u0000${field.type}`;
export function fieldsForResponse(response, fallbackFields) {
    return Array.isArray(response.fieldSnapshots) && response.fieldSnapshots.length ? response.fieldSnapshots : fallbackFields;
}
export function responseFieldColumns(responses, fallbackFields) {
    const columns = new Map(fallbackFields.map(field => [responseFieldKey(field), field]));
    for (const response of responses) {
        for (const field of fieldsForResponse(response, fallbackFields)) {
            const key = responseFieldKey(field);
            if (!columns.has(key)) columns.set(key, field);
        }
    }
    return [...columns.values()];
}
export function answerForResponseField(response, field, fallbackFields) {
    const fields = fieldsForResponse(response, fallbackFields);
    return fields.some(snapshot => responseFieldKey(snapshot) === responseFieldKey(field))
        ? fmtAnswer(response.answers[field.id])
        : '';
}
// Inclusive local-date range check; `from`/`to` are yyyy-mm-dd strings from date inputs.
export function inRange(iso, from, to) {
    const t = new Date(iso).getTime();
    if (from && t < new Date(`${from}T00:00:00`).getTime())
        return false;
    if (to && t > new Date(`${to}T23:59:59.999`).getTime())
        return false;
    return true;
}
export function toCsv(rows) {
    // Prefix formula-looking text so spreadsheets don't execute it (CSV injection).
    const cell = (v) => {
        const s = /^[=+\-@]/.test(v) && !Number.isFinite(Number(v)) ? `'${v}` : v;
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return rows.map(r => r.map(cell).join(',')).join('\r\n');
}
export function downloadCsv(name, csv) {
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}
