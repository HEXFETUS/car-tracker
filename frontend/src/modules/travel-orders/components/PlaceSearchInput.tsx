import { useState, useRef, useEffect, useCallback } from 'react';
import { MapPin, Loader2, Search } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

/** A single suggestion from the Nominatim API. */
interface Suggestion {
  display_name: string;
  lat: string;
  lon: string;
}

interface PlaceSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelectLocation: (placeName: string, lat: string, lng: string) => void;
  placeholder?: string;
  error?: string;
  /** Label for the "Show on Map" footer button */
  mapLabel?: string;
  /** Called when user clicks "Show on Map" */
  onShowOnMap?: () => void;
  disabled?: boolean;
  /** When true, hides the "Show on Map" footer option (e.g. after pinpointing via map) */
  hideShowOnMap?: boolean;
}

export function PlaceSearchInput({
  value,
  onChange,
  onSelectLocation,
  placeholder = 'Search location...',
  error,
  mapLabel = 'Show on Map',
  onShowOnMap,
  disabled,
  hideShowOnMap,
}: PlaceSearchInputProps) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [noResults, setNoResults] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listRef = useRef<HTMLUListElement>(null);

  // Sync external value changes
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Fetch suggestions from Nominatim
  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.trim().length < 3) {
      setSuggestions([]);
      setIsOpen(false);
      setNoResults(false);
      return;
    }

    setLoading(true);
    setNoResults(false);
    try {
      // Bounding box for Misamis Oriental / Northern Mindanao, Philippines
      const viewbox = '124.0,9.0,125.3,8.0';
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=0&viewbox=${viewbox}&bounded=1`,
        {
          headers: {
            'Accept-Language': 'en',
          },
        },
      );
      const data: Suggestion[] = await res.json();
      setSuggestions(data);
      setIsOpen(data.length > 0);
      setNoResults(data.length === 0);
      setSelectedIndex(-1);
    } catch {
      setSuggestions([]);
      setIsOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    onChange(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 400);
  }

  function handleSelect(suggestion: Suggestion) {
    const placeName = suggestion.display_name;
    setQuery(placeName);
    onChange(placeName);
    onSelectLocation(placeName, suggestion.lat, suggestion.lon);
    setIsOpen(false);
    setSuggestions([]);
    setNoResults(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = prev < suggestions.length - 1 ? prev + 1 : 0;
        scrollToItem(next);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = prev > 0 ? prev - 1 : suggestions.length - 1;
        scrollToItem(next);
        return next;
      });
    } else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < suggestions.length) {
      e.preventDefault();
      handleSelect(suggestions[selectedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }

  function scrollToItem(index: number) {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[index] as HTMLElement;
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'w-full rounded-lg border px-3.5 py-2.5 pl-10 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow',
            error ? 'border-red-300 bg-red-50' : 'border-0 ring-1 ring-brand-sage hover:ring-brand-teal',
          )}
        />
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400 pointer-events-none" />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-brand-teal animate-spin" />
        )}
      </div>

      {/* Dropdown */}
      {isOpen && suggestions.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-lg max-h-60 overflow-y-auto"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.lat}-${suggestion.lon}-${index}`}
              onClick={() => handleSelect(suggestion)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                'flex cursor-pointer items-start gap-2 px-3.5 py-2.5 text-sm transition-colors',
                index === selectedIndex ? 'bg-brand-cream text-zinc-900' : 'text-zinc-700 hover:bg-zinc-50',
              )}
            >
              <MapPin className="mt-0.5 size-4 shrink-0 text-zinc-400" />
              <span className="line-clamp-2">{suggestion.display_name}</span>
            </li>
          ))}
        </ul>
      )}

      {/* No results message */}
      {noResults && query.trim().length >= 3 && !loading && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-lg">
          <p className="px-3.5 py-3 text-sm text-zinc-500">No results found</p>
        </div>
      )}

      {/* Show on Map footer — hidden after user pinpointed via map */}
      {!hideShowOnMap && noResults && onShowOnMap && query.trim().length >= 3 && !loading && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-lg">
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onShowOnMap();
            }}
            className="flex w-full items-center gap-2 rounded-b-lg border-t border-zinc-100 px-3.5 py-2.5 text-sm font-medium text-brand-teal hover:bg-brand-cream transition-colors"
          >
            <MapPin className="size-4" />
            {mapLabel}
          </button>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
