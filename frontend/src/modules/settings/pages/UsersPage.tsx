import { useState, useCallback } from 'react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import {
  Pencil,
  KeyRound,
  Trash2,
  Plus,
  X,
  Eye,
  EyeOff,
  Copy,
  Check,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Mechanic' | 'Driver';
  status: 'Active' | 'Inactive';
}

type ModalMode = 'create' | 'edit';

// ── Dropdown Select ────────────────────────────────────────────

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownSelectProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
}

function DropdownSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  error,
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false);

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={cn(
          'flex w-full items-center justify-between rounded-xl border-0 ring-1 px-3.5 py-2.5 text-sm transition-colors',
          error
            ? 'ring-red-400 bg-red-50 text-red-700'
            : 'ring-brand-sage bg-white text-zinc-900 hover:ring-brand-teal',
        )}
      >
        <span className={value ? '' : 'text-zinc-400'}>
          {selectedLabel ?? placeholder}
        </span>
        <svg
          className={cn('size-4 transition-transform', open && 'rotate-180')}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl ring-1 ring-brand-sage bg-white py-1 shadow-brand">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onMouseDown={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center px-3.5 py-2 text-left text-sm transition-colors',
                opt.value === value
                  ? 'bg-brand-moss font-medium text-zinc-900'
                  : 'text-zinc-700 hover:bg-brand-cream',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Password Generator ────────────────────────────────────────

function generatePassword(): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const symbols = '!@#$%^&*()-_=+';
  const all = upper + lower + digits + symbols;

  // Guarantee at least one of each category
  const required = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];

  // Fill remaining 8 characters
  const remaining = Array.from({ length: 8 }, () =>
    all[Math.floor(Math.random() * all.length)],
  );

  // Shuffle all 12 characters
  return [...required, ...remaining]
    .sort(() => Math.random() - 0.5)
    .join('');
}

// ── Validation ─────────────────────────────────────────────────

interface ValidationErrors {
  name?: string;
  email?: string;
  role?: string;
}

function validateUserForm(data: {
  name: string;
  email: string;
  role: string;
}): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!data.name.trim()) {
    errors.name = 'Name is required.';
  }

  if (!data.email.trim()) {
    errors.email = 'Email is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (!data.role) {
    errors.role = 'Please select a role.';
  }

  return errors;
}

// ── Props ──────────────────────────────────────────────────────

interface UsersPageProps {
  /** Optional initial users for testing / SSR. Defaults to the hardcoded sample. */
  initialUsers?: UserAccount[];
}

// ── Component ──────────────────────────────────────────────────

export function UsersPage({ initialUsers }: UsersPageProps) {
  const { confirm, toast } = useNotification();

  // ── State ──────────────────────────────────────────────────

  const DEFAULT_USERS: UserAccount[] = [
    {
      id: 'u1',
      name: 'Jane Cooper',
      email: 'jane.cooper@fleet.com',
      role: 'Admin',
      status: 'Active',
    },
    {
      id: 'u2',
      name: 'Marcus Reed',
      email: 'marcus.reed@fleet.com',
      role: 'Mechanic',
      status: 'Active',
    },
    {
      id: 'u3',
      name: 'Sofia Chen',
      email: 'sofia.chen@fleet.com',
      role: 'Driver',
      status: 'Active',
    },
    {
      id: 'u4',
      name: 'Tom Briggs',
      email: 'tom.briggs@fleet.com',
      role: 'Driver',
      status: 'Inactive',
    },
    {
      id: 'u5',
      name: 'Aisha Patel',
      email: 'aisha.patel@fleet.com',
      role: 'Mechanic',
      status: 'Active',
    },
  ];

  const [users, setUsers] = useState<UserAccount[]>(initialUsers ?? DEFAULT_USERS);

  // Modal visibility
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  // Form state: Create / Edit
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState('');
  const [formErrors, setFormErrors] = useState<ValidationErrors>({});

  // Password modal state
  const [passwordTargetUserId, setPasswordTargetUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);

  // ── Helpers ────────────────────────────────────────────────

  const resetUserForm = useCallback(() => {
    setFormName('');
    setFormEmail('');
    setFormRole('');
    setFormErrors({});
    setEditingUserId(null);
    setModalMode('create');
  }, []);

  const openEditModal = useCallback((user: UserAccount) => {
    setModalMode('edit');
    setEditingUserId(user.id);
    setFormName(user.name);
    setFormEmail(user.email);
    setFormRole(user.role);
    setFormErrors({});
    setUserModalOpen(true);
  }, []);

  const openCreateModal = useCallback(() => {
    resetUserForm();
    setUserModalOpen(true);
  }, [resetUserForm]);

  const openPasswordModal = useCallback((user: UserAccount) => {
    setPasswordTargetUserId(user.id);
    setNewPassword('');
    setShowPassword(false);
    setPasswordCopied(false);
    setPasswordModalOpen(true);
  }, []);

  // ── Handlers ──────────────────────────────────────────────

  const handleSaveUser = useCallback(() => {
    const errors = validateUserForm({
      name: formName,
      email: formEmail,
      role: formRole,
    });
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (modalMode === 'create') {
      const newUser: UserAccount = {
        id: `u${Date.now()}`,
        name: formName.trim(),
        email: formEmail.trim(),
        role: formRole as UserAccount['role'],
        status: 'Active',
      };
      setUsers((prev) => [...prev, newUser]);
      toast('User created successfully.', 'success');
    } else {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === editingUserId
            ? {
              ...u,
              name: formName.trim(),
              email: formEmail.trim(),
              role: formRole as UserAccount['role'],
            }
            : u,
        ),
      );
      toast('User updated successfully.', 'success');
    }

    setUserModalOpen(false);
    resetUserForm();
  }, [formName, formEmail, formRole, modalMode, editingUserId, resetUserForm, toast]);

  const handleDeleteUser = useCallback(
    async (user: UserAccount) => {
      const confirmed = await confirm({
        title: 'Delete User',
        message: `Are you sure you want to delete "${user.name}"? This action cannot be undone.`,
        type: 'danger',
      });

      if (confirmed) {
        setUsers((prev) => prev.filter((u) => u.id !== user.id));
        toast(`"${user.name}" has been deleted.`, 'success');
      }
    },
    [confirm, toast],
  );

  const handleChangePassword = useCallback(() => {
    if (!newPassword) {
      toast('Please enter or generate a password.', 'error');
      return;
    }

    setUsers((prev) =>
      prev.map((u) =>
        u.id === passwordTargetUserId ? { ...u } : u,
      ),
    );
    setPasswordModalOpen(false);
    setPasswordTargetUserId(null);
    setNewPassword('');
    toast('Password has been updated successfully.', 'success');
  }, [newPassword, passwordTargetUserId, toast]);

  const handleGeneratePassword = useCallback(() => {
    const pwd = generatePassword();
    setNewPassword(pwd);
    setPasswordCopied(false);
  }, []);

  const handleCopyPassword = useCallback(async () => {
    if (!newPassword) return;
    try {
      await navigator.clipboard.writeText(newPassword);
      setPasswordCopied(true);
      setTimeout(() => setPasswordCopied(false), 2000);
    } catch {
      toast('Failed to copy password.', 'error');
    }
  }, [newPassword, toast]);

  // ── Derived values ──────────────────────────────────────────

  const passwordModalUser = passwordTargetUserId
    ? users.find((u) => u.id === passwordTargetUserId) ?? null
    : null;

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-center justify-end">
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
        >
          <Plus className="size-4" />
          Add User
        </button>
      </div>

      {/* ── Users table ─────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-brand">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            {/* Table header */}
            <thead>
              <tr className="bg-brand-cream">
                <th className="px-6 py-3.5 font-semibold text-brand-teal">Name</th>
                <th className="px-6 py-3.5 font-semibold text-brand-teal">Email</th>
                <th className="px-6 py-3.5 font-semibold text-brand-teal">Role</th>
                <th className="px-6 py-3.5 font-semibold text-brand-teal">Status</th>
                <th className="px-6 py-3.5 font-semibold text-brand-teal">Actions</th>
              </tr>
            </thead>
            {/* Table body */}
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-16 text-center text-zinc-400"
                  >
                    No users found. Click <strong>Add User</strong> to create one.
                  </td>
                </tr>
              )}

              {users.map((user, index) => (
                <tr
                  key={user.id}
                  className={cn(
                    'transition-colors',
                    index % 2 === 0 ? 'bg-white' : 'bg-brand-cream/50',
                    'hover:bg-brand-moss/30',
                  )}
                >
                  <td className="px-6 py-4 font-medium text-zinc-900">
                    {user.name}
                  </td>
                  <td className="px-6 py-4 text-zinc-600">{user.email}</td>
                  <td className="px-6 py-4">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                        user.role === 'Admin' &&
                        'bg-brand-teal/10 text-brand-teal',
                        user.role === 'Mechanic' &&
                        'bg-brand-sage/10 text-brand-sage',
                        user.role === 'Driver' &&
                        'bg-brand-moss/30 text-zinc-700',
                      )}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                        user.status === 'Active'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-zinc-100 text-zinc-500',
                      )}
                    >
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          user.status === 'Active'
                            ? 'bg-emerald-500'
                            : 'bg-zinc-400',
                        )}
                      />
                      {user.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1">
                      {/* Edit */}
                      <button
                        onClick={() => openEditModal(user)}
                        className="rounded-lg p-1.5 text-brand-teal transition-colors hover:bg-brand-moss/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
                        aria-label={`Edit ${user.name}`}
                        title="Edit user"
                      >
                        <Pencil className="size-4" />
                      </button>

                      {/* Change Password */}
                      <button
                        onClick={() => openPasswordModal(user)}
                        className="rounded-lg p-1.5 text-brand-sage transition-colors hover:bg-brand-moss/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sage"
                        aria-label={`Change password for ${user.name}`}
                        title="Change password"
                      >
                        <KeyRound className="size-4" />
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => handleDeleteUser(user)}
                        className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                        aria-label={`Delete ${user.name}`}
                        title="Delete user"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create / Edit User Modal ──────────────────────────── */}
      {userModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setUserModalOpen(false);
              resetUserForm();
            }}
          />

          <div className="relative z-10 w-full max-w-lg animate-[scaleIn_200ms_ease-out]">
            <div className="rounded-2xl bg-white p-6 shadow-brand-xl">
              {/* Header */}
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-brand-teal">
                  {modalMode === 'create' ? 'Add User' : 'Edit User'}
                </h2>
                <button
                  onClick={() => {
                    setUserModalOpen(false);
                    resetUserForm();
                  }}
                  className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Form */}
              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Full name"
                    className={cn(
                      'w-full rounded-xl border-0 ring-1 px-3.5 py-2.5 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                      formErrors.name
                        ? 'ring-red-400 bg-red-50'
                        : 'ring-brand-sage bg-white hover:ring-brand-teal',
                    )}
                  />
                  {formErrors.name && (
                    <p className="mt-1 text-xs text-red-500">
                      {formErrors.name}
                    </p>
                  )}
                </div>

                {/* Email */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    Email <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="email@example.com"
                    className={cn(
                      'w-full rounded-xl border-0 ring-1 px-3.5 py-2.5 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                      formErrors.email
                        ? 'ring-red-400 bg-red-50'
                        : 'ring-brand-sage bg-white hover:ring-brand-teal',
                    )}
                  />
                  {formErrors.email && (
                    <p className="mt-1 text-xs text-red-500">
                      {formErrors.email}
                    </p>
                  )}
                </div>

                {/* Role */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    Role <span className="text-red-400">*</span>
                  </label>
                  <DropdownSelect
                    options={[
                      { value: 'Admin', label: 'Admin' },
                      { value: 'Mechanic', label: 'Mechanic' },
                      { value: 'Driver', label: 'Driver' },
                    ]}
                    value={formRole}
                    onChange={setFormRole}
                    placeholder="Select a role"
                    error={formErrors.role}
                  />
                  {formErrors.role && (
                    <p className="mt-1 text-xs text-red-500">
                      {formErrors.role}
                    </p>
                  )}
                </div>
              </div>

              {/* Footer buttons */}
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => {
                    setUserModalOpen(false);
                    resetUserForm();
                  }}
                  className="flex-1 rounded-xl ring-1 ring-brand-sage bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-brand-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveUser}
                  className="flex-1 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
                >
                  {modalMode === 'create' ? 'Create User' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Password Modal ──────────────────────────────── */}
      {passwordModalOpen && passwordModalUser && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setPasswordModalOpen(false);
              setNewPassword('');
            }}
          />

          <div className="relative z-10 w-full max-w-md animate-[scaleIn_200ms_ease-out]">
            <div className="rounded-2xl bg-white p-6 shadow-brand-xl">
              {/* Header */}
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-brand-teal">
                  Change Password
                </h2>
                <button
                  onClick={() => {
                    setPasswordModalOpen(false);
                    setNewPassword('');
                  }}
                  className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Current user context */}
              <p className="mb-4 text-sm text-zinc-500">
                Updating password for{' '}
                <span className="font-medium text-zinc-900">
                  {passwordModalUser.name}
                </span>
              </p>

              {/* Password input */}
              <div className="relative">
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setPasswordCopied(false);
                    }}
                    placeholder="Enter new password"
                    className="w-full rounded-xl border-0 ring-1 ring-brand-sage bg-white px-3.5 py-2.5 pr-20 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal hover:ring-brand-teal"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                    {newPassword && (
                      <button
                        type="button"
                        onClick={handleCopyPassword}
                        className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                        aria-label="Copy password"
                        title="Copy to clipboard"
                      >
                        {passwordCopied ? (
                          <Check className="size-4 text-emerald-500" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Generate password button */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleGeneratePassword}
                  className="inline-flex items-center gap-2 rounded-xl ring-1 ring-brand-sage bg-white px-3.5 py-2 text-sm font-medium text-brand-teal transition-colors hover:bg-brand-moss/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
                >
                  <svg
                    className="size-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
                    />
                  </svg>
                  Generate Password
                </button>
              </div>

              {/* Footer buttons */}
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => {
                    setPasswordModalOpen(false);
                    setNewPassword('');
                  }}
                  className="flex-1 rounded-xl ring-1 ring-brand-sage bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-brand-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
                >
                  Cancel
                </button>
                <button
                  onClick={handleChangePassword}
                  className="flex-1 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
                >
                  Update Password
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}