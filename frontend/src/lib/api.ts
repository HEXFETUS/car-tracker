import axios from 'axios';
import type { ApiResponse } from '@car-tracker/shared';

const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export async function fetchCars<T>(): Promise<ApiResponse<T>> {
  const response = await apiClient.get<ApiResponse<T>>('/cars');
  return response.data;
}

export async function fetchCarById<T>(id: string): Promise<ApiResponse<T>> {
  const response = await apiClient.get<ApiResponse<T>>(`/cars/${id}`);
  return response.data;
}

export default apiClient;