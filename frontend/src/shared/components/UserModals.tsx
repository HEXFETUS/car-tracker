import { useState, useEffect, useRef } from 'react';
import { X, Camera, Lock, User, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useNotification } from '@/shared/context/NotificationContext';
import { API_BASE } from '@/shared/api';
import { apiFetch } from '@/shared/api-client';

// ── Types ────────────────────────────────────────────────────────

interface PasswordModalProps {
  open: boolean;
  onClose: () => void;
  onPasswordChanged?: () => void;
  currentUserId?: string;
}

interface AccountModalProps {
  open: boolean;
  currentUser: { id: string; name: string; username: string; department: string; picture?: string } | null;
  onClose: () => void;
}

// ── Shared input class helper — matches AddVehicleModal / AddGpsLogModal ──

function inputClass(error?: string) {
  return cn(
    'w-full rounded-xl border-0 px-3.5 py-2.5 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
    error ? 'ring-1 ring-red-400 bg-red-50' : 'ring-1 ring-brand-sage bg-white hover:ring-brand-teal',
  );
}

function FormCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-brand">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-brand-teal">{icon}</span>
        <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ── Password Modal ───────────────────────────────────────────────

export function PasswordModal({ open, onClose, onPasswordChanged, currentUserId }: PasswordModalProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const { confirm } = useNotification();

  useEffect(() => {
    if (!open) {
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setSubmitting(false);
      return;
    }
    window.scrollTo(0, 0);
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter') confirmRef.current?.click();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!newPassword.trim()) {
      setError('New password is required.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    const confirmed = await confirm({
      title: 'Change Password',
      message:
        'Are you sure you want to change your password? You will be signed out and will need to log in again.',
      type: 'warning',
    });

    if (!confirmed) return;

    setSubmitting(true);
    try {
      const response = await apiFetch(`${API_BASE}/api/users/${currentUserId}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });

      const json = await response.json();

      if (!json.success) {
        setError(json.error || 'Failed to update password.');
        return;
      }

      onClose();
      onPasswordChanged?.();
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  // Disable submit when either field is empty
  const passwordFieldsEmpty = !newPassword.trim() || !confirmPassword.trim();

  // Track which input has error for styling
  const newPasswordError = !submitting && error && !newPassword.trim()
    ? 'New password is required.'
    : undefined;
  const confirmError = !submitting && error && newPassword !== confirmPassword
    ? 'Passwords do not match.'
    : undefined;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="password-modal-title"
    >
      {/* Backdrop — no onClick, clicking outside does nothing */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in" />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-md animate-in fade-in zoom-in-95">
        <div className="flex max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-brand-xl">
          {/* Header */}
          <header className="flex shrink-0 items-start justify-between border-b border-zinc-100 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-teal/10">
                <Lock className="size-6 text-brand-teal" />
              </div>
              <div>
                <h2
                  id="password-modal-title"
                  className="text-lg font-semibold text-zinc-900"
                >
                  Change Password
                </h2>
                <p className="mt-0.5 text-sm text-zinc-500">Update your account password</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </header>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <FormCard title="Password Fields" icon={<Lock className="size-4" />}>
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="new-password"
                      className="mb-1.5 block text-sm font-medium text-zinc-700"
                    >
                      New password <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="new-password"
                      type="password"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        setError('');
                      }}
                      placeholder="Enter new password"
                      className={inputClass(newPasswordError ? 'error' : undefined)}
                      autoComplete="new-password"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="confirm-password"
                      className="mb-1.5 block text-sm font-medium text-zinc-700"
                    >
                      Confirm password <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setError('');
                      }}
                      placeholder="Re-enter new password"
                      className={inputClass(confirmError ? 'error' : undefined)}
                      autoComplete="new-password"
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-red-600" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              </FormCard>
            </div>

            {/* Actions */}
            <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-zinc-100 bg-white px-6 py-4">
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                className="rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-zinc-600 ring-1 ring-zinc-200 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                ref={confirmRef}
                disabled={submitting || passwordFieldsEmpty}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {submitting ? 'Updating…' : 'Update Password'}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Account Modal ────────────────────────────────────────────────

export function AccountModal({ open, currentUser, onClose }: AccountModalProps) {
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const { confirm } = useNotification();

  // Track original values to detect changes
  const [originalValues, setOriginalValues] = useState<{
    username: string;
    name: string;
    position: string;
    picture: string | null;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setPhotoPreview(null);
      setUsername('');
      setName('');
      setPosition('');
      setError('');
      setSubmitting(false);
      return;
    }
    if (currentUser) {
      const u = currentUser.username ?? '';
      const n = currentUser.name ?? '';
      const p = currentUser.department ?? '';
      const pic = currentUser.picture ?? null;
      setUsername(u);
      setName(n);
      setPosition(p);
      setPhotoPreview(pic);
      setOriginalValues({ username: u, name: n, position: p, picture: pic });
    }
    window.scrollTo(0, 0);
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, currentUser, onClose]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  async function handleSubmit() {
    setError('');

    const confirmed = await confirm({
      title: 'Save Changes',
      message: 'Are you sure you want to update your account information?',
      type: 'info',
    });

    if (!confirmed) return;

    setSubmitting(true);
    try {
      const body: Record<string, string | null> = {
        name: name.trim(),
        username: username.trim(),
        department: position.trim(),
        picture: photoPreview ?? null,
      };

      const response = await apiFetch(`${API_BASE}/api/users/${currentUser!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await response.json();

      if (!json.success) {
        setError(json.error || 'Failed to update account.');
        return;
      }

      localStorage.setItem('car-tracker-user', JSON.stringify(json.data));
      window.location.reload();
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  // Disable submit when any required text field is empty
  const accountFieldsEmpty =
    !username.trim() || !name.trim() || !position.trim();

  // Detect if any field was changed from its original value
  const hasChanges =
    originalValues !== null &&
    (username !== originalValues.username ||
      name !== originalValues.name ||
      position !== originalValues.position ||
      photoPreview !== originalValues.picture);

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-modal-title"
    >
      {/* Backdrop — no onClick, clicking outside does nothing */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in" />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-md animate-in fade-in zoom-in-95">
        <div className="flex max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-brand-xl">
          {/* Header */}
          <header className="flex shrink-0 items-start justify-between border-b border-zinc-100 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-teal/10">
                <User className="size-6 text-brand-teal" />
              </div>
              <div>
                <h2
                  id="account-modal-title"
                  className="text-lg font-semibold text-zinc-900"
                >
                  Account Settings
                </h2>
                <p className="mt-0.5 text-sm text-zinc-500">Update your profile information</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            {/* Body */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {/* Photo */}
              <FormCard title="Profile Photo" icon={<Camera className="size-4" />}>
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    className="group relative flex size-24 cursor-pointer items-center justify-center rounded-full bg-brand-teal/10 ring-1 ring-brand-sage transition-colors hover:ring-brand-teal"
                    onClick={() => photoRef.current?.click()}
                  >
                    {photoPreview ? (
                      <img
                        src={photoPreview}
                        alt="Profile preview"
                        className="size-full rounded-full object-cover"
                      />
                    ) : (
                      <Camera className="size-7 text-brand-teal" />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <Camera className="size-5 text-white" />
                    </span>
                  </button>
                  <input
                    ref={photoRef}
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    className="hidden"
                  />
                  <span className="mt-2 text-xs text-zinc-500">Click to change photo</span>
                </div>
              </FormCard>

              <FormCard title="Basic Information" icon={<User className="size-4" />}>
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="account-username"
                      className="mb-1.5 block text-sm font-medium text-zinc-700"
                    >
                      Username <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="account-username"
                      type="text"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setError('');
                      }}
                      className={inputClass()}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="account-name"
                      className="mb-1.5 block text-sm font-medium text-zinc-700"
                    >
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="account-name"
                      type="text"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setError('');
                      }}
                      className={inputClass()}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="account-position"
                      className="mb-1.5 block text-sm font-medium text-zinc-700"
                    >
                      Position <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="account-position"
                      type="text"
                      value={position}
                      onChange={(e) => {
                        setPosition(e.target.value);
                        setError('');
                      }}
                      className={inputClass()}
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-red-600" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              </FormCard>
            </div>

            {/* Actions */}
            <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-zinc-100 bg-white px-6 py-4">
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                className="rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-zinc-600 ring-1 ring-zinc-200 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                ref={saveRef}
                disabled={submitting || !hasChanges || accountFieldsEmpty}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {submitting ? 'Saving…' : 'Save Changes'}
              </button>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
