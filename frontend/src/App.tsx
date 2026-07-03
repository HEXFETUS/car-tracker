import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/modules/auth/context/auth-context';
import { ProtectedRoute, PublicRoute } from '@/modules/auth/components/ProtectedRoute';
import { NotificationProvider } from '@/shared/context/NotificationContext';
import { DrawerProvider } from '@/shared/context/DrawerContext';
import { RecentActivityProvider } from '@/shared/context/RecentActivityContext';
import { FavoritesProvider } from '@/shared/context/FavoritesContext';
import { ConfirmationModal } from '@/shared/components/ConfirmationModal';
import { ToastContainer } from '@/shared/components/ToastContainer';
import { AppLayout } from '@/shared/components/AppLayout';

const LoginPage = lazy(() => import('@/modules/auth/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import('@/modules/dashboard/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ListPage = lazy(() => import('@/modules/list/pages/ListPage').then(m => ({ default: m.ListPage })));
const ReportsPage = lazy(() => import('@/modules/reports/pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const TravelOrdersPage = lazy(() => import('@/modules/travel-orders/pages/TravelOrdersPage').then(m => ({ default: m.TravelOrdersPage })));
const GpsLogsPage = lazy(() => import('@/modules/gps-logs/pages/GpsLogsPage').then(m => ({ default: m.GpsLogsPage })));
const SettingsPage = lazy(() => import('@/modules/settings/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const RequestsPage = lazy(() => import('@/modules/requests/pages/RequestsPage').then(m => ({ default: m.RequestsPage })));
const RequestTravelOrderPage = lazy(() => import('@/modules/user-to/pages/RequestTravelOrderPage').then(m => ({ default: m.RequestTravelOrderPage })));

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-muted-foreground">Loading...</div>}>
      <Routes>
      {/* Public: user-to request page — no auth required, standalone layout */}
      <Route path="/user-to/request" element={<RequestTravelOrderPage />} />
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout>
              <DashboardPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/list"
        element={
          <ProtectedRoute>
            <AppLayout>
              <ListPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/gps-logs"
        element={
          <ProtectedRoute>
            <AppLayout>
              <GpsLogsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <AppLayout>
              <ReportsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/travel-orders"
        element={
          <ProtectedRoute>
            <AppLayout>
              <TravelOrdersPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/travel-requests"
        element={
          <ProtectedRoute>
            <AppLayout>
              <RequestsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <AppLayout>
              <SettingsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <NotificationProvider>
            <DrawerProvider>
              <RecentActivityProvider>
                <FavoritesProvider>
                  <AppRoutes />
                  {/* Global overlays — rendered outside page layouts */}
                  <ConfirmationModal />
                  <ToastContainer />
                </FavoritesProvider>
              </RecentActivityProvider>
            </DrawerProvider>
          </NotificationProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}