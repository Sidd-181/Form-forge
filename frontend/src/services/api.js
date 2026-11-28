const configuredApiBase = import.meta.env?.VITE_API_BASE_URL?.trim() || '/api';
const trimmedApiBase = configuredApiBase.replace(/\/+$/, '');
const API_BASE_URL = trimmedApiBase === '/api' || trimmedApiBase.endsWith('/api')
    ? trimmedApiBase
    : `${trimmedApiBase}/api`;
const apiUrl = path => `${API_BASE_URL}${path}`;
let authTokenGetter = async () => null;
export const setAuthTokenGetter = getter => { authTokenGetter = getter; };

function httpErrorMessage(status, responseMessage, fallback) {
    if (responseMessage)
        return responseMessage;
    if ([502, 503, 504].includes(status))
        return `The API server is unavailable (HTTP ${status}). Check that the backend is running and connected to MongoDB.`;
    if (status === 404)
        return 'The API endpoint was not found (HTTP 404). Check that VITE_API_BASE_URL points to your backend.';
    return `${fallback} (HTTP ${status})`;
}

export class ApiError extends Error {
    status;
    body;
    constructor(status, message, body) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.body = body;
    }
}

async function request(path, { method = 'GET', body, bodyType = 'json', responseType = 'json' } = {}) {
    const token = await authTokenGetter();
    const headers = {};
    let requestBody;
    if (body !== undefined) {
        if (bodyType === 'formData')
            requestBody = body;
        else {
            headers['Content-Type'] = 'application/json';
            requestBody = JSON.stringify(body);
        }
    }
    if (token)
        headers.Authorization = `Bearer ${token}`;

    let response;
    try {
        response = await fetch(apiUrl(path), { method, headers, body: requestBody });
    }
    catch {
        throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
    }
    if (response.status === 204)
        return undefined;
    if (response.ok && responseType === 'blob')
        return response.blob();

    let data;
    try {
        data = await response.json();
    }
    catch {
        if (response.ok)
            throw new ApiError(response.status, 'The server returned an invalid response.');
    }
    if (!response.ok)
        throw new ApiError(response.status, httpErrorMessage(response.status, data?.error ?? data?.message, 'Request failed'), data);
    return data;
}

const encode = value => encodeURIComponent(value);
const formPath = id => `/forms/${encode(id)}`;
const queryString = query => {
    const params = new URLSearchParams();
    Object.entries(query ?? {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '')
            params.set(key, String(value));
    });
    const serialized = params.toString();
    return serialized ? `?${serialized}` : '';
};
export const api = {
    ensureProfile: () => request('/auth/profile', { method: 'POST' }),
    listForms: () => request('/forms'),
    getForm: id => request(formPath(id)),
    createForm: body => request('/forms', { method: 'POST', body }),
    patchForm: (id, body) => request(formPath(id), { method: 'PATCH', body }),
    setStatus: (id, status) => request(`${formPath(id)}/status`, { method: 'POST', body: { status } }),
    duplicate: id => request(`${formPath(id)}/duplicate`, { method: 'POST' }),
    removeForm: id => request(formPath(id), { method: 'DELETE' }),
    getPublicForm: id => request(`/public/forms/${encode(id)}`),
    uploadFile: (formId, fieldId, file) => {
        const body = new FormData();
        body.append('file', file);
        return request(`/public/forms/${encode(formId)}/uploads/${encode(fieldId)}`, {
            method: 'POST',
            body,
            bodyType: 'formData',
        });
    },
    downloadFile: (formId, fileId) => request(`${formPath(formId)}/files/${encode(fileId)}`, { responseType: 'blob' }),
    submitResponse: (id, answers, completionSeconds) => request(`/public/forms/${encode(id)}/responses`, {
        method: 'POST',
        body: { answers, completionSeconds },
    }),
    listResponses: (id, query) => request(`${formPath(id)}/responses${queryString(query)}`),
    deleteResponse: (id, responseId) => request(`${formPath(id)}/responses/${encode(responseId)}`, { method: 'DELETE' }),
    updateResponseStatus: (id, responseId, status) => request(`${formPath(id)}/responses/${encode(responseId)}/status`, { method: 'PATCH', body: { status } }),
    deleteResponses: (id, responseIds) => request(`${formPath(id)}/responses`, { method: 'DELETE', body: { responseIds } }),
    exportResponses: (id, query) => request(`${formPath(id)}/responses/export${queryString(query)}`, { responseType: 'blob' }),
    saveSettings: body => request('/settings', { method: 'PATCH', body }),
    deleteAccount: () => request('/settings/account', { method: 'DELETE' }),
    activity: () => request('/forms/activity'),
    googleSheetsConnection: () => request('/integrations/google-sheets/connection'),
    connectGoogleSheets: body => request('/integrations/google-sheets/connect', { method: 'POST', body }),
    disconnectGoogleSheets: () => request('/integrations/google-sheets/connection', { method: 'DELETE' }),
    googleSheetsSpreadsheets: () => request('/integrations/google-sheets/spreadsheets'),
    googleSheetsWorksheets: spreadsheetId => request(`/integrations/google-sheets/spreadsheets/${encode(spreadsheetId)}/sheets`),
    googleSheetsForm: formId => request(`/integrations/google-sheets/forms/${encode(formId)}`),
    saveGoogleSheetsForm: (formId, body) => request(`/integrations/google-sheets/forms/${encode(formId)}`, { method: 'PUT', body }),
    retryGoogleSheetsDelivery: (formId, deliveryId) => request(`/integrations/google-sheets/forms/${encode(formId)}/deliveries/${encode(deliveryId)}/retry`, { method: 'POST' }),
};
