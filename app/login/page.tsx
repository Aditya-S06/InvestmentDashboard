import { isPublicSignupEnabled } from '@/lib/auth/signup';
import { LoginForm } from './_components/login-form';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <LoginForm signupEnabled={isPublicSignupEnabled()} />
    </div>
  );
}
