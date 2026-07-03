// ── Global Search ──────────────────────────────────────────────
//
// Top navigation search that searches vehicles, drivers, GPS numbers,
// travel orders, destinations.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search, Car, User, MapPin, Navigation, FileText, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useDrawer } from '@/shared/context/DrawerContext';

interface SearchResult {
  id: string;
  type: 'vehicle' | 'driver' | 'gps' | 'travel-order' | 'destination';
  label: string;
  subtitle: string;
}

// Mock search data — in real app, fetch from API
const MOCK_RESULTS: SearchResult[] = [
  { id: 'v-1', type: 'vehicle', label: 'ABC-1234', subtitle: 'Toyota HiAce · Juan Dela Cruz' },
  { id: 'v-2', type: 'vehicle', label: 'XYZ-5678', subtitle: 'Nissan Urvan · Maria Santos' },
  { id: 'v-3', type: 'vehicle', label: 'DEF-9012', subtitle: 'Isuzu Elf · Pedro Reyes' },
  { id: 'd-1', type: 'driver', label: 'Juan Dela Cruz', subtitle: 'ABC-1234 · Toyota HiAce' },
  { id: 'd-2', type: 'driver', label: 'Maria Santos', subtitle: 'XYZ-5678 · Nissan Urvan' },
  { id: 'd-3', type: 'driver', label: 'Pedro Reyes', subtitle: 'DEF-9012 · Isuzu Elf' },
  { id: 'g-1', type: 'gps', label: 'GPS-2026-001', subtitle: 'ABC-1234 · Iligan → CDO' },
  { id: 'g-2', type: 'gps', label: 'GPS-2026-002', subtitle: 'XYZ-5678 · CDO → Iligan' },
  { id: 'to-1', type: 'travel-order', label: 'TO-2026-001', subtitle: 'ABC-1234 · Iligan → CDO' },
  { id: 'to-2', type: 'travel-order', label: 'TO-2026-002', subtitle: 'XYZ-5678 · CDO → Iligan' },
  { id: 'dst-1', type: 'destination', label: 'Cagayan de Oro City', subtitle: '2 active trips' },
  { id: 'dst-2', type: 'destination', label: 'Iligan City', subtitle: '3 active trips' },
  { id: 'dst-3', type: 'destination', label: 'Bukidnon', subtitle: '1 active trip' },
];

const TYPE_CONFIG = {
  vehicle: { icon: Car, color: 'text-brand-teal', bg: 'bg-brand-teal/10' },
  driver: { icon: User, color: 'text-amber-600', bg: 'bg-amber-50' },
  gps: { icon: MapPin, color: 'text-blue-600', bg: 'bg-blue-50' },
  'travel-order': { icon: Navigation, color: 'text-purple-600', bg: 'bg-purple-50' },
  destination: { icon: FileText, color: 'text-brand-sage', bg: 'bg-brand-sage/10' },
};

const TYPE_LABELS: Record<string, string> = {
  vehicle: 'Vehicle',
  driver: 'Driver',
  gps: 'GPS Number',
  'travel-order': 'Travel Order',
  destination: 'Destination',
};

function useDebouncedValue<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const { openDrawer } = useDrawer();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debouncedQuery = useDebouncedValue(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!debouncedQuery.trim()) return MOCK_RESULTS.slice(0, 5);
    const q = debouncedQuery.toLowerCase();
    return MOCK_RESULTS.filter(
      (r) => r.label.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q),
    ).slice(0, 10);
  }, [debouncedQuery]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [isOpen]);

  // Global keyboard shortcut: "/" opens search (but not when typing in an input)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setIsOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  function handleSelect(result: SearchResult) {
    setIsOpen(false);
    setQuery('');

    switch (result.type) {
      case 'vehicle':
        openDrawer({ type: 'vehicle', vehicleId: result.id, plateNumber: result.label });
        break;
      case 'driver':
        openDrawer({ type: 'driver', driverId: result.id, driverName: result.label });
        break;
      case 'travel-order':
        openDrawer({ type: 'travel-order', orderId: result.id, toNumber: result.label });
        break;
      case 'gps':
        navigate(`/gps-logs?search=${result.label}`);
        break;
      case 'destination':
        navigate(`/gps-logs?destination=${result.label}`);
        break;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleSelect(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={wrapperRef} className="relative w-full max-w-md">
      {/* Search trigger button (closed state) */}
      <button
        onClick={() => { setIsOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="flex w-full items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-400 transition hover:border-brand-teal/40 hover:bg-white"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search vehicles, drivers, GPS...</span>
        <kbd className="hidden rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-zinc-400 sm:inline">
          /
        </kbd>
      </button>

      {/* Expanded search overlay */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl bg-white shadow-brand-lg ring-1 ring-zinc-100">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
            <Search className="size-4 shrink-0 text-zinc-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search vehicles, drivers, GPS numbers, travel orders..."
              className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
              autoFocus
            />
            {query && (
              <button onClick={() => setQuery('')} className="rounded p-1 text-zinc-400 hover:text-zinc-600">
                <X className="size-4" />
              </button>
            )}
            <kbd className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-400">ESC</kbd>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {results.length > 0 ? (
              results.map((result, idx) => {
                const config = TYPE_CONFIG[result.type];
                const Icon = config.icon;
                return (
                  <button
                    key={result.id}
                    onClick={() => handleSelect(result)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                      idx === selectedIndex ? 'bg-brand-cream/70' : 'hover:bg-zinc-50',
                    )}
                  >
                    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', config.bg)}>
                      <Icon className={cn('size-4', config.color)} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-900">{result.label}</span>
                        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                          {TYPE_LABELS[result.type]}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-zinc-500">{result.subtitle}</span>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">
                No results found for "{query}"
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-400">
            <span><kbd className="rounded bg-zinc-100 px-1 py-0.5 font-mono">↑↓</kbd> Navigate</span>
            <span><kbd className="rounded bg-zinc-100 px-1 py-0.5 font-mono">↵</kbd> Open</span>
            <span><kbd className="rounded bg-zinc-100 px-1 py-0.5 font-mono">Esc</kbd> Close</span>
          </div>
        </div>
      )}
    </div>
  );
}