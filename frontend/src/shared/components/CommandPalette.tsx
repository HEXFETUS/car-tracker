// ── Command Palette ────────────────────────────────────────────
//
// Ctrl+K / ⌘K opens the command palette.
// Commands: Create TO, Sync GPS Logs, Fleet Tracking, Travel Orders,
// Vehicles, Drivers, Maintenance, Reports

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Search, FileText, RefreshCw, Radio, Plane, Car, User, Wrench, BarChart3,
  LayoutDashboard, MapPin
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface Command {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  action: () => void;
  shortcut?: string;
}

interface CommandPaletteProps {
  /** If true, renders as a standalone modal. Otherwise, renders inline for embedding. */
  standalone?: boolean;
  /** External control for opening/closing */
  isOpen?: boolean;
  onClose?: () => void;
}

export function CommandPalette({ standalone = true, isOpen: externalOpen, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const isOpen = standalone ? internalOpen : (externalOpen ?? false);

  const commands: Command[] = useMemo(() => [
    {
      id: 'create-to',
      label: 'Create Travel Order',
      description: 'Open the travel order creation form',
      icon: FileText,
      action: () => navigate('/travel-orders?action=create'),
    },
    {
      id: 'sync-gps',
      label: 'Sync GPS Logs',
      description: 'Manually trigger GPS log synchronization',
      icon: RefreshCw,
      action: () => navigate('/gps-logs?tab=sync'),
    },
    {
      id: 'fleet-tracking',
      label: 'Fleet Tracking',
      description: 'Open live fleet tracking map',
      icon: Radio,
      action: () => navigate('/gps-logs?tab=tracking'),
    },
    {
      id: 'travel-orders',
      label: 'Travel Orders',
      description: 'View all travel orders',
      icon: Plane,
      action: () => navigate('/travel-orders'),
    },
    {
      id: 'vehicles',
      label: 'Vehicles',
      description: 'View and manage vehicles',
      icon: Car,
      action: () => navigate('/list?tab=vehicles'),
    },
    {
      id: 'drivers',
      label: 'Drivers',
      description: 'View and manage drivers',
      icon: User,
      action: () => navigate('/list?tab=drivers'),
    },
    {
      id: 'maintenance',
      label: 'Maintenance',
      description: 'View maintenance schedules and records',
      icon: Wrench,
      action: () => navigate('/list?tab=maintenance'),
    },
    {
      id: 'reports',
      label: 'Reports',
      description: 'Access operational reports and analytics',
      icon: BarChart3,
      action: () => navigate('/reports'),
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      description: 'Return to the Fleet Operations Command Center',
      icon: LayoutDashboard,
      action: () => navigate('/'),
    },
    {
      id: 'gps-logs',
      label: 'GPS Trip Logs',
      description: 'View completed GPS trip logs',
      icon: MapPin,
      action: () => navigate('/gps-logs'),
    },
  ], [navigate]);

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) => cmd.label.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q),
    );
  }, [query, commands]);

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  // Global keyboard shortcut
  useEffect(() => {
    if (!standalone) return;
    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        setInternalOpen(false);
        setQuery('');
        return;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [standalone]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        standalone ? setInternalOpen(false) : onClose?.();
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [isOpen, onClose, standalone]);

  function handleSelect(command: Command) {
    command.action();
    setInternalOpen(false);
    setQuery('');
    onClose?.();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filteredCommands[selectedIndex]) {
      handleSelect(filteredCommands[selectedIndex]);
    } else if (e.key === 'Escape') {
      setInternalOpen(false);
      setQuery('');
      onClose?.();
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Palette */}
      <div
        ref={wrapperRef}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-4">
          <Search className="size-5 shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-base text-zinc-900 outline-none placeholder:text-zinc-400"
            autoFocus
          />
          <kbd className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-400">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto px-2 py-2">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((command, idx) => (
              <button
                key={command.id}
                onClick={() => handleSelect(command)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors',
                  idx === selectedIndex ? 'bg-brand-teal text-white' : 'text-zinc-700 hover:bg-zinc-50',
                )}
              >
                <span className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg',
                  idx === selectedIndex ? 'bg-white/20' : 'bg-zinc-100',
                )}>
                  <command.icon className={cn('size-5', idx === selectedIndex ? 'text-white' : 'text-brand-teal')} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('text-sm font-semibold', idx === selectedIndex ? 'text-white' : 'text-zinc-900')}>
                    {command.label}
                  </span>
                  <span className={cn('mt-0.5 block text-xs', idx === selectedIndex ? 'text-white/80' : 'text-zinc-500')}>
                    {command.description}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="px-3 py-8 text-center text-sm text-zinc-500">
              No commands found for "{query}"
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 border-t border-zinc-100 px-5 py-2.5 text-[11px] text-zinc-400">
          <span><kbd className="rounded bg-zinc-100 px-1 py-0.5 font-mono">↑↓</kbd> Navigate</span>
          <span><kbd className="rounded bg-zinc-100 px-1 py-0.5 font-mono">↵</kbd> Run command</span>
          <span><kbd className="rounded bg-zinc-100 px-1 py-0.5 font-mono">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to trigger the command palette programmatically.
 * Usage: const { open } = useCommandPalette();
 */
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);

  const paletteElement = isOpen ? (
    <CommandPalette standalone={false} isOpen={isOpen} onClose={close} />
  ) : null;

  return { open, close, isOpen, paletteElement };
}