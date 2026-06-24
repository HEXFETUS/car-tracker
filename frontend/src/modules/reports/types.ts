/** A single reconciliation row comparing Travel Order vs GPS actuals */
export interface ReconciliationRecord {
  id: string;
  toNo: string;
  gpsRecordNo: string;
  vehiclePlate: string;
  tripDate: string;
  origin: string;
  destination: string;
  toEstMileageKm: number;
  gpsActualMileageKm: number;
  /** Derived: toEstMileageKm - gpsActualMileageKm */
  varianceKm: number;
  /** Derived: (varianceKm / toEstMileageKm) * 100 */
  variancePct: number;
  /** Derived: 'Matched' if |variancePct| <= 20, else 'Flagged' */
  status: 'Matched' | 'Flagged';
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