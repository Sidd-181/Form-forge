import { SignIn as ClerkSignIn, SignUp as ClerkSignUp } from '@clerk/react';
import { Navigate, useLocation } from 'react-router-dom';
import { Logo } from '../components/AppLayout.jsx';

function AuthPage({ children }) {
    return <div className="grid min-h-screen place-items-center bg-canvas p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Logo /></div>
        {children}
      </div>
    </div>;
}

export function Login() {
    const from = useLocation().state?.from ?? '/app';
    return <AuthPage><ClerkSignIn routing="path" path="/login" signUpUrl="/signup" forceRedirectUrl={from}/></AuthPage>;
}

export function Signup() {
    return <AuthPage><ClerkSignUp routing="path" path="/signup" signInUrl="/login" forceRedirectUrl="/app"/></AuthPage>;
}

export function ForgotPassword() {
    return <Navigate to="/login" replace/>;
}
