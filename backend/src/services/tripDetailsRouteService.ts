export type TripRoutePoint = {
  lat: number;
  lng: number;
  timestamp: string | Date;
  locationName: string | null;
};

export type ActualTripEndpoints = {
  originAddress: string | null;
  originCoordinates: string | null;
  startTime: string | null;
  endAddress: string | null;
  endCoordinates: string | null;
  endTime: string | null;
  returnedToBaseAt: string | null;
  matchedOriginDistanceM: number | null;
};

function parseCoordinates(value: string | null | undefined): [number, number] | null {
  if (!value) return null;
  const [lat, lng] = value.split(',').map((part) => Number(part.trim()));
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

function distanceMeters(first: [number, number], second: [number, number]): number {
  const radiusM = 6_371_000;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRadians(second[0] - first[0]);
  const dLng = toRadians(second[1] - first[1]);
  const lat1 = toRadians(first[0]);
  const lat2 = toRadians(second[0]);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function timestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function deriveActualTripEndpoints(
  route: TripRoutePoint[],
  plannedOriginCoordinates: string | null | undefined,
  tripStatus: string | null | undefined,
  baseRadiusM = Number(process.env.BUSINESS_TRIP_BASE_RADIUS_METERS ?? 300),
): ActualTripEndpoints {
  const first = route[0] ?? null;
  const last = route[route.length - 1] ?? null;
  if (!first || !last) {
    return {
      originAddress: null,
      originCoordinates: null,
      startTime: null,
      endAddress: null,
      endCoordinates: null,
      endTime: null,
      returnedToBaseAt: null,
      matchedOriginDistanceM: null,
    };
  }

  const plannedOrigin = parseCoordinates(plannedOriginCoordinates);
  const endCoordinate: [number, number] = [last.lat, last.lng];
  const matchedOriginDistanceM = plannedOrigin ? distanceMeters(plannedOrigin, endCoordinate) : null;
  const completed = String(tripStatus ?? '').toLowerCase() === 'completed';
  const returnedToBase = completed
    && matchedOriginDistanceM != null
    && matchedOriginDistanceM <= baseRadiusM;

  return {
    originAddress: first.locationName,
    originCoordinates: `${first.lat},${first.lng}`,
    startTime: timestampString(first.timestamp),
    endAddress: last.locationName,
    endCoordinates: `${last.lat},${last.lng}`,
    endTime: timestampString(last.timestamp),
    returnedToBaseAt: returnedToBase ? timestampString(last.timestamp) : null,
    matchedOriginDistanceM,
  };
}
