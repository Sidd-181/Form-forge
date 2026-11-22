import { ClerkProvider } from '@clerk/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { store } from './store';
import App from './App.jsx';
import ClerkAuthBridge from './components/ClerkAuthBridge.jsx';
import './index.css';
import { initTheme } from './services/theme';
initTheme();
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
createRoot(document.getElementById('root')).render(<StrictMode><ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
<Provider store={store}><ClerkAuthBridge /><BrowserRouter><App /></BrowserRouter></Provider>
</ClerkProvider></StrictMode>);