import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { TravelOrderForm } from '@/modules/travel-orders/components/TravelOrderForm';
import { fetchPublicNextToNumber, createPublicTravelOrder } from '../api/public-travel-orders-api';
import type { TravelOrder } from '@/modules/travel-orders/types';

/** Convert a datetime-local value (YYYY-MM-DDTHH:MM, local) to an ISO string with local timezone offset. */
function toLocalISO(datetimeLocal: string): string {
  if (!datetimeLocal) return datetimeLocal;
  const date = new Date(datetimeLocal);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${hours}:${minutes}`;
}

type PageState = 'form' | 'success';

export function RequestTravelOrderPage() {
  const navigate = useNavigate();
  const { confirm } = useNotification();
  const [pageState, setPageState] = useState<PageState>('form');

  const handleCancel = useCallback(async () => {
    const leave = await confirm({
      title: 'Discard Changes',
      message: 'Are you sure you want to leave this page?\n\nAny unsaved information will be lost.',
      type: 'warning',
    });
    if (leave) {
      navigate('/login');
    }
  }, [navigate, confirm]);

  const handleSubmit = useCallback(
    async (order: TravelOrder) => {
      // Show confirmation modal
      const confirmed = await confirm({
        title: 'Confirm Submission',
        message:
          'Are you sure you want to submit this Travel Order request?\n\nPlease verify that all information is correct before proceeding.',
        type: 'info',
      });
      if (!confirmed) return;

      try {
        // Map TravelOrder to the API payload
        await createPublicTravelOrder({
          toNumber: order.toNumber,
          originLocation: order.boundFrom,
          destinationLocation: order.boundTo,
          scheduledDepartureAt: toLocalISO(order.departureDateTime),
          scheduledArrivalAt: toLocalISO(order.returnDateTime),
          purpose: order.purpose,
          notes: order.remarks,
          department: order.department,
          travelerName: order.travelerName,
          requestVehicle: order.requestVehicle,
          requestDriver: order.requestDriver,
          latLongOrigin: order.latLongOrigin,
          latLongDestination: order.latLongDestination,
        });

        // Show success state
        setPageState('success');
      } catch (err: any) {
        // The form doesn't have a toast context directly, but we can use the confirm to show error
        alert(err.message || 'Failed to create travel order. Please try again.');
      }
    },
    [confirm],
  );

  const handleReturnToLogin = () => {
    navigate('/login');
  };

  // ---- Success State ----
  if (pageState === 'success') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4 py-6">
        <div className="w-full max-w-md animate-in fade-in zoom-in-95">
          <div className="rounded-2xl bg-white p-8 shadow-brand-xl text-center">
            {/* Success Icon */}
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="size-8 text-green-600" />
            </div>

            <h2 className="text-xl font-bold text-zinc-900">Request Submitted</h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              Your Travel Order request has been submitted successfully.
            </p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">
              You will be notified once your request has been reviewed.
            </p>

            <button
              onClick={handleReturnToLogin}
              className="mt-8 w-full rounded-lg bg-brand-teal px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80"
            >
              Return to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Form State ----
  return (
    <div className="min-h-dvh bg-zinc-50">
      {/* Top bar with back button */}
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 sm:px-6">
          <button
            onClick={handleCancel}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-zinc-900">Request Travel Order</h1>
            <p className="text-sm text-zinc-400">
              Fill in the details to submit a travel order request.
            </p>
          </div>
        </div>
      </div>

      {/* Form content */}
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <div className="rounded-2xl bg-white p-6 shadow-brand sm:p-8">
          <TravelOrderForm
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            submitLabel="Submit Request"
            cancelLabel="Cancel"
            fetchNextToNumberFn={fetchPublicNextToNumber}
          />
        </div>
      </div>
    </div>
  );
}
