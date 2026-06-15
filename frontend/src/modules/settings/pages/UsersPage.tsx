import { useState, useEffect, useCallback } from 'react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import type { AppUser } from '@car-tracker/shared';
import {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  changeUserPassword,
} from '../api/users-api';
import {
  Plus,
  Pencil,
  X,
  Eye,
  EyeOff,
  Copy,
  Check,
  Trash2,
  KeyRound,
  Loader2,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────

type UserType = AppUser['userType'];

// ── User Type Badge ────────────────────────────────────────────

const USER_TYPE_STYLES: Record<UserType, { bg: string; text: string }> = {
  SUPERADMIN: { bg: 'bg-rose-100', text: 'text-rose-700' },
  ADMIN: { bg: 'bg-brand-teal/10', text: 'text-brand-teal' },
  DISPATCHER: { bg: 'bg-amber-100', text: 'text-amber-700' },
  HR: { bg: 'bg-brand-moss/30', text: 'text-zinc-700' },
  VIEWER: { bg: 'bg-zinc-100', text: 'text-zinc-500' },
};

function UserTypeBadge({ type }: { type: UserType }) {
  const style = USER_TYPE_STYLES[type] ?? USER_TYPE_STYLES.VIEWER;
  const label = type.charAt(0) + type.slice(1).toLowerCase();
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
        style.bg,
        style.text,
      )}
    >
      {label}
    </span>
  );
}

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

  const required = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];

  const remaining = Array.from({ length: 8 }, () =>
    all[Math.floor(Math.random() * all.length)],
  );

  return [...required, ...remaining]
    .sort(() => Math.random() - 0.5)
    .join('');
}

// ── Validation ─────────────────────────────────────────────────

interface ValidationErrors {
  name?: string;
  username?: string;
  password?: string;
  userType?: string;
  department?: string;
}

function validateUserForm(data: {
  name: string;
  username: string;
  password: string;
  userType: string;
  department: string;
}): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!data.name.trim()) {
    errors.name = 'Name is required.';
  }

  if (!data.username.trim()) {
    errors.username = 'Username is required.';
  }

  if (!data.password) {
    errors.password = 'Password is required.';
  } else if (data.password.length < 8) {
    errors.password = 'Password must be at least 8 characters.';
  }

  if (!data.userType) {
    errors.userType = 'Please select a user type.';
  }

  if (!data.department.trim()) {
    errors.department = 'Department is required.';
  }

  return errors;
}

// ── User Type Options ─────────────────────────────────────────

const USER_TYPE_OPTIONS: DropdownOption[] = [
  { value: 'SUPERADMIN', label: 'Super Admin' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'DISPATCHER', label: 'Dispatcher' },
  { value: 'HR', label: 'HR' },
  { value: 'VIEWER', label: 'Viewer' },
];

// ── Component ──────────────────────────────────────────────────

export function UsersPage() {
  const { confirm, toast } = useNotification();

  // ── State ──────────────────────────────────────────────────

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formUserType, setFormUserType] = useState('');
  const [formDepartment, setFormDepartment] = useState('');
  const [formErrors, setFormErrors] = useState<ValidationErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // Edit modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editFormName, setEditFormName] = useState('');
  const [editFormUsername, setEditFormUsername] = useState('');
  const [editFormUserType, setEditFormUserType] = useState('');
  const [editFormDepartment, setEditFormDepartment] = useState('');
  const [editFormErrors, setEditFormErrors] = useState<Pick<ValidationErrors, 'name' | 'username' | 'userType' | 'department'>>({});
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Password modal
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordTargetUserId, setPasswordTargetUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);

  // ── Data Fetching ────────────────────────────────────────

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // ── Helpers ────────────────────────────────────────────────

  const resetCreateForm = useCallback(() => {
    setFormName('');
    setFormUsername('');
    setFormPassword('');
    setFormUserType('');
    setFormDepartment('');
    setFormErrors({});
  }, []);

  const openCreateModal = useCallback(() => {
    resetCreateForm();
    setCreateModalOpen(true);
  }, [resetCreateForm]);

  const openPasswordModal = useCallback((userId: string) => {
    setPasswordTargetUserId(userId);
    setNewPassword('');
    setShowPassword(false);
    setPasswordCopied(false);
    setPasswordModalOpen(true);
  }, []);

  const openEditModal = useCallback((user: AppUser) => {
    setEditUserId(user.id);
    setEditFormName(user.name);
    setEditFormUsername(user.username);
    setEditFormUserType(user.userType);
    setEditFormDepartment(user.department);
    setEditFormErrors({});
    setEditModalOpen(true);
  }, []);

  const resetEditForm = useCallback(() => {
    setEditUserId(null);
    setEditFormName('');
    setEditFormUsername('');
    setEditFormUserType('');
    setEditFormDepartment('');
    setEditFormErrors({});
  }, []);

  // ── Handlers ──────────────────────────────────────────────

  const handleCreateUser = useCallback(async () => {
    const errors = validateUserForm({
      name: formName,
      username: formUsername,
      password: formPassword,
      userType: formUserType,
      department: formDepartment,
    });
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      setSubmitting(true);
      await createUser({
        name: formName.trim(),
        username: formUsername.trim(),
        password: formPassword,
        userType: formUserType,
        department: formDepartment.trim(),
      });
      toast('User created successfully.', 'success');
      setCreateModalOpen(false);
      resetCreateForm();
      await loadUsers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create user', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [formName, formUsername, formPassword, formUserType, formDepartment, toast, resetCreateForm, loadUsers]);

  const handleUpdateUser = useCallback(async () => {
    const errors: typeof editFormErrors = {};
    if (!editFormName.trim()) errors.name = 'Name is required.';
    if (!editFormUsername.trim()) errors.username = 'Username is required.';
    if (!editFormUserType) errors.userType = 'Please select a user type.';
    if (!editFormDepartment.trim()) errors.department = 'Department is required.';
    setEditFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (!editUserId) return;

    try {
      setEditSubmitting(true);
      await updateUser(editUserId, {
        name: editFormName.trim(),
        username: editFormUsername.trim(),
        userType: editFormUserType,
        department: editFormDepartment.trim(),
      });
      toast('User updated successfully.', 'success');
      setEditModalOpen(false);
      resetEditForm();
      await loadUsers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update user', 'error');
    } finally {
      setEditSubmitting(false);
    }
  }, [editUserId, editFormName, editFormUsername, editFormUserType, editFormDepartment, toast, resetEditForm, loadUsers]);

  const handleDeleteUser = useCallback(
    async (user: AppUser) => {
      const confirmed = await confirm({
        title: 'Delete User',
        message: `Are you sure you want to delete "${user.name}"? This action cannot be undone.`,
        type: 'danger',
      });

      if (confirmed) {
        try {
          await deleteUser(user.id);
          toast(`"${user.name}" has been deleted.`, 'success');
          await loadUsers();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed to delete user', 'error');
        }
      }
    },
    [confirm, toast, loadUsers],
  );

  const handleChangePassword = useCallback(async () => {
    if (!newPassword) {
      toast('Please enter or generate a password.', 'error');
      return;
    }
    if (newPassword.length < 8) {
      toast('Password must be at least 8 characters.', 'error');
      return;
    }
    if (!passwordTargetUserId) return;

    try {
      await changeUserPassword(passwordTargetUserId, newPassword);
      setPasswordModalOpen(false);
      setPasswordTargetUserId(null);
      setNewPassword('');
      toast('Password has been updated successfully.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to change password', 'error');
    }
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
          Add New User
        </button>
      </div>

      {/* ── Loading state ───────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-brand-teal" />
          <span className="ml-3 text-sm text-zinc-500">Loading users…</span>
        </div>
      )}

      {/* ── Error state ─────────────────────────────────────── */}
      {!loading && error && (
        <div className="rounded-2xl bg-red-50 p-6 text-center shadow-brand">
          <p className="text-sm font-medium text-red-700">{error}</p>
          <button
            onClick={loadUsers}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Users table (Desktop) ───────────────────────────── */}
      {!loading && !error && (
        <>
          {/* Desktop table */}
          <div className="hidden md:overflow-hidden md:block rounded-2xl bg-white shadow-brand">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-brand-cream">
                    <th className="px-6 py-3.5 font-semibold text-brand-teal">Name</th>
                    <th className="px-6 py-3.5 font-semibold text-brand-teal">Username</th>
                    <th className="px-6 py-3.5 font-semibold text-brand-teal">Department</th>
                    <th className="px-6 py-3.5 font-semibold text-brand-teal">User Type</th>
                    <th className="px-6 py-3.5 font-semibold text-brand-teal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {/* ── Empty state ────────────────────────────── */}
                  {users.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-6 py-16 text-center text-zinc-400"
                      >
                        No users found. Click <strong>Add New User</strong> to create one.
                      </td>
                    </tr>
                  )}

                  {/* ── Rows ───────────────────────────────────── */}
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
                      <td className="px-6 py-4 text-zinc-600">{user.username}</td>
                      <td className="px-6 py-4 text-zinc-600">{user.department}</td>
                      <td className="px-6 py-4">
                        <UserTypeBadge type={user.userType} />
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
                            onClick={() => openPasswordModal(user.id)}
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

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {users.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-2xl bg-white px-6 py-16 text-center shadow-brand">
                <p className="text-base font-medium text-zinc-600">No users found</p>
                <p className="mt-1 text-sm text-zinc-400">
                  Tap <strong>Add New User</strong> to create one.
                </p>
              </div>
            )}
            {users.map((user) => (
              <div key={user.id} className="rounded-2xl bg-white shadow-brand overflow-hidden">
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-zinc-900 truncate">{user.name}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">@{user.username}</p>
                    </div>
                    <UserTypeBadge type={user.userType} />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Department</span>
                    <span className="font-medium text-zinc-700">{user.department}</span>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 border-t border-zinc-100 px-5 py-3">
                  <button
                    onClick={() => openEditModal(user)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-sm font-medium text-brand-teal hover:bg-brand-moss/30 min-h-[44px]"
                  >
                    <Pencil className="size-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => openPasswordModal(user.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-sm font-medium text-brand-sage hover:bg-brand-moss/30 min-h-[44px]"
                  >
                    <KeyRound className="size-4" />
                    Password
                  </button>
                  <button
                    onClick={() => handleDeleteUser(user)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50 min-h-[44px]"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      

      {/* ── Create User Modal ────────────────────────────────── */}
      {createModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center overflow-y-auto">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setCreateModalOpen(false);
              resetCreateForm();
            }}
          />

          <div className="relative z-10 w-full max-w-lg min-h-screen sm:min-h-0">
            <div className="rounded-none sm:rounded-2xl bg-white p-6 shadow-brand-xl min-h-screen sm:min-h-0">
              {/* Header */}
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-brand-teal">
                  Add New User
                </h2>
                <button
                  onClick={() => {
                    setCreateModalOpen(false);
                    resetCreateForm();
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
                    <p className="mt-1 text-xs text-red-500">{formErrors.name}</p>
                  )}
                </div>

                {/* Username */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    Username <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    placeholder="Username"
                    className={cn(
                      'w-full rounded-xl border-0 ring-1 px-3.5 py-2.5 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                      formErrors.username
                        ? 'ring-red-400 bg-red-50'
                        : 'ring-brand-sage bg-white hover:ring-brand-teal',
                    )}
                  />
                  {formErrors.username && (
                    <p className="mt-1 text-xs text-red-500">{formErrors.username}</p>
                  )}
                </div>

                {/* Password */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    Password <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className={cn(
                      'w-full rounded-xl border-0 ring-1 px-3.5 py-2.5 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                      formErrors.password
                        ? 'ring-red-400 bg-red-50'
                        : 'ring-brand-sage bg-white hover:ring-brand-teal',
                    )}
                  />
                  {formErrors.password && (
                    <p className="mt-1 text-xs text-red-500">{formErrors.password}</p>
                  )}
                </div>

                {/* User Type */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    User Type <span className="text-red-400">*</span>
                  </label>
                  <DropdownSelect
                    options={USER_TYPE_OPTIONS}
                    value={formUserType}
                    onChange={setFormUserType}
                    placeholder="Select a user type"
                    error={formErrors.userType}
                  />
                  {formErrors.userType && (
                    <p className="mt-1 text-xs text-red-500">{formErrors.userType}</p>
                  )}
                </div>

                {/* Department */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    Department <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formDepartment}
                    onChange={(e) => setFormDepartment(e.target.value)}
                    placeholder="e.g. IT, HR, Finance"
                    className={cn(
                      'w-full rounded-xl border-0 ring-1 px-3.5 py-2.5 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                      formErrors.department
                        ? 'ring-red-400 bg-red-50'
                        : 'ring-brand-sage bg-white hover:ring-brand-teal',
                    )}
                  />
                  {formErrors.department && (
                    <p className="mt-1 text-xs text-red-500">{formErrors.department}</p>
                  )}
                </div>
              </div>

              {/* Footer buttons */}
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => {
                    setCreateModalOpen(false);
                    resetCreateForm();
                  }}
                  className="flex-1 rounded-xl ring-1 ring-brand-sage bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-brand-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateUser}
                  disabled={submitting}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  Create User
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit User Modal ─────────────────────────────────────── */}
      {editModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center overflow-y-auto">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setEditModalOpen(false);
              resetEditForm();
            }}
          />

          <div className="relative z-10 w-full max-w-lg min-h-screen sm:min-h-0">
            <div className="rounded-none sm:rounded-2xl bg-white p-6 shadow-brand-xl min-h-screen sm:min-h-0">
              {/* Header */}
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-brand-teal">
                  Edit User
                </h2>
                <button
                  onClick={() => {
                    setEditModalOpen(false);
                    resetEditForm();
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
                    value={editFormName}
                    onChange={(e) => setEditFormName(e.target.value)}
                    placeholder="Full name"
                    className={cn(
                      'w-full rounded-xl border-0 ring-1 px-3.5 py-2.5 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                      editFormErrors.name
                        ? 'ring-red-400 bg-red-50'
                        : 'ring-brand-sage bg-white hover:ring-brand-teal',
                    )}
                  />
                  {editFormErrors.name && (
                    <p className="mt-1 text-xs text-red-500">{editFormErrors.name}</p>
                  )}
                </div>

                {/* Username */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    Username <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={editFormUsername}
                    onChange={(e) => setEditFormUsername(e.target.value)}
                    placeholder="Username"
                    className={cn(
                      'w-full rounded-xl border-0 ring-1 px-3.5 py-2.5 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                      editFormErrors.username
                        ? 'ring-red-400 bg-red-50'
                        : 'ring-brand-sage bg-white hover:ring-brand-teal',
                    )}
                  />
                  {editFormErrors.username && (
                    <p className="mt-1 text-xs text-red-500">{editFormErrors.username}</p>
                  )}
                </div>

                {/* User Type */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    User Type <span className="text-red-400">*</span>
                  </label>
                  <DropdownSelect
                    options={USER_TYPE_OPTIONS}
                    value={editFormUserType}
                    onChange={setEditFormUserType}
                    placeholder="Select a user type"
                    error={editFormErrors.userType}
                  />
                  {editFormErrors.userType && (
                    <p className="mt-1 text-xs text-red-500">{editFormErrors.userType}</p>
                  )}
                </div>

                {/* Department */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    Department <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={editFormDepartment}
                    onChange={(e) => setEditFormDepartment(e.target.value)}
                    placeholder="e.g. IT, HR, Finance"
                    className={cn(
                      'w-full rounded-xl border-0 ring-1 px-3.5 py-2.5 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                      editFormErrors.department
                        ? 'ring-red-400 bg-red-50'
                        : 'ring-brand-sage bg-white hover:ring-brand-teal',
                    )}
                  />
                  {editFormErrors.department && (
                    <p className="mt-1 text-xs text-red-500">{editFormErrors.department}</p>
                  )}
                </div>
              </div>

              {/* Footer buttons */}
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => {
                    setEditModalOpen(false);
                    resetEditForm();
                  }}
                  className="flex-1 rounded-xl ring-1 ring-brand-sage bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-brand-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateUser}
                  disabled={editSubmitting}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {editSubmitting && <Loader2 className="size-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Password Modal ──────────────────────────────── */}
      {passwordModalOpen && passwordModalUser && (
        <div className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center overflow-y-auto">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setPasswordModalOpen(false);
              setNewPassword('');
            }}
          />

          <div className="relative z-10 w-full max-w-md min-h-screen sm:min-h-0">
            <div className="rounded-none sm:rounded-2xl bg-white p-6 shadow-brand-xl min-h-screen sm:min-h-0">
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