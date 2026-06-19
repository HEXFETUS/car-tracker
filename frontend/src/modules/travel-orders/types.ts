export interface TravelOrder {
  toNumber: string;
  dateIssued: string;
  department: string;
  travelerName: string;
  departureDateTime: string;
  returnDateTime: string;
  boundFrom: string;
  boundTo: string;
  purpose: string;
  requestVehicle: boolean;
  requestDriver: boolean;
  remarks?: string;
  imageAttachment: string | null;
  status: 'pending' | 'for_approval' | 'approved' | 'rejected';
  /** Lat/Lng for origin (lat,lng format) */
  latLongOrigin?: string | null;
  /** Lat/Lng for destination (lat,lng format) */
  latLongDestination?: string | null;
}