import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import AppLayout from './components/AppLayout.jsx';
import RequireAuth from './components/RequireAuth.jsx';
const Landing = lazy(() => import('./pages/Landing.jsx'));
const Login = lazy(() => import('./pages/Auth.jsx').then(module => ({ default: module.Login })));
const Signup = lazy(() => import('./pages/Auth.jsx').then(module => ({ default: module.Signup })));
const ForgotPassword = lazy(() => import('./pages/Auth.jsx').then(module => ({ default: module.ForgotPassword })));
const PublicForm = lazy(() => import('./pages/PublicForm.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const CreateForm = lazy(() => import('./pages/CreateForm.jsx'));
const Preview = lazy(() => import('./pages/Preview.jsx'));
const Share = lazy(() => import('./pages/Share.jsx'));
const Responses = lazy(() => import('./pages/Responses.jsx'));
const Analytics = lazy(() => import('./pages/Analytics.jsx'));
const Editor = lazy(() => import('./pages/Editor.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const RouteLoading = () => <p role="status" className="p-6 text-sm text-neutral-500">Loading…</p>;
export default function App() {
    return (<Suspense fallback={<RouteLoading />}><Routes>
      <Route path="/" element={<Landing />}/>
      <Route path="/login/*" element={<Login />}/>
      <Route path="/signup/*" element={<Signup />}/>
      <Route path="/forgot-password" element={<ForgotPassword />}/>
      <Route path="/forms/:formId" element={<PublicForm />}/>
      <Route element={<RequireAuth><Outlet /></RequireAuth>}>
        <Route path="/app/forms/:id/edit" element={<Editor />}/>
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Dashboard />}/>
          <Route path="forms/new" element={<CreateForm />}/>
          <Route path="forms/:id/preview" element={<Preview />}/>
          <Route path="forms/:id/share" element={<Share />}/>
          <Route path="forms/:id/responses" element={<Responses />}/>
          <Route path="forms/:id/analytics" element={<Analytics />}/>
          <Route path="settings" element={<Settings />}/>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/app" replace/>}/>
    </Routes></Suspense>);
}
