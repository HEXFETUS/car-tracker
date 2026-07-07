import type { TravelOrderData } from '../api/travel-orders-api';
import { formatDateManilaFull, formatTimeManila } from '@/shared/lib/date-utils';
import LogoImage from '@/assets/LogoWithName.png';

interface TravelOrderPrintableProps {
  order: TravelOrderData;
}

export function TravelOrderPrintable({ order }: TravelOrderPrintableProps) {
  const dateFiled = order.createdAt
    ? formatDateManilaFull(order.createdAt)
    : '—';

  const travelDate = order.scheduledDepartureAt
    ? formatDateManilaFull(order.scheduledDepartureAt)
    : '—';

  const timeOut = order.scheduledDepartureAt
    ? formatTimeManila(order.scheduledDepartureAt)
    : '—';

  const timeIn = order.scheduledArrivalAt
    ? formatTimeManila(order.scheduledArrivalAt)
    : '—';

  const carDisplay = order.vehicleMake && order.vehicleModel
    ? `${order.vehicleMake} ${order.vehicleModel}`
    : order.vehicleMake || order.vehicleModel || '—';

  return (
    <div className="to-form-copy">
      <div className="to-print-logo-wrap">
        <img src={LogoImage} alt="Logo" className="to-print-logo" />
      </div>

      <div className="to-top-rule" />

      <h1>TRAVEL ORDER</h1>

      <div className="to-grid">
        <div className="to-field">
          <span>DATE FILED:</span>
          <strong>{dateFiled}</strong>
        </div>
        <div className="to-field">
          <span>TO Number:</span>
          <strong className="to-number">{order.toNumber}</strong>
        </div>
        <div className="to-field">
          <span>TRAVEL DATE:</span>
          <strong>{travelDate}</strong>
        </div>
        <div className="to-field">
          <span>Driver:</span>
          <strong>{order.driverName || '—'}</strong>
        </div>
        <div className="to-field">
          <span>EMPLOYEE NAME:</span>
          <strong>{order.travelerName || '—'}</strong>
        </div>
        <div className="to-field">
          <span>Car:</span>
          <strong>{carDisplay}</strong>
        </div>
        <div className="to-field">
          <span>DEPARTMENT:</span>
          <strong>{order.department || '—'}</strong>
        </div>
        <div className="to-field">
          <span>Plate Number:</span>
          <strong>{order.plateNumber || '—'}</strong>
        </div>
      </div>

      <div className="to-time-row">
        <div className="to-field">
          <span>Time Out – Out of Office:</span>
          <strong>{timeOut}</strong>
        </div>
        <div className="to-field">
          <span>Time In – Return to Office:</span>
          <strong>{timeIn}</strong>
        </div>
      </div>

      <div className="to-purpose-box">
        <div className="to-purpose-label">PURPOSE</div>
        <div className="to-purpose-content">
          {order.purpose || '—'}
        </div>
      </div>

      <div className="to-signatures">
        <div>
          <div className="sig-line">{order.travelerName || '—'}</div>
          <div className="sig-label">EMPLOYEE'S NAME & SIGNATURE</div>
        </div>
        <div>
          <div className="sig-line">{order.approvedByName || '—'}</div>
          <div className="sig-label">IMMEDIATE HEAD</div>
        </div>
        <div>
          <div className="sig-line">{order.travelerName || '—'}</div>
          <div className="sig-label">NOTED BY HR</div>
        </div>
      </div>

      <div className="to-bottom-rule" />
    </div>
  );
}