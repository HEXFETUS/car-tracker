import { useState, type FormEvent } from 'react';
import { useAuth } from '@/context/auth-context';
import { Car, ShieldCheck } from 'lucide-react';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('alex.driver@fleet.com');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Please enter email and password.');
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
    } catch {
      setError('Invalid credentials. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left — Branding */}
      <div className="hidden w-1/2 flex-col items-center justify-center bg-zinc-950 p-12 text-white lg:flex">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-zinc-800">
            <Car className="size-8 text-emerald-400" />
          </div>
          <h1 className="mb-2 text-3xl font-bold tracking-tight">CarTracker</h1>
          <p className="text-zinc-400">
            Enterprise fleet management platform. Monitor, maintain, and optimize your entire vehicle fleet from one dashboard.
          </p>
          <div className="mt-8 flex items-center justify-center gap-6 text-sm text-zinc-500">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-4" /> SOC 2 Compliant
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-4" /> 99.9% Uptime
            </span>
          </div>
        </div>
      </div>

      {/* Right — Login Form */}
      <div className="flex w-full items-center justify-center bg-white p-8 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="mb-4 inline-flex items-center gap-2 text-zinc-900">
              <Car className="size-6" />
              <span className="text-xl font-bold">CarTracker</span>
            </div>
          </div>

          <h2 className="mb-1 text-2xl font-semibold tracking-tight text-zinc-900">
            Welcome back
          </h2>
          <p className="mb-8 text-sm text-zinc-500">
            Sign in to manage your fleet.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-zinc-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@fleet.com"
                className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-zinc-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-zinc-400">
            Demo: use any password — user <span className="font-mono text-zinc-600">alex.driver@fleet.com</span>
          </p>
        </div>
      </div>
    </div>
  );
}