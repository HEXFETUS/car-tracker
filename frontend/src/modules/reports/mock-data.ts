import type {
  ReconciliationRecord,
  MonthlyKpi,
  VehicleMonthlySummary,
  MonthlyAggregate,
  YearlyKpi,
} from './types';

/** ------------------------
 *  Reconciliation mock rows
 *  ------------------------
 *  Helper: compute variance & status on construction
 */
function makeRec(
  overrides: Omit<Partial<ReconciliationRecord>, 'varianceKm' | 'variancePct' | 'status'> & {
    toEstMileageKm: number;
    gpsActualMileageKm: number;
  }
): ReconciliationRecord {
  const varianceKm = parseFloat((overrides.toEstMileageKm - overrides.gpsActualMileageKm).toFixed(1));
  const variancePct =
    overrides.toEstMileageKm > 0
      ? parseFloat(((Math.abs(varianceKm) / overrides.toEstMileageKm) * 100).toFixed(1))
      : 0;
  const status: 'Matched' | 'Flagged' = variancePct > 20 ? 'Flagged' : 'Matched';
  return {
    id: overrides.id ?? '',
    toNo: overrides.toNo ?? '',
    gpsRecordNo: overrides.gpsRecordNo ?? '',
    vehiclePlate: overrides.vehiclePlate ?? '',
    tripDate: overrides.tripDate ?? '',
    origin: overrides.origin ?? '',
    destination: overrides.destination ?? '',
    toEstMileageKm: overrides.toEstMileageKm,
    gpsActualMileageKm: overrides.gpsActualMileageKm,
    varianceKm,
    variancePct,
    status,
    explanationRemarks: overrides.explanationRemarks ?? '',
  };
}

export const MOCK_RECONCILIATION: ReconciliationRecord[] = [
  makeRec({
    id: 'r1',
    toNo: 'TO-2026-001',
    gpsRecordNo: 'GPS-04521',
    vehiclePlate: 'ABC-1234',
    tripDate: '2026-06-01',
    origin: 'Makati City',
    destination: 'Laguna Technopark',
    toEstMileageKm: 45.0,
    gpsActualMileageKm: 46.5,
    explanationRemarks: 'Slight detour due to road construction',
  }),
  makeRec({
    id: 'r2',
    toNo: 'TO-2026-002',
    gpsRecordNo: 'GPS-04534',
    vehiclePlate: 'XYZ-5678',
    tripDate: '2026-06-02',
    origin: 'Quezon City',
    destination: 'Clark Freeport',
    toEstMileageKm: 92.0,
    gpsActualMileageKm: 95.2,
    explanationRemarks: '',
  }),
  makeRec({
    id: 'r3',
    toNo: 'TO-2026-003',
    gpsRecordNo: 'GPS-04550',
    vehiclePlate: 'DEF-9012',
    tripDate: '2026-06-03',
    origin: 'Pasay City',
    destination: 'Batangas Port',
    toEstMileageKm: 120.0,
    gpsActualMileageKm: 110.3,
    explanationRemarks: '',
  }),
  makeRec({
    id: 'r4',
    toNo: 'TO-2026-004',
    gpsRecordNo: 'GPS-04567',
    vehiclePlate: 'ABC-1234',
    tripDate: '2026-06-04',
    origin: 'Makati City',
    destination: 'Alabang',
    toEstMileageKm: 18.0,
    gpsActualMileageKm: 25.4,
    explanationRemarks: 'Driver took alternate route — unauthorized detour',
  }),
  makeRec({
    id: 'r5',
    toNo: 'TO-2026-005',
    gpsRecordNo: 'GPS-04581',
    vehiclePlate: 'GHI-3456',
    tripDate: '2026-06-05',
    origin: 'Taguig City',
    destination: 'Nuvali, Sta. Rosa',
    toEstMileageKm: 55.0,
    gpsActualMileageKm: 54.8,
    explanationRemarks: 'Within tolerance',
  }),
  makeRec({
    id: 'r6',
    toNo: 'TO-2026-006',
    gpsRecordNo: 'GPS-04599',
    vehiclePlate: 'JKL-7890',
    tripDate: '2026-06-06',
    origin: 'Manila',
    destination: 'Subic Bay',
    toEstMileageKm: 140.0,
    gpsActualMileageKm: 142.0,
    explanationRemarks: '',
  }),
  makeRec({
    id: 'r7',
    toNo: 'TO-2026-007',
    gpsRecordNo: 'GPS-04612',
    vehiclePlate: 'XYZ-5678',
    tripDate: '2026-06-07',
    origin: 'Quezon City',
    destination: 'Tagaytay',
    toEstMileageKm: 75.0,
    gpsActualMileageKm: 98.1,
    explanationRemarks: 'Driver went around Taal area before returning',
  }),
  makeRec({
    id: 'r8',
    toNo: 'TO-2026-008',
    gpsRecordNo: 'GPS-04628',
    vehiclePlate: 'MNO-2345',
    tripDate: '2026-06-08',
    origin: 'Mandaluyong',
    destination: 'Cavite City',
    toEstMileageKm: 38.0,
    gpsActualMileageKm: 37.5,
    explanationRemarks: '',
  }),
];

/** ------------------------
 *  Monthly KPI for June 2026
 *  ------------------------ */
export const MOCK_MONTHLY_KPI: MonthlyKpi = {
  totalApprovedTOs: 8,
  totalGpsTripsRecorded: 42,
  totalGpsDistanceKm: 2450.8,
  tripsWithLinkedTO: 8,
  unauthorizedTripsFlagged: 3,
  varianceExceedances: 2,
  toApprovalRatePct: 95.2,
  averageGpsTripDistanceKm: 58.4,
};

/** ------------------------
 *  Per-vehicle summary (June 2026)
 *  ------------------------ */
export const MOCK_VEHICLE_SUMMARIES: VehicleMonthlySummary[] = [
  { vehiclePlateNo: 'ABC-1234', totalGpsTrips: 8, totalGpsDistanceKm: 520.3, totalApprovedTOs: 2, unauthorizedTrips: 1, remarks: 'One unauthorized detour flagged' },
  { vehiclePlateNo: 'XYZ-5678', totalGpsTrips: 6, totalGpsDistanceKm: 430.1, totalApprovedTOs: 2, unauthorizedTrips: 0, remarks: '' },
  { vehiclePlateNo: 'DEF-9012', totalGpsTrips: 5, totalGpsDistanceKm: 298.7, totalApprovedTOs: 1, unauthorizedTrips: 1, remarks: 'Odometer discrepancy noted' },
  { vehiclePlateNo: 'GHI-3456', totalGpsTrips: 7, totalGpsDistanceKm: 385.0, totalApprovedTOs: 1, unauthorizedTrips: 0, remarks: '' },
  { vehiclePlateNo: 'JKL-7890', totalGpsTrips: 4, totalGpsDistanceKm: 412.5, totalApprovedTOs: 1, unauthorizedTrips: 0, remarks: '' },
  { vehiclePlateNo: 'MNO-2345', totalGpsTrips: 5, totalGpsDistanceKm: 210.2, totalApprovedTOs: 1, unauthorizedTrips: 1, remarks: 'Excessive idling detected' },
  { vehiclePlateNo: 'PQR-6789', totalGpsTrips: 7, totalGpsDistanceKm: 194.0, totalApprovedTOs: 0, unauthorizedTrips: 0, remarks: 'Pool vehicle — no TO required' },
];

/** ------------------------
 *  Yearly monthly aggregates (Jan – Jun 2026)
 *  ------------------------ */
export const MOCK_MONTHLY_AGGREGATES: MonthlyAggregate[] = [
  { month: 'Jan', totalDistanceKm: 2100, totalTrips: 34, totalApprovedTOs: 6, varianceIssuesFlagged: 1, totalVarianceKm: 24.5 },
  { month: 'Feb', totalDistanceKm: 1950, totalTrips: 31, totalApprovedTOs: 5, varianceIssuesFlagged: 0, totalVarianceKm: 12.1 },
  { month: 'Mar', totalDistanceKm: 2350, totalTrips: 38, totalApprovedTOs: 7, varianceIssuesFlagged: 2, totalVarianceKm: 48.8 },
  { month: 'Apr', totalDistanceKm: 2210, totalTrips: 36, totalApprovedTOs: 6, varianceIssuesFlagged: 1, totalVarianceKm: 18.3 },
  { month: 'May', totalDistanceKm: 2480, totalTrips: 40, totalApprovedTOs: 8, varianceIssuesFlagged: 2, totalVarianceKm: 52.0 },
  { month: 'Jun', totalDistanceKm: 2451, totalTrips: 42, totalApprovedTOs: 8, varianceIssuesFlagged: 2, totalVarianceKm: 46.7 },
];

/** ------------------------
 *  Yearly KPI (H1 2026)
 *  ------------------------ */
export const MOCK_YEARLY_KPI: YearlyKpi = {
  totalAnnualDistanceKm: 13541,
  totalAnnualTrips: 221,
  totalApprovedTOs: 40,
  unauthorizedTripsYear: 18,
  varianceIssuesFlaggedYear: 8,
  avgMonthlyDistanceKm: 2257,
  toApprovalRateYearPct: 91.4,
};