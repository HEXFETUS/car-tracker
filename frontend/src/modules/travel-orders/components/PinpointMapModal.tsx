import { useState, useEffect, useRef, useCallback } from 'react';
import { X, MapPin, LocateFixed } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface PinpointMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (lat: string, lng: string, address: string) => void;
  /** Initial search query to pre-fill */
  initialQuery?: string;
  /** Label for the type of location being set */
  locationLabel?: string;
  /** Initial latitude to place the marker (e.g. default origin coordinates) */
  initialLat?: string;
  /** Initial longitude to place the marker (e.g. default origin coordinates) */
  initialLng?: string;
}

// Fix Leaflet default marker icon issue with bundlers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const DEFAULT_CENTER: [number, number] = [8.5, 124.65]; // Misamis Oriental, Philippines

export function PinpointMapModal({
  isOpen,
  onClose,
  onConfirm,
  initialQuery = '',
  locationLabel = 'Location',
  initialLat,
  initialLng,
}: PinpointMapModalProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [address, setAddress] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingCoords, setIsLoadingCoords] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!isOpen || !mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: DEFAULT_CENTER,
      zoom: 10,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker(DEFAULT_CENTER, { draggable: true }).addTo(map);
    marker.bindTooltip('Drag me to the exact location', { permanent: false, direction: 'top' });

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      setLat(pos.lat.toFixed(6));
      setLng(pos.lng.toFixed(6));
      reverseGeocode(pos.lat, pos.lng);
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      setLat(e.latlng.lat.toFixed(6));
      setLng(e.latlng.lng.toFixed(6));
      reverseGeocode(e.latlng.lat, e.latlng.lng);
    });

    mapInstanceRef.current = map;
    markerRef.current = marker;

    // If initial coordinates are provided, place the marker there directly
    if (initialLat && initialLng) {
      const latNum = parseFloat(initialLat);
      const lngNum = parseFloat(initialLng);
      if (!isNaN(latNum) && !isNaN(lngNum)) {
        setLat(initialLat);
        setLng(initialLng);
        marker.setLatLng([latNum, lngNum]);
        map.setView([latNum, lngNum], 15);
        reverseGeocode(latNum, lngNum);
      }
    } else if (initialQuery) {
      // If we have an initial query but no coordinates, search for it
      setSearchQuery(initialQuery);
      searchLocation(initialQuery, map, marker);
    }

    // Force map to recalculate after opening
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
    };
    // We only want to initialize on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function reverseGeocode(latNum: number, lngNum: number) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latNum}&lon=${lngNum}&addressdetails=0`,
        { headers: { 'Accept-Language': 'en' } },
      );
      const data = await res.json();
      if (data.display_name) {
        setAddress(data.display_name);
      }
    } catch {
      // silent fail
    }
  }

  async function searchLocation(
    q: string,
    map?: L.Map,
    marker?: L.Marker,
  ) {
    if (!q.trim()) return;
    setIsSearching(true);
    try {
      const viewbox = '124.0,9.0,125.3,8.0';
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=0&viewbox=${viewbox}&bounded=1`,
        { headers: { 'Accept-Language': 'en' } },
      );
      const data: Array<{ lat: string; lon: string; display_name: string }> = await res.json();
      if (data.length > 0) {
        const result = data[0];
        const latNum = parseFloat(result.lat);
        const lngNum = parseFloat(result.lon);
        setLat(result.lat);
        setLng(result.lon);
        setAddress(result.display_name);

        const m = marker || markerRef.current;
        const mp = map || mapInstanceRef.current;
        if (m && mp) {
          m.setLatLng([latNum, lngNum]);
          mp.setView([latNum, lngNum], 15);
        }
      }
    } catch {
      // silent fail
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSearch() {
    await searchLocation(searchQuery);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  }

  const handleGetCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setIsLoadingCoords(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latNum = position.coords.latitude;
        const lngNum = position.coords.longitude;
        setLat(latNum.toFixed(6));
        setLng(lngNum.toFixed(6));

        const map = mapInstanceRef.current;
        const marker = markerRef.current;
        if (map && marker) {
          marker.setLatLng([latNum, lngNum]);
          map.setView([latNum, lngNum], 15);
        }
        reverseGeocode(latNum, lngNum);
        setIsLoadingCoords(false);
      },
      () => {
        setIsLoadingCoords(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  function handleConfirm() {
    if (lat && lng) {
      onConfirm(lat, lng, address || searchQuery);
    }
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4">
      <div className="relative flex max-h-dvh w-full max-w-3xl flex-col overflow-y-auto bg-white shadow-brand-xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-4 py-4 sm:items-center sm:px-6">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">Pinpoint {locationLabel}</h2>
            <p className="text-sm text-zinc-400">Drag the marker or click the map to set the exact location</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Search bar */}
        <div className="shrink-0 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            <div className="relative w-full flex-1 sm:w-auto">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search for a place..."
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 pl-10 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
              />
              <MapPin className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            </div>
            <button
              type="button"
              onClick={handleSearch}
              disabled={isSearching}
              className="min-h-11 flex-1 rounded-lg bg-brand-teal px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 disabled:opacity-50 sm:flex-none"
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
            <button
              type="button"
              onClick={handleGetCurrentLocation}
              disabled={isLoadingCoords}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sm font-medium text-zinc-600 ring-1 ring-brand-sage transition-colors hover:bg-brand-cream disabled:opacity-50"
              title="Use current location"
            >
              <LocateFixed className="size-4" />
            </button>
          </div>
        </div>

        {/* Map */}
        <div className="shrink-0 px-4 pb-3 sm:px-6">
          <div ref={mapRef} className="z-0 h-[42dvh] min-h-52 w-full rounded-lg border border-zinc-200 sm:h-[400px]" />
        </div>

        {/* Coordinates */}
        {(lat || lng) && (
          <div className="shrink-0 px-4 pb-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-brand-cream px-4 py-2.5 text-sm">
              <span className="font-medium text-zinc-700">
                Lat: <span className="text-brand-teal">{lat}</span>
              </span>
              <span className="font-medium text-zinc-700">
                Lng: <span className="text-brand-teal">{lng}</span>
              </span>
              {address && (
                <span className="w-full truncate text-zinc-500 sm:min-w-0 sm:flex-1 sm:text-right" title={address}>
                  {address}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-zinc-200 px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 flex-1 rounded-lg px-5 py-2.5 text-sm font-medium text-zinc-600 ring-1 ring-brand-sage transition-colors hover:bg-brand-cream sm:flex-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!lat || !lng}
            className="min-h-11 flex-[2] rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 disabled:opacity-50 sm:flex-none"
          >
            Confirm Location
          </button>
        </div>
      </div>
    </div>
  );
}
