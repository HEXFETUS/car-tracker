import { API_BASE } from '@/shared/api';
import { apiFetch } from '@/shared/api-client';
import type { ReconciliationRecord, VehicleMonthlySummary, YearlyReportResponse } from '../types';

export interface ReconciliationFilters {
  vehiclePlate?: string;
  tripDate?: string;
  toNumber?: string;
  status?: ReconciliationRecord['status'] | '';
}

export async function fetchReconciliation(
  filters: ReconciliationFilters = {},
): Promise<ReconciliationRecord[]> {
  const params = new URLSearchParams();
  if (filters.vehiclePlate) params.set('vehiclePlate', filters.vehiclePlate);
  if (filters.tripDate) params.set('tripDate', filters.tripDate);
  if (filters.toNumber) params.set('toNumber', filters.toNumber);
  if (filters.status) params.set('status', filters.status);

  const qs = params.toString();
  const res = await apiFetch(`${API_BASE}/api/reports/reconciliation${qs ? `?${qs}` : ''}`);
  const body: { success: boolean; data: ReconciliationRecord[]; error?: string } = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch reconciliation data');
  return body.data;
}

export interface MonthlyReportParams {
  month: number;
  year: number;
}

export async function fetchMonthlyReport({ month, year }: MonthlyReportParams): Promise<VehicleMonthlySummary[]> {
  const res = await apiFetch(`${API_BASE}/api/reports/monthly?month=${month}&year=${year}`);
  const body: { success: boolean; data: VehicleMonthlySummary[]; error?: string } = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch monthly report data');
  return body.data;
}

export interface YearlyReportParams {
  year: number;
}

export async function fetchYearlyReport({ year }: YearlyReportParams): Promise<YearlyReportResponse> {
  const res = await apiFetch(`${API_BASE}/api/reports/yearly?year=${year}`);
  const body: { success: boolean; data: YearlyReportResponse; error?: string } = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch yearly report data');
  return body.data;
}
