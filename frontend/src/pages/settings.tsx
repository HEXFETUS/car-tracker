import { Settings } from 'lucide-react';

export function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage your fleet preferences.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white py-24 text-center">
        <Settings className="mb-4 size-12 text-zinc-300" />
        <p className="text-lg font-medium text-zinc-500">Settings panel coming soon</p>
        <p className="mt-1 text-sm text-zinc-400">
          Configure notification preferences, team members, and billing.
        </p>
      </div>
    </div>
  );
}