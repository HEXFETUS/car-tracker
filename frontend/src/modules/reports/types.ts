/** A single reconciliation row comparing Travel Order vs GPS actuals */
export interface ReconciliationRecord {
  id: string;
  toNo: string;
  gpsRecordNo: string;
  vehiclePlate: string;
  tripDate: string;
  origin: string;
  destination: string;
  /** GPS actual endpoint from gps_trip_logs.destination_gps_end_point */
  gpsActualDestination?: string | null;
  /** GPS-based departure time from gps_trip_logs.departure_time_gps */
  departureTime?: string | null;
  toEstMileageKm: number;
  gpsActualMileageKm: number;
  /** Derived: gpsActualMileageKm - toEstMileageKm */
  varianceKm: number;
  /** Derived: (|varianceKm| / toEstMileageKm) * 100 */
  variancePct: number;
  /** Derived match status */
  status: 'Matched' | 'Flagged' | 'NO GPS RECORD' | 'MISSING TO DISTANCE';
  explanationRemarks: string;
  /** Travel order status: APPROVED, ACTIVE, COMPLETED, etc. */
  toStatus?: string;
  /** GPS-based arrival time (when vehicle was within 200m of destination) */
  arrivalTime?: string | null;
}

/** Monthly KPI indicators */
export interface MonthlyKpi {
  totalApprovedTOs: number;
  totalGpsTripsRecorded: number;
  totalGpsDistanceKm: number;
  tripsWithLinkedTO: number;
  unauthorizedTripsFlagged: number;
  varianceExceedances: number;
  toApprovalRatePct: number;
  averageGpsTripDistanceKm: number;
}

/** Per-vehicle summary row for the monthly report */
export interface VehicleMonthlySummary {
  vehiclePlateNo: string;
  totalGpsTrips: number;
  totalGpsDistanceKm: number;
  totalApprovedTOs: number;
  unauthorizedTrips: number;
  linkedTrips: number;
  remarks: string;
}

/** Monthly aggregated data point for yearly trend view */
export interface MonthlyAggregate {
  month: string; // "Jan", "Feb", etc.
  totalDistanceKm: number;
  totalTrips: number;
  totalApprovedTOs: number;
  varianceIssuesFlagged: number;
  totalVarianceKm: number;
}

/** Yearly macro KPI indicators */
export interface YearlyKpi {
  totalAnnualDistanceKm: number;
  totalAnnualTrips: number;
  totalApprovedTOs: number;
  unauthorizedTripsYear: number;
  varianceIssuesFlaggedYear: number;
  avgMonthlyDistanceKm: number;
  toApprovalRateYearPct: number;
}

/** A single month in the yearly report */
export interface YearlyMonth {
  month: number;
  monthLabel: string;
  totalGpsTrips: number;
  totalGpsDistanceKm: number;
  totalApprovedTOs: number;
  unauthorizedTrips: number;
  varianceIssues: number;
  approvalRate: number;
  avgTripDistanceKm: number;
  vsPreviousPercent: number | null;
}

/** Summary returned alongside 12 monthly rows */
export interface YearlySummary {
  annualDistanceKm: number;
  annualTrips: number;
  approvedTOs: number;
  unauthorizedTrips: number;
  varianceIssues: number;
  avgMonthlyDistanceKm: number;
  avgTripsPerMonth: number;
  avgTOsPerMonth: number;
  approvalRate: number;
}

export interface YearlyReportResponse {
  year: number;
  months: YearlyMonth[];
  summary: YearlySummary;
}
