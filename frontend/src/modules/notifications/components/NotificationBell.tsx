import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Bell, CheckCheck, Megaphone, Plane, Settings } from 'lucide-react';
import type { Notification, NotificationType } from '@/shared/types';
import { cn } from '@/shared/lib/utils';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllAsRead,
  markAsRead,
} from '../api/notifications-api';

const TYPE_ICON: Record<NotificationType, typeof AlertTriangle> = {
  gps_alert: AlertTriangle,
  travel_request: Plane,
  announcement: Megaphone,
  system: Settings,
};

function formatRelativeTime(value: string) {
  const then = new Date(value).getTime();
  const seconds = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildTarget(notification: Notification) {
  const params = new URLSearchParams();
  if (notification.targetTab) params.set('tab', notification.targetTab);
  if (notification.entityId) params.set('entityId', notification.entityId);
  const query = params.toString();
  return query ? `${notification.targetUrl}?${query}` : notification.targetUrl;
}

export function NotificationBell() {
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const sortedNotifications = useMemo(
    () =>
      [...notifications].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [notifications],
  );

  const refresh = useCallback(async () => {
    const [items, count] = await Promise.all([fetchNotifications(), fetchUnreadCount()]);
    setNotifications(items);
    setUnreadCount(count);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  async function handleToggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) {
      setLoading(true);
      try {
        await refresh();
      } finally {
        setLoading(false);
      }
    }
  }

  async function handleOpenNotification(notification: Notification) {
    setNotifications((items) =>
      items.map((item) => (item.id === notification.id ? { ...item, isRead: true } : item)),
    );
    setUnreadCount((count) => Math.max(0, count - (notification.isRead ? 0 : 1)));
    await markAsRead(notification.id).catch(() => {});
    setOpen(false);
    navigate(buildTarget(notification));
  }

  async function handleMarkAllAsRead() {
    setNotifications((items) => items.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);
    await markAllAsRead().catch(() => {});
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={handleToggle}
        className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg bg-white shadow-brand-lg ring-1 ring-zinc-100">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <p className="text-sm font-semibold text-zinc-900">Notifications</p>
            <button
              onClick={handleMarkAllAsRead}
              disabled={unreadCount === 0}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-brand-teal hover:bg-brand-cream disabled:pointer-events-none disabled:text-zinc-300"
            >
              <CheckCheck className="size-3.5" />
              Mark all as read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && notifications.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">Loading...</div>
            )}
            {!loading && sortedNotifications.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">No notifications.</div>
            )}
            {sortedNotifications.map((notification) => {
              const Icon = TYPE_ICON[notification.type] ?? Settings;
              return (
                <button
                  key={notification.id}
                  onClick={() => handleOpenNotification(notification)}
                  className={cn(
                    'flex w-full gap-3 border-b border-zinc-50 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-brand-cream/70',
                    !notification.isRead && 'bg-brand-moss/30',
                  )}
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-brand-teal ring-1 ring-zinc-100">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-sm font-semibold text-zinc-900">{notification.title}</span>
                      {!notification.isRead && (
                        <span className="mt-1 size-2 shrink-0 rounded-full bg-brand-teal" />
                      )}
                    </span>
                    <span className="mt-0.5 whitespace-pre-line text-xs leading-5 text-zinc-600">
                      {notification.message}
                    </span>
                    <span className="mt-1 block text-[11px] font-medium text-zinc-400">
                      {formatRelativeTime(notification.createdAt)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setOpen(false)}
            className="block w-full border-t border-zinc-100 px-4 py-3 text-center text-xs font-semibold text-brand-teal hover:bg-brand-cream"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
