import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/modules/auth/context/auth-context';
import { ProtectedRoute, PublicRoute } from '@/modules/auth/components/ProtectedRoute';
import { NotificationProvider } from '@/shared/context/NotificationContext';
import { ConfirmationModal } from '@/shared/components/ConfirmationModal';
import { ToastContainer } from '@/shared/components/ToastContainer';
import { AppLayout } from '@/shared/components/AppLayout';
import { LoginPage } from '@/modules/auth/pages/LoginPage';
import { DashboardPage } from '@/modules/dashboard/pages/DashboardPage';
import { VehiclesPage } from '@/modules/vehicles/pages/VehiclesPage';
import { ReportsPage } from '@/modules/reports/pages/ReportsPage';
import { TravelOrdersPage } from '@/modules/travel-orders/pages/TravelOrdersPage';
import { GpsLogsPage } from '@/modules/gps-logs/pages/GpsLogsPage';
import { DriversPage } from '@/modules/drivers/pages/DriversPage';
import { SettingsPage } from '@/modules/settings/pages/SettingsPage';

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <Routes>
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
        path="/vehicles"
        element={
          <ProtectedRoute>
            <AppLayout>
              <VehiclesPage />
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
        path="/drivers"
        element={
          <ProtectedRoute>
            <AppLayout>
              <DriversPage />
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
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <NotificationProvider>
            <AppRoutes />
            {/* Global overlays — rendered outside page layouts */}
            <ConfirmationModal />
            <ToastContainer />
          </NotificationProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}