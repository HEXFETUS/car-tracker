// ── Favorites Context ──────────────────────────────────────────
//
// Allows pinning vehicles, drivers, trips, and travel orders.

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type FavoriteItemType = 'vehicle' | 'driver' | 'trip' | 'travel-order';

export interface FavoriteItem {
  id: string;
  type: FavoriteItemType;
  label: string;
  subtitle?: string;
}

interface FavoritesContextValue {
  items: FavoriteItem[];
  isFavorite: (id: string, type: FavoriteItemType) => boolean;
  toggleFavorite: (item: FavoriteItem) => void;
  removeFavorite: (id: string, type: FavoriteItemType) => void;
}

const STORAGE_KEY = 'car-tracker-favorites';

function loadFavorites(): FavoriteItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(items: FavoriteItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<FavoriteItem[]>(loadFavorites);

  const isFavorite = useCallback(
    (id: string, type: FavoriteItemType) => items.some((f) => f.id === id && f.type === type),
    [items],
  );

  const toggleFavorite = useCallback((item: FavoriteItem) => {
    setItems((prev) => {
      const exists = prev.some((f) => f.id === item.id && f.type === item.type);
      const next = exists
        ? prev.filter((f) => !(f.id === item.id && f.type === item.type))
        : [item, ...prev];
      saveFavorites(next);
      return next;
    });
  }, []);

  const removeFavorite = useCallback((id: string, type: FavoriteItemType) => {
    setItems((prev) => {
      const next = prev.filter((f) => !(f.id === id && f.type === type));
      saveFavorites(next);
      return next;
    });
  }, []);

  return (
    <FavoritesContext.Provider value={{ items, isFavorite, toggleFavorite, removeFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites must be used within a FavoritesProvider');
  return ctx;
}