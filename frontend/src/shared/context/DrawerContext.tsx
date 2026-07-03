// ── Dashboard Drawer Context ────────────────────────────────────
//
// Provides a right-side drawer for showing vehicle/trip/driver details
// without navigating away from the dashboard.

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type DrawerView =
  | { type: 'vehicle'; vehicleId: string; plateNumber?: string }
  | { type: 'trip'; tripId: string; toNumber?: string }
  | { type: 'driver'; driverId: string; driverName?: string }
  | { type: 'travel-order'; orderId: string; toNumber?: string }
  | { type: 'alert'; alertId: string; vehicleId?: string }
  | null;

interface DrawerContextValue {
  isOpen: boolean;
  view: DrawerView;
  openDrawer: (view: NonNullable<DrawerView>) => void;
  closeDrawer: () => void;
}

const DrawerContext = createContext<DrawerContextValue | null>(null);

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<DrawerView>(null);

  const openDrawer = useCallback((v: NonNullable<DrawerView>) => {
    setView(v);
    setIsOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsOpen(false);
    // Delay clearing view for exit animation
    setTimeout(() => setView(null), 300);
  }, []);

  return (
    <DrawerContext.Provider value={{ isOpen, view, openDrawer, closeDrawer }}>
      {children}
    </DrawerContext.Provider>
  );
}

export function useDrawer(): DrawerContextValue {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error('useDrawer must be used within a DrawerProvider');
  return ctx;
}