import { type ReactNode, useMemo, useState } from 'react';
import { useAuth } from '@/modules/auth/context/auth-context';
import { NavLink, useLocation } from 'react-router';
import {
  Car,
  LayoutDashboard,
  FileSpreadsheet,
  Settings,
  LogOut,
  Menu,
  ChevronDown,
  Plane,
  MapPin,
  ClipboardCheck,
  KeyRound,
  User,
  Star,
  History,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { PasswordModal, AccountModal } from './UserModals';
import { canAccessNav } from '@/shared/config/role-access';
import { NotificationBell } from '@/modules/notifications/components/NotificationBell';
import { GlobalSearch } from './GlobalSearch';
import { CommandPalette } from './CommandPalette';
import { DashboardDrawer } from './DashboardDrawer';
import { useDrawer } from '@/shared/context/DrawerContext';
import { useRecentActivity } from '@/shared/context/RecentActivityContext';
import { useFavorites } from '@/shared/context/FavoritesContext';

const ALL_NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/travel-orders', label: 'Travel Orders', icon: Plane },
  { to: '/travel-requests', label: 'Travel Requests', icon: ClipboardCheck },
  { to: '/gps-logs', label: 'GPS Logs', icon: MapPin },
  { to: '/list', label: 'List', icon: Car },
  { to: '/reports', label: 'Reports', icon: FileSpreadsheet },
  { to: '/settings', label: 'Settings', icon: Settings },
];

// ── Favorites Sidebar Section ──────────────────────────────────

function FavoritesSidebarSection() {
  const { items } = useFavorites();
  const { openDrawer } = useDrawer();

  if (items.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Star className="size-3.5 text-amber-500" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Pinned</span>
      </div>
      {items.slice(0, 5).map((item) => (
        <button
          key={`${item.type}-${item.id}`}
          onClick={() => {
            switch (item.type) {
              case 'vehicle':
                openDrawer({ type: 'vehicle', vehicleId: item.id, plateNumber: item.label });
                break;
              case 'driver':
                openDrawer({ type: 'driver', driverId: item.id, driverName: item.label });
                break;
              case 'trip':
                openDrawer({ type: 'trip', tripId: item.id, toNumber: item.label });
                break;
              case 'travel-order':
                openDrawer({ type: 'travel-order', orderId: item.id, toNumber: item.label });
                break;
            }
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-zinc-600 transition-colors hover:bg-brand-cream hover:text-brand-teal"
        >
          <Star className="size-3 shrink-0 text-amber-400" fill="currentColor" />
          <span className="truncate">{item.label}</span>
          {item.subtitle && <span className="truncate text-[10px] text-zinc-400">{item.subtitle}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Recent Activity Sidebar Section ────────────────────────────

function RecentActivitySidebarSection() {
  const { items } = useRecentActivity();
  const { openDrawer } = useDrawer();

  if (items.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <History className="size-3.5 text-brand-teal" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Recent</span>
      </div>
      {items.slice(0, 5).map((item) => (
        <button
          key={`${item.type}-${item.id}`}
          onClick={() => {
            switch (item.type) {
              case 'vehicle':
                openDrawer({ type: 'vehicle', vehicleId: item.id, plateNumber: item.label });
                break;
              case 'driver':
                openDrawer({ type: 'driver', driverId: item.id, driverName: item.label });
                break;
              case 'trip':
                openDrawer({ type: 'trip', tripId: item.id, toNumber: item.label });
                break;
              case 'travel-order':
                openDrawer({ type: 'travel-order', orderId: item.id, toNumber: item.label });
                break;
            }
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-zinc-600 transition-colors hover:bg-brand-cream hover:text-brand-teal"
        >
          <History className="size-3 shrink-0 text-zinc-400" />
          <span className="truncate">{item.label}</span>
          {item.subtitle && <span className="truncate text-[10px] text-zinc-400">{item.subtitle}</span>}
        </button>
      ))}
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [modalType, setModalType] = useState<'password' | 'account' | null>(null);

  // Filter nav items based on user role
  const NAV_ITEMS = useMemo(() => {
    if (!user) return [];
    return ALL_NAV_ITEMS.filter((item) => canAccessNav(item.to, user.userType));
  }, [user]);

  return (
    <div className="flex min-h-dvh flex-row bg-brand-pastel text-zinc-900">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed, full-height, independently scrollable */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-white shadow-brand transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 shrink-0 items-center gap-2.5 px-6">
          <img src="/LogoOnly.png" alt="HexCar Tracker" className="h-8 w-8 object-contain" />
          <span className="text-lg font-bold tracking-tight text-brand-teal">
            HexCar Tracker
          </span>
        </div>

        {/* Nav links — scrollable when items overflow */}
        <nav className="flex-1 overflow-y-auto space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-moss/50 text-brand-teal'
                    : 'text-zinc-500 hover:bg-brand-cream hover:text-brand-teal'
                )}
              >
                <item.icon className="size-4.5" />
                {item.label}
              </NavLink>
            );
          })}

          {/* ── Favorites Section ─────────────────────── */}
          <FavoritesSidebarSection />
          
          {/* ── Recent Activity Section ───────────────── */}
          <RecentActivitySidebarSection />
        </nav>

        {/* User area at bottom */}
        <div className="shrink-0 p-4">
          <div className="flex items-center gap-3">
            {user?.picture ? (
              <img
                src={user.picture}
                alt={user.name}
                className="size-9 rounded-full object-cover"
              />
            ) : (
              <div className="flex size-9 items-center justify-center rounded-full bg-brand-moss/50 text-sm font-semibold text-brand-teal">
                {user?.name?.charAt(0) ?? 'A'}
              </div>
            )}
            <div className="flex-1 truncate">
              <p className="text-sm font-medium text-zinc-900">{user?.name}</p>
              <p className="text-xs text-zinc-400">{user?.department}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content wrapper — offset by sidebar width on desktop, independent scroll */}
      <div className="flex h-dvh flex-1 flex-col overflow-y-auto lg:ml-64">
        {/* Top header */}
        <header className="flex h-14 shrink-0 items-center bg-white shadow-brand px-3 lg:h-16 lg:px-8">
          {/* Left: Hamburger (mobile only) + Branding */}
          <div className="flex items-center gap-2 lg:hidden">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex items-center justify-center rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 min-h-[44px] min-w-[44px]"
              aria-label="Open navigation menu"
            >
              <Menu className="size-5" />
            </button>
            <span className="text-base font-bold tracking-tight text-brand-teal">
              HexCar Tracker
            </span>
          </div>

          {/* Global Search (desktop) */}
          <div className="hidden lg:block flex-1 max-w-md mx-auto">
            <GlobalSearch />
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1.5 lg:gap-3 ml-auto">
            <NotificationBell />

            <div className="relative hidden items-center gap-2 sm:flex">
              <button
                onClick={() => {
                  setUserMenuOpen((prev) => !prev);
                }}
                className="flex items-center gap-2 rounded-lg p-1.5 pr-2 transition-colors hover:bg-zinc-100"
                aria-label="User menu"
                aria-expanded={userMenuOpen}
              >
                {user?.picture ? (
                  <img
                    src={user.picture}
                    alt={user.name}
                    className="size-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex size-8 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700">
                    {user?.name?.charAt(0) ?? 'A'}
                  </div>
                )}
                <div className="text-right text-sm leading-tight">
                  <p className="font-medium text-zinc-900">{user?.name}</p>
                  <p className="text-xs text-zinc-400">{user?.department}</p>
                </div>
                <ChevronDown className="size-4 text-zinc-300" />
              </button>

              {userMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl bg-white py-1 shadow-brand-lg ring-1 ring-zinc-100">
                    <button
                      onClick={() => {
                        setModalType('account');
                        setUserMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-zinc-700 transition-colors hover:bg-brand-cream hover:text-brand-teal"
                    >
                      <User className="size-4 text-zinc-400" />
                      Account
                    </button>
                    <button
                      onClick={() => {
                        setModalType('password');
                        setUserMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-zinc-700 transition-colors hover:bg-brand-cream hover:text-brand-teal"
                    >
                      <KeyRound className="size-4 text-zinc-400" />
                      Password
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={logout}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm text-zinc-500 hover:bg-red-50 hover:text-red-600 min-h-[44px]"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-10">{children}</main>

        {/* Dashboard Drawer (global) */}
        <DashboardDrawer />
        
        {/* Command Palette (Ctrl+K) */}
        <CommandPalette />

        {/* Modals */}
        <PasswordModal
          open={modalType === 'password'}
          onClose={() => setModalType(null)}
          onPasswordChanged={logout}
          currentUserId={user?.id}
        />
        <AccountModal
          open={modalType === 'account'}
          currentUser={user ?? null}
          onClose={() => setModalType(null)}
        />
      </div>
    </div>
  );
}
