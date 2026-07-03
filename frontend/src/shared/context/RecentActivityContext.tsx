// ── Recent Activity Context ────────────────────────────────────
//
// Tracks recently opened vehicles, trips, drivers, travel orders.

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type ActivityItemType = 'vehicle' | 'trip' | 'driver' | 'travel-order';

export interface ActivityItem {
  id: string;
  type: ActivityItemType;
  label: string;
  subtitle?: string;
  openedAt: number;
}

interface RecentActivityContextValue {
  items: ActivityItem[];
  addItem: (item: Omit<ActivityItem, 'openedAt'>) => void;
  clearAll: () => void;
  removeItem: (id: string) => void;
}

const MAX_ITEMS = 15;

const RecentActivityContext = createContext<RecentActivityContextValue | null>(null);

export function RecentActivityProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ActivityItem[]>([]);

  const addItem = useCallback((item: Omit<ActivityItem, 'openedAt'>) => {
    setItems((prev) => {
      const filtered = prev.filter((i) => !(i.id === item.id && i.type === item.type));
      const next: ActivityItem = { ...item, openedAt: Date.now() };
      return [next, ...filtered].slice(0, MAX_ITEMS);
    });
  }, []);

  const clearAll = useCallback(() => setItems([]), []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  return (
    <RecentActivityContext.Provider value={{ items, addItem, clearAll, removeItem }}>
      {children}
    </RecentActivityContext.Provider>
  );
}

export function useRecentActivity(): RecentActivityContextValue {
  const ctx = useContext(RecentActivityContext);
  if (!ctx) throw new Error('useRecentActivity must be used within a RecentActivityProvider');
  return ctx;
}