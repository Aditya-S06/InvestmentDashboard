'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Activity, Eye, EyeOff, TrendingUp } from 'lucide-react';

export function LoginForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!isLogin) {
        const res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error || 'Signup failed');
          setLoading(false);
          return;
        }
      }

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid credentials');
        setLoading(false);
      } else {
        router.replace('/dashboard');
      }
    } catch {
      setError('Something went wrong');
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-lg bg-[#00c853]/10 border border-[#00c853]/30 flex items-center justify-center">
            <Activity className="w-5 h-5 text-[#00c853]" />
          </div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-foreground">Market Intel</h1>
        </div>
        <p className="text-sm text-muted-foreground">Financial Intelligence Dashboard</p>
      </div>

      <div className="bg-card rounded-lg border border-border p-6" style={{ boxShadow: 'var(--shadow-lg)' }}>
        <div className="flex mb-6 bg-secondary rounded-md p-0.5">
          <button
            type="button"
            onClick={() => { setIsLogin(true); setError(''); }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              isLogin ? 'bg-[#00c853] text-white' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setIsLogin(false); setError(''); }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              !isLogin ? 'bg-[#00c853] text-white' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2.5 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#00c853] focus:border-[#00c853]"
                placeholder="Your name"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#00c853] focus:border-[#00c853]"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#00c853] focus:border-[#00c853] pr-10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#00c853] hover:bg-[#00c853]/90 text-white font-medium rounded-md text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <TrendingUp className="w-4 h-4" />
                {isLogin ? 'Sign In' : 'Create Account'}
              </>
            )}
          </button>
        </form>
      </div>

      <p className="text-center text-[10px] text-muted-foreground mt-4 opacity-60">
        Market data provided by Yahoo Finance. Not financial advice.
      </p>
    </div>
  );
}
