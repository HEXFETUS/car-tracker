import { type ReactNode } from 'react';
import { useAuth } from '@/context/auth-context';
import { NavLink, useLocation } from 'react-router';
import {
  Car,
  LayoutDashboard,
  Wrench,
  Settings,
  LogOut,
  Menu,
  Bell,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/vehicles', label: 'Vehicles', icon: Car },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-zinc-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-2.5 border-b border-zinc-100 px-6">
          <div className="flex size-8 items-center justify-center rounded-lg bg-zinc-900">
            <Car className="size-4 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-zinc-900">
            CarTracker
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-zinc-100 text-zinc-900'
                    : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800'
                )}
              >
                <item.icon className="size-4.5" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* User area at bottom */}
        <div className="border-t border-zinc-100 p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700">
              {user?.name?.charAt(0) ?? 'A'}
            </div>
            <div className="flex-1 truncate">
              <p className="text-sm font-medium text-zinc-900">{user?.name}</p>
              <p className="text-xs text-zinc-400">{user?.role}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col">
        {/* Top header */}
        <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-4 lg:px-8">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex items-center gap-2 text-zinc-600 lg:hidden"
          >
            <Menu className="size-5" />
          </button>

          <div className="hidden lg:block">
            <h2 className="text-sm font-medium text-zinc-500">
              {NAV_ITEMS.find((i) => i.to === location.pathname)?.label ?? 'Dashboard'}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <button className="relative rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
              <Bell className="size-5" />
              <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-red-500 ring-2 ring-white" />
            </button>

            <div className="hidden items-center gap-2 sm:flex">
              <div className="flex size-8 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700">
                {user?.name?.charAt(0) ?? 'A'}
              </div>
              <div className="text-right text-sm leading-tight">
                <p className="font-medium text-zinc-900">{user?.name}</p>
                <p className="text-xs text-zinc-400">{user?.role}</p>
              </div>
              <ChevronDown className="size-4 text-zinc-300" />
            </div>

            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-red-50 hover:text-red-600"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}