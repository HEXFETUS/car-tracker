import { useState, useEffect, useRef } from 'react';
import { X, Camera, Lock } from 'lucide-react';
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

// ── Password Modal ───────────────────────────────────────────────

export function PasswordModal({ open, onClose, onPasswordChanged, currentUserId }: PasswordModalProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const { confirm } = useNotification();

  useEffect(() => {
    if (!open) {
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setSubmitting(false);
      return;
    }
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

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="password-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-md animate-[scaleIn_200ms_ease-out]">
        <div className="rounded-2xl bg-white p-6 shadow-brand-xl">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>

          {/* Header */}
          <div className="mb-6 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-brand-teal/10">
              <Lock className="size-5 text-brand-teal" />
            </div>
            <div>
              <h2
                id="password-modal-title"
                className="text-lg font-semibold text-zinc-900"
              >
                Change Password
              </h2>
              <p className="text-xs text-zinc-500">Update your account password</p>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* New password */}
            <div className="mb-4 space-y-1.5">
              <label htmlFor="new-password" className="text-sm font-medium text-zinc-700">
                New password
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
                className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/20"
                autoComplete="new-password"
              />
            </div>

            {/* Confirm password */}
            <div className="mb-4 space-y-1.5">
              <label htmlFor="confirm-password" className="text-sm font-medium text-zinc-700">
                Confirm password
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
                className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/20"
                autoComplete="new-password"
              />
            </div>

            {error && (
              <p className="mb-4 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                className="flex-1 rounded-xl ring-1 ring-brand-sage bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-brand-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                ref={confirmRef}
                disabled={submitting}
                className="flex-1 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {submitting ? 'Updating…' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
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
  const { confirm } = useNotification();

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
      setUsername(currentUser.username ?? '');
      setName(currentUser.name ?? '');
      setPosition(currentUser.department ?? '');
      setPhotoPreview(currentUser.picture ?? null);
    }
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

      // Save updated user data to localStorage before reloading
      localStorage.setItem('car-tracker-user', JSON.stringify(json.data));
      window.location.reload();
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-md animate-[scaleIn_200ms_ease-out]">
        <div className="rounded-2xl bg-white p-6 shadow-brand-xl">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>

          {/* Header */}
          <div className="mb-6">
            <h2
              id="account-modal-title"
              className="text-lg font-semibold text-zinc-900"
            >
              Account Settings
            </h2>
            <p className="text-xs text-zinc-500">Update your profile information</p>
          </div>

          {/* Photo */}
          <div className="mb-6 flex flex-col items-center">
            <div
              className="relative flex size-20 cursor-pointer items-center justify-center rounded-full bg-brand-cream"
              onClick={() => photoRef.current?.click()}
            >
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="Profile preview"
                  className="size-full rounded-full object-cover"
                />
              ) : (
                <Camera className="size-7 text-zinc-400" />
              )}
              <div className="absolute inset-0 rounded-full bg-black/30 opacity-0 transition-opacity hover:opacity-100" />
            </div>
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              className="hidden"
            />
            <span className="mt-2 text-xs text-zinc-500">Click to change photo</span>
          </div>

          {/* Form fields */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="account-username" className="text-sm font-medium text-zinc-700">
                Username
              </label>
              <input
                id="account-username"
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError('');
                }}
                className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/20"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="account-name" className="text-sm font-medium text-zinc-700">
                Name
              </label>
              <input
                id="account-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError('');
                }}
                className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/20"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="account-position" className="text-sm font-medium text-zinc-700">
                Position
              </label>
              <input
                id="account-position"
                type="text"
                value={position}
                onChange={(e) => {
                  setPosition(e.target.value);
                  setError('');
                }}
                className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/20"
              />
            </div>
          </div>

          {error && (
            <p className="mt-4 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="flex-1 rounded-xl ring-1 ring-brand-sage bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-brand-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              ref={saveRef}
              disabled={submitting}
              className="flex-1 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
