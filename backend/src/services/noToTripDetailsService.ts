export type NoToRoutePoint = {
  lat: number;
  lng: number;
  timestamp: string | Date | null;
  speed?: number | null;
  locationName?: string | null;
};

type NoToSession = {
  startTime: string | Date | null;
  endTime: string | Date | null;
};

const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function distanceMeters(a: NoToRoutePoint, b: NoToRoutePoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function coordinate(point: NoToRoutePoint | null): string | null {
  return point ? `${point.lat},${point.lng}` : null;
}

export function anchorNoToRouteAtOrigin(
  route: NoToRoutePoint[],
  originCoordinates: string | null | undefined,
  originAddress: string | null | undefined,
  startTime: string | Date | null | undefined,
): NoToRoutePoint[] {
  const match = String(originCoordinates ?? '').trim().match(
    /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/,
  );
  if (!match) return route;

  const anchor: NoToRoutePoint = {
    lat: Number(match[1]),
    lng: Number(match[2]),
    timestamp: startTime ?? null,
    speed: 0,
    locationName: originAddress ?? null,
  };
  const first = route[0];
  if (first && distanceMeters(anchor, first) <= 1) return route;
  return [anchor, ...route];
}

export function deriveNoToTripDetails(
  route: NoToRoutePoint[],
  sessions: NoToSession[],
  businessTripStatus: string | null | undefined,
) {
  const first = route[0] ?? null;
  const last = route[route.length - 1] ?? null;
  let farthest = first;
  let farthestDistanceM = 0;
  let distanceM = 0;
  let movingMs = 0;
  let maxSpeed = 0;

  for (let index = 0; index < route.length; index += 1) {
    const point = route[index];
    maxSpeed = Math.max(maxSpeed, Number(point.speed) || 0);
    if (!first || index === 0) continue;

    const previous = route[index - 1];
    const segmentDistanceM = distanceMeters(previous, point);
    if (Number.isFinite(segmentDistanceM)) distanceM += segmentDistanceM;

    const fromOriginM = distanceMeters(first, point);
    if (Number.isFinite(fromOriginM) && fromOriginM > farthestDistanceM) {
      farthestDistanceM = fromOriginM;
      farthest = point;
    }

    const previousMs = new Date(previous.timestamp ?? '').getTime();
    const currentMs = new Date(point.timestamp ?? '').getTime();
    const deltaMs = currentMs - previousMs;
    if (
      Number.isFinite(deltaMs)
      && deltaMs > 0
      && deltaMs <= 10 * 60 * 1000
      && ((Number(previous.speed) || 0) > 0 || (Number(point.speed) || 0) > 0)
    ) {
      movingMs += deltaMs;
    }
  }

  let engineMs = 0;
  for (const session of sessions) {
    const startMs = new Date(session.startTime ?? '').getTime();
    const endMs = new Date(session.endTime ?? '').getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      engineMs += endMs - startMs;
    }
  }
  if (engineMs === 0 && first && last) {
    const startMs = new Date(first.timestamp ?? '').getTime();
    const endMs = new Date(last.timestamp ?? '').getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      engineMs = endMs - startMs;
    }
  }

  const completed = String(businessTripStatus ?? '').toUpperCase() === 'COMPLETED';
  return {
    completed,
    status: completed ? 'completed' : 'ongoing',
    originAddress: first?.locationName ?? null,
    originCoordinates: coordinate(first),
    startTime: iso(first?.timestamp),
    arrivalAddress: farthest?.locationName ?? null,
    arrivalCoordinates: coordinate(farthest),
    arrivalTime: iso(farthest?.timestamp),
    endAddress: completed ? last?.locationName ?? null : null,
    endCoordinates: completed ? coordinate(last) : null,
    endTime: completed ? iso(last?.timestamp) : null,
    distanceKm: route.length > 1 ? Number((distanceM / 1000).toFixed(2)) : null,
    engineHours: route.length > 0 ? Number((engineMs / 3_600_000).toFixed(2)) : null,
    movingHours: route.length > 0 ? Number((movingMs / 3_600_000).toFixed(2)) : null,
    maxSpeed: route.length > 0 ? Number(maxSpeed.toFixed(2)) : null,
  };
}
