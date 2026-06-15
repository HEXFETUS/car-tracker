import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

// ── Types ──────────────────────────────────────────────────────

export type ConfirmType = 'info' | 'warning' | 'danger';

export interface ConfirmOptions {
  title: string;
  message: string;
  type?: ConfirmType;
}

export interface ToastOptions {
  message: string;
  variant?: 'success' | 'error' | 'info';
  duration?: number;
}

interface ConfirmationState {
  open: boolean;
  resolve: (value: boolean) => void;
  options: ConfirmOptions;
}

interface ToastItem {
  id: string;
  message: string;
  variant: NonNullable<ToastOptions['variant']>;
}

interface NotificationContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: (message: string, variant?: ToastOptions['variant']) => void;
  confirmationState: ConfirmationState;
  toasts: ToastItem[];
  closeConfirmation: () => void;
  dismissToast: (id: string) => void;
}

// ── Context ────────────────────────────────────────────────────

const NotificationContext = createContext<NotificationContextValue | null>(null);

let toastCounter = 0;

// ── Provider ───────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [confirmationState, setConfirmationState] =
    useState<ConfirmationState>({
      open: false,
      resolve: () => {},
      options: { title: '', message: '', type: 'info' },
    });
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // ── confirm ──────────────────────────────────────────────────
  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        setConfirmationState({
          open: true,
          resolve,
          options: { type: 'info', ...options },
        });
      });
    },
    [],
  );

  const closeConfirmation = useCallback(() => {
    setConfirmationState((prev) => ({ ...prev, open: false }));
  }, []);

  // ── toast ────────────────────────────────────────────────────
  const toast = useCallback(
    (message: string, variant: ToastOptions['variant'] = 'success') => {
      const id = `toast-${++toastCounter}`;
      setToasts((prev) => [...prev, { id, message, variant }]);
      // Auto-dismiss toast after 5 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        confirm,
        toast,
        confirmationState,
        toasts,
        closeConfirmation,
        dismissToast,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────

export function useNotification(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error(
      'useNotification must be used within a NotificationProvider',
    );
  }
  return ctx;
}