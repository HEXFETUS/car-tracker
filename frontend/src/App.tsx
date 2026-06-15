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
import { ListPage } from '@/modules/list/pages/ListPage';
import { ReportsPage } from '@/modules/reports/pages/ReportsPage';
import { TravelOrdersPage } from '@/modules/travel-orders/pages/TravelOrdersPage';
import { GpsLogsPage } from '@/modules/gps-logs/pages/GpsLogsPage';
import { SettingsPage } from '@/modules/settings/pages/SettingsPage';
import { RequestsPage } from '@/modules/requests/pages/RequestsPage';

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