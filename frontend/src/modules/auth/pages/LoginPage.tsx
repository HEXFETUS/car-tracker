import { useState, type FormEvent } from 'react';
import { useAuth } from '@/modules/auth/context/auth-context';
import { Car, ShieldCheck } from 'lucide-react';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!username || !password) {
      setError('Please enter username and password.');
      return;
    }
    setLoading(true);
    try {
      await login(username, password);
    } catch {
      setError('Invalid credentials. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left — Branding */}
      <div className="relative hidden w-1/2 flex-col items-center justify-center overflow-hidden p-12 text-white lg:flex">
        {/* Map background */}
        <iframe
          title="Map of Cagayan de Oro"
          src="https://www.openstreetmap.org/export/embed.html?bbox=124.565%2C8.430%2C124.705%2C8.530&layer=mapnik&marker=8.4803%2C124.6472"
          className="absolute inset-0 h-full w-full border-0"
          loading="lazy"
          tabIndex={-1}
          style={{ filter: 'brightness(0.4) hue-rotate(160deg) saturate(0.6)' }}
        />
        {/* Overlay */}
        <div className="absolute inset-0 bg-brand-teal/60" />
        {/* Content */}
        <div className="relative z-10 max-w-md text-center">
          <div className="mb-6 inline-flex items-center justify-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-white/10 p-2">
              <img src="/LogoOnly.png" alt="HexCar Tracker" className="h-full w-full object-contain" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">HexCar Tracker</h1>
          </div>
          <p className="text-white/70">
            Enterprise fleet management platform. Monitor, maintain, and optimize your entire vehicle fleet from one dashboard.
          </p>
          <div className="mt-8 flex items-center justify-center gap-6 text-sm text-white/50">
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
              <img src="/LogoOnly.png" alt="HexCar Tracker" className="size-7 object-contain" />
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
              <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-zinc-700">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="w-full rounded-lg border border-brand-sage bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-brand-teal focus:ring-2 focus:ring-brand-moss"
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
                className="w-full rounded-lg border border-brand-sage bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-brand-teal focus:ring-2 focus:ring-brand-moss"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-teal px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}