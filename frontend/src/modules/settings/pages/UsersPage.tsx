import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import { formatDateManila } from '@/shared/lib/date-utils';
import {
  tableContainerClass,
  tableClass,
  tableHeaderClass,
  tableHeaderCellClass,
  tableRowClass,
  tableCellClass,
  tableEmptyCellClass,
} from '@/shared/styles/table-constants';
import type { AppUser } from '@car-tracker/shared';
import {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  changeUserPassword,
} from '../api/users-api';
import {
  Pencil,
  X,
  Eye,
  EyeOff,
  Copy,
  Check,
  Trash2,
  KeyRound,
  Loader2,
  AlertTriangle,
  RefreshCw,
  UserPlus,
  User,
  Shield,
  FileText,
  Lock,
  CheckCircle2,
  XCircle,
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
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', style.bg, style.text)}>
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

function DropdownSelect({ options, value, onChange, placeholder = 'Select...', error }: DropdownSelectProps) {
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
          error ? 'ring-red-400 bg-red-50 text-red-700' : 'ring-brand-sage bg-white text-zinc-900 hover:ring-brand-teal',
        )}
      >
        <span className={value ? '' : 'text-zinc-400'}>{selectedLabel ?? placeholder}</span>
        <svg className={cn('size-4 transition-transform', open && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl ring-1 ring-brand-sage bg-white py-1 shadow-brand">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onMouseDown={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                'flex w-full items-center px-3.5 py-2 text-left text-sm transition-colors',
                opt.value === value ? 'bg-brand-moss font-medium text-zinc-900' : 'text-zinc-700 hover:bg-brand-cream',
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
  const remaining = Array.from({ length: 8 }, () => all[Math.floor(Math.random() * all.length)]);
  return [...required, ...remaining].sort(() => Math.random() - 0.5).join('');
}

// ── Password Strength & Requirements ──────────────────────────

interface PasswordChecks {
  minLength: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
}

function checkPassword(password: string): PasswordChecks {
  return {
    minLength: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*()\-_=+{}[\]|;:'",.<>/?`~]/.test(password),
  };
}

function getPasswordStrength(password: string): { level: 'none' | 'weak' | 'fair' | 'good' | 'strong'; score: number; color: string; label: string } {
  if (!password) return { level: 'none', score: 0, color: 'bg-zinc-200', label: '' };
  const checks = checkPassword(password);
  const passed = Object.values(checks).filter(Boolean).length;
  const score = (passed / 5) * 100;
  if (score <= 20) return { level: 'weak', score, color: 'bg-red-500', label: 'Weak' };
  if (score <= 40) return { level: 'fair', score, color: 'bg-orange-500', label: 'Fair' };
  if (score <= 60) return { level: 'good', score, color: 'bg-yellow-500', label: 'Good' };
  return { level: 'strong', score, color: 'bg-emerald-500', label: 'Strong' };
}

const PASSWORD_REQUIREMENTS: { key: keyof PasswordChecks; label: string }[] = [
  { key: 'minLength', label: 'Minimum 8 characters' },
  { key: 'uppercase', label: 'Uppercase letter' },
  { key: 'lowercase', label: 'Lowercase letter' },
  { key: 'number', label: 'Number' },
  { key: 'special', label: 'Special character' },
];

// ── Validation ─────────────────────────────────────────────────

interface ValidationErrors {
  name?: string;
  username?: string;
  password?: string;
  userType?: string;
  department?: string;
}

function validateUserForm(data: { name: string; username: string; password: string; userType: string; department: string }): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!data.name.trim()) errors.name = 'Name is required.';
  if (!data.username.trim()) errors.username = 'Username is required.';
  if (!data.password) errors.password = 'Password is required.';
  else if (data.password.length < 8) errors.password = 'Password must be at least 8 characters.';
  if (!data.userType) errors.userType = 'Please select a user type.';
  if (!data.department.trim()) errors.department = 'Department is required.';
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

const DEPARTMENT_OPTIONS: DropdownOption[] = [
  { value: 'IT', label: 'IT' },
  { value: 'HR', label: 'HR' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Operations', label: 'Operations' },
  { value: 'Logistics', label: 'Logistics' },
  { value: 'Management', label: 'Management' },
  { value: 'Admin', label: 'Admin' },
];

// ── Component ──────────────────────────────────────────────────

export interface UsersPageHandle {
  openCreateModal: () => void;
}

export const UsersPage = forwardRef<UsersPageHandle, object>(function UsersPage(_props, ref) {
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
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [editFormName, setEditFormName] = useState('');
  const [editFormUsername, setEditFormUsername] = useState('');
  const [editFormUserType, setEditFormUserType] = useState('');
  const [editFormDepartment, setEditFormDepartment] = useState('');
  const [editFormErrors, setEditFormErrors] = useState<Pick<ValidationErrors, 'name' | 'username' | 'userType' | 'department'>>({});
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Password modal
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordTargetUser, setPasswordTargetUser] = useState<AppUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

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

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // ── Helpers ────────────────────────────────────────────────

  const resetCreateForm = useCallback(() => {
    setFormName(''); setFormUsername(''); setFormPassword(''); setFormUserType(''); setFormDepartment(''); setFormErrors({});
  }, []);

  const openCreateModal = useCallback(() => { resetCreateForm(); setCreateModalOpen(true); }, [resetCreateForm]);

  const openPasswordModal = useCallback((user: AppUser) => {
    setPasswordTargetUser(user);
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setPasswordCopied(false);
    setPasswordModalOpen(true);
  }, []);

  const openEditModal = useCallback((user: AppUser) => {
    setEditUser(user);
    setEditFormName(user.name);
    setEditFormUsername(user.username);
    setEditFormUserType(user.userType);
    setEditFormDepartment(user.department);
    setEditFormErrors({});
    setEditModalOpen(true);
  }, []);

  const resetEditForm = useCallback(() => {
    setEditUser(null); setEditFormName(''); setEditFormUsername(''); setEditFormUserType(''); setEditFormDepartment(''); setEditFormErrors({});
  }, []);

  // ── Handlers ──────────────────────────────────────────────

  const handleCreateUser = useCallback(async () => {
    const errors = validateUserForm({ name: formName, username: formUsername, password: formPassword, userType: formUserType, department: formDepartment });
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    try {
      setSubmitting(true);
      await createUser({ name: formName.trim(), username: formUsername.trim(), password: formPassword, userType: formUserType, department: formDepartment.trim() });
      toast('User created successfully.', 'success');
      setCreateModalOpen(false);
      resetCreateForm();
      await loadUsers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create user', 'error');
    } finally { setSubmitting(false); }
  }, [formName, formUsername, formPassword, formUserType, formDepartment, toast, resetCreateForm, loadUsers]);

  const handleUpdateUser = useCallback(async () => {
    const errors: typeof editFormErrors = {};
    if (!editFormName.trim()) errors.name = 'Name is required.';
    if (!editFormUsername.trim()) errors.username = 'Username is required.';
    if (!editFormUserType) errors.userType = 'Please select a user type.';
    if (!editFormDepartment.trim()) errors.department = 'Department is required.';
    setEditFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (!editUser) return;
    try {
      setEditSubmitting(true);
      await updateUser(editUser.id, { name: editFormName.trim(), username: editFormUsername.trim(), userType: editFormUserType, department: editFormDepartment.trim() });
      toast('User updated successfully.', 'success');
      setEditModalOpen(false);
      resetEditForm();
      await loadUsers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update user', 'error');
    } finally { setEditSubmitting(false); }
  }, [editUser, editFormName, editFormUsername, editFormUserType, editFormDepartment, toast, resetEditForm, loadUsers]);

  const handleDeleteUser = useCallback(async (user: AppUser) => {
    const confirmed = await confirm({ title: 'Delete User', message: `Are you sure you want to delete "${user.name}"? This action cannot be undone.`, type: 'danger' });
    if (confirmed) {
      try {
        await deleteUser(user.id);
        toast(`"${user.name}" has been deleted.`, 'success');
        await loadUsers();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to delete user', 'error');
      }
    }
  }, [confirm, toast, loadUsers]);

  const handleChangePassword = useCallback(async () => {
    if (!newPassword) { toast('Please enter or generate a password.', 'error'); return; }
    if (newPassword.length < 8) { toast('Password must be at least 8 characters.', 'error'); return; }
    if (newPassword !== confirmPassword) { toast('Passwords do not match.', 'error'); return; }
    if (!passwordTargetUser) return;
    try {
      setPasswordSubmitting(true);
      await changeUserPassword(passwordTargetUser.id, newPassword);
      setPasswordModalOpen(false);
      setPasswordTargetUser(null);
      setNewPassword('');
      toast('Password has been updated successfully.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to change password', 'error');
    } finally { setPasswordSubmitting(false); }
  }, [newPassword, confirmPassword, passwordTargetUser, toast]);

  const handleGeneratePassword = useCallback(() => {
    const pwd = generatePassword();
    setNewPassword(pwd);
    setConfirmPassword(pwd);
    setPasswordCopied(false);
  }, []);

  const handleCopyPassword = useCallback(async () => {
    if (!newPassword) return;
    try {
      await navigator.clipboard.writeText(newPassword);
      setPasswordCopied(true);
      setTimeout(() => setPasswordCopied(false), 2000);
    } catch { toast('Failed to copy password.', 'error'); }
  }, [newPassword, toast]);

  useImperativeHandle(ref, () => ({ openCreateModal }));

  // ── Password checks (live) ─────────────────────────────────

  const passwordChecks = checkPassword(newPassword);
  const passwordStrength = getPasswordStrength(newPassword);
  const passwordsMatch = confirmPassword ? newPassword === confirmPassword : true;
  const passwordsMatchError = confirmPassword && !passwordsMatch ? 'Passwords do not match.' : null;

  // ── Render ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-100 bg-white p-6 shadow-brand">
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-brand-teal" />
          <span className="ml-3 text-sm text-zinc-500">Loading users...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-100 bg-white p-6 shadow-brand">
        <div className="text-center py-10">
          <AlertTriangle className="size-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-zinc-700">Unable to load users</p>
          <p className="text-xs text-zinc-400 mt-1 mb-4">Please refresh or check backend connection.</p>
          <button onClick={loadUsers} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80">
            <RefreshCw className="size-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Desktop table */}
      <div className={cn(tableContainerClass, 'hidden md:block')}>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead>
              <tr className={tableHeaderClass}>
                <th className={tableHeaderCellClass}>Name</th>
                <th className={tableHeaderCellClass}>Username</th>
                <th className={tableHeaderCellClass}>Department</th>
                <th className={tableHeaderCellClass}>User Type</th>
                <th className={tableHeaderCellClass}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr><td colSpan={5} className={tableEmptyCellClass}><p className="text-sm text-zinc-400">No users found.</p><p className="text-xs text-zinc-300 mt-1">Click <strong>Add New User</strong> to create one.</p></td></tr>
              )}
              {users.map((user) => (
                <tr key={user.id} className={tableRowClass}>
                  <td className={tableCellClass}>{user.name}</td>
                  <td className={tableCellClass}>{user.username}</td>
                  <td className={tableCellClass}>{user.department}</td>
                  <td className={tableCellClass}><UserTypeBadge type={user.userType} /></td>
                  <td className={tableCellClass}>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEditModal(user)} className="rounded-lg p-1.5 text-brand-teal transition-colors hover:bg-brand-teal/10" aria-label={`Edit ${user.name}`} title="Edit user"><Pencil className="size-3.5" /></button>
                      <button onClick={() => openPasswordModal(user)} className="rounded-lg p-1.5 text-brand-sage transition-colors hover:bg-brand-sage/10" aria-label={`Change password for ${user.name}`} title="Change password"><KeyRound className="size-3.5" /></button>
                      <button onClick={() => handleDeleteUser(user)} className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50" aria-label={`Delete ${user.name}`} title="Delete user"><Trash2 className="size-3.5" /></button>
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
          <div className="rounded-xl border border-zinc-100 bg-white p-6 shadow-brand text-center">
            <p className="text-sm text-zinc-400">No users found.</p>
            <p className="text-xs text-zinc-300 mt-1">Tap <strong>Add New User</strong> to create one.</p>
          </div>
        )}
        {users.map((user) => (
          <div key={user.id} className="rounded-xl border border-zinc-100 bg-white shadow-brand overflow-hidden">
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900 truncate">{user.name}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">@{user.username}</p>
                </div>
                <UserTypeBadge type={user.userType} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Department</span>
                <span className="font-medium text-zinc-700">{user.department}</span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-1 border-t border-zinc-100 px-4 py-2">
              <button onClick={() => openEditModal(user)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-brand-teal hover:bg-brand-teal/10"><Pencil className="size-3.5" /> Edit</button>
              <button onClick={() => openPasswordModal(user)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-brand-sage hover:bg-brand-sage/10"><KeyRound className="size-3.5" /> Password</button>
              <button onClick={() => handleDeleteUser(user)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50"><Trash2 className="size-3.5" /> Delete</button>
            </div>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════
         CREATE USER MODAL — Upgraded
         ═══════════════════════════════════════════════════════════ */}
      {createModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-brand">
            {/* Header */}
            <header className="flex shrink-0 items-start justify-between border-b border-zinc-100 px-6 py-4">
              <div className="flex items-center gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-teal/10">
                  <UserPlus className="size-6 text-brand-teal" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900">Create New User</h2>
                  <p className="text-sm text-zinc-500 mt-0.5">Add a new user account and assign role permissions.</p>
                </div>
              </div>
              <button onClick={() => { setCreateModalOpen(false); resetCreateForm(); }} className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600" aria-label="Close"><X className="size-5" /></button>
            </header>

            {/* Body */}
            <form className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                <div className="space-y-3">
                {/* ── Card 1: Basic Information ── */}
                  <div className="rounded-xl border border-zinc-100 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <User className="size-4 text-brand-teal" />
                      <h3 className="text-sm font-semibold text-zinc-800">Basic Information</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-zinc-700">Full Name <span className="text-red-400">*</span></label>
                        <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Full name" className={cn('w-full rounded-xl border-0 ring-1 px-3.5 py-2 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal', formErrors.name ? 'ring-red-400 bg-red-50' : 'ring-brand-sage bg-white hover:ring-brand-teal')} />
                        {formErrors.name && <p className="mt-1 text-xs text-red-500">{formErrors.name}</p>}
                        <p className="text-xs text-zinc-400 mt-1">Used for display and communications.</p>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-zinc-700">Username <span className="text-red-400">*</span></label>
                        <input type="text" value={formUsername} onChange={(e) => setFormUsername(e.target.value)} placeholder="Username" className={cn('w-full rounded-xl border-0 ring-1 px-3.5 py-2 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal', formErrors.username ? 'ring-red-400 bg-red-50' : 'ring-brand-sage bg-white hover:ring-brand-teal')} />
                        {formErrors.username && <p className="mt-1 text-xs text-red-500">{formErrors.username}</p>}
                        <p className="text-xs text-zinc-400 mt-1">Used for login.</p>
                      </div>
                    </div>
                  </div>

                  {/* ── Card 2: Account Setup ── */}
                  <div className="rounded-xl border border-zinc-100 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Lock className="size-4 text-brand-teal" />
                      <h3 className="text-sm font-semibold text-zinc-800">Account Setup</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-zinc-700">Role <span className="text-red-400">*</span></label>
                        <DropdownSelect options={USER_TYPE_OPTIONS} value={formUserType} onChange={setFormUserType} placeholder="Select a role" error={formErrors.userType} />
                        {formErrors.userType && <p className="mt-1 text-xs text-red-500">{formErrors.userType}</p>}
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-zinc-700">Department <span className="text-red-400">*</span></label>
                        <input type="text" value={formDepartment} onChange={(e) => setFormDepartment(e.target.value)} placeholder="e.g. IT, HR, Finance" className={cn('w-full rounded-xl border-0 ring-1 px-3.5 py-2 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal', formErrors.department ? 'ring-red-400 bg-red-50' : 'ring-brand-sage bg-white hover:ring-brand-teal')} />
                        {formErrors.department && <p className="mt-1 text-xs text-red-500">{formErrors.department}</p>}
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-sm font-medium text-zinc-700">Temporary Password <span className="text-red-400">*</span></label>
                        <input type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="Min. 8 characters" className={cn('w-full rounded-xl border-0 ring-1 px-3.5 py-2 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal', formErrors.password ? 'ring-red-400 bg-red-50' : 'ring-brand-sage bg-white hover:ring-brand-teal')} />
                        {formErrors.password && <p className="mt-1 text-xs text-red-500">{formErrors.password}</p>}
                        <p className="text-xs text-zinc-400 mt-1">Used for the first login. User will be prompted to change it.</p>
                      </div>
                    </div>
                  </div>

                  {/* ── Card 3: Permissions ── */}
                  <div className="rounded-xl border border-zinc-100 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Shield className="size-4 text-brand-teal" />
                      <h3 className="text-sm font-semibold text-zinc-800">Permissions</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {USER_TYPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setFormUserType(opt.value)}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 border',
                            formUserType === opt.value
                              ? 'bg-brand-teal/10 text-brand-teal border-brand-teal/30'
                              : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300 hover:text-zinc-700',
                          )}
                        >
                          {formUserType === opt.value ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3 opacity-0" />}
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-zinc-400 mt-2">Choose a role to set permissions.</p>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <footer className="flex shrink-0 justify-end gap-3 border-t border-zinc-100 bg-white px-6 py-4">
                <button type="button" onClick={() => { setCreateModalOpen(false); resetCreateForm(); }} className="rounded-xl ring-1 ring-zinc-200 bg-white px-5 h-10 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal">
                  Cancel
                </button>
                <button type="button" onClick={handleCreateUser} disabled={submitting} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 h-10 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed">
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  Create User
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
         EDIT USER MODAL — Upgraded
         ═══════════════════════════════════════════════════════════ */}
      {editModalOpen && editUser && (
        <div className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center overflow-y-auto">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setEditModalOpen(false); resetEditForm(); }} />
          <div className="relative z-10 min-h-dvh w-full max-w-2xl sm:min-h-0">
            <div className="flex min-h-dvh flex-col bg-white shadow-brand-xl sm:min-h-0 sm:rounded-2xl">
              {/* Scrollable body */}
              <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
                {/* ── Header ── */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-teal/10">
                      <User className="size-7 text-brand-teal" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-zinc-900">{editUser.name}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        <UserTypeBadge type={editUser.userType} />
                        <span className="text-xs text-zinc-400">Last updated: {formatDateManila(new Date().toISOString())}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => { setEditModalOpen(false); resetEditForm(); }} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600" aria-label="Close"><X className="size-5" /></button>
                </div>

                <div className="border-t border-zinc-100" />

                {/* ── Card 1: Basic Information ── */}
                <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-brand">
                  <div className="flex items-center gap-2 mb-4">
                    <User className="size-4 text-brand-teal" />
                    <h3 className="text-sm font-semibold text-zinc-800">Basic Information</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-zinc-700">Full Name <span className="text-red-400">*</span></label>
                      <input type="text" value={editFormName} onChange={(e) => setEditFormName(e.target.value)} placeholder="Full name" className={cn('w-full rounded-xl border-0 ring-1 px-3.5 py-2.5 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal', editFormErrors.name ? 'ring-red-400 bg-red-50' : 'ring-brand-sage bg-white hover:ring-brand-teal')} />
                      {editFormErrors.name && <p className="mt-1 text-xs text-red-500">{editFormErrors.name}</p>}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-zinc-700">Username <span className="text-red-400">*</span></label>
                      <input type="text" value={editFormUsername} onChange={(e) => setEditFormUsername(e.target.value)} placeholder="Username" className={cn('w-full rounded-xl border-0 ring-1 px-3.5 py-2.5 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal', editFormErrors.username ? 'ring-red-400 bg-red-50' : 'ring-brand-sage bg-white hover:ring-brand-teal')} />
                      {editFormErrors.username && <p className="mt-1 text-xs text-red-500">{editFormErrors.username}</p>}
                    </div>
                  </div>
                </div>

                {/* ── Card 2: Account Information ── */}
                <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-brand">
                  <div className="flex items-center gap-2 mb-4">
                    <Lock className="size-4 text-brand-teal" />
                    <h3 className="text-sm font-semibold text-zinc-800">Account</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-zinc-700">Role <span className="text-red-400">*</span></label>
                      <DropdownSelect options={USER_TYPE_OPTIONS} value={editFormUserType} onChange={setEditFormUserType} placeholder="Select a role" error={editFormErrors.userType} />
                      {editFormErrors.userType && <p className="mt-1 text-xs text-red-500">{editFormErrors.userType}</p>}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-zinc-700">Department <span className="text-red-400">*</span></label>
                      <DropdownSelect options={DEPARTMENT_OPTIONS} value={editFormDepartment} onChange={setEditFormDepartment} placeholder="Select a department" error={editFormErrors.department} />
                      {editFormErrors.department && <p className="mt-1 text-xs text-red-500">{editFormErrors.department}</p>}
                    </div>
                  </div>
                </div>

                {/* ── Card 3: Permissions ── */}
                <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-brand">
                  <div className="flex items-center gap-2 mb-4">
                    <Shield className="size-4 text-brand-teal" />
                    <h3 className="text-sm font-semibold text-zinc-800">Permissions</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {USER_TYPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setEditFormUserType(opt.value)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 border',
                          editFormUserType === opt.value
                            ? 'bg-brand-teal/10 text-brand-teal border-brand-teal/30'
                            : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300 hover:text-zinc-700',
                        )}
                      >
                        {editFormUserType === opt.value ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3 opacity-0" />}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-400 mt-2">Select a role to set permissions.</p>
                </div>

                {/* ── Card 4: Notes ── */}
                <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-brand">
                  <div className="flex items-center gap-2 mb-4">
                    <FileText className="size-4 text-brand-teal" />
                    <h3 className="text-sm font-semibold text-zinc-800">Notes</h3>
                  </div>
                  <textarea
                    placeholder="Internal notes (optional)"
                    rows={3}
                    className="w-full rounded-xl border-0 ring-1 ring-brand-sage bg-white px-3.5 py-2.5 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal hover:ring-brand-teal resize-none"
                  />
                </div>
              </div>

              {/* ── Sticky Footer ── */}
              <div className="sticky bottom-0 border-t border-zinc-100 bg-white p-4 flex items-center justify-end gap-3 rounded-b-none sm:rounded-b-2xl">
                <button onClick={() => { setEditModalOpen(false); resetEditForm(); }} className="rounded-xl ring-1 ring-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal">
                  Cancel
                </button>
                <button onClick={handleUpdateUser} disabled={editSubmitting} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed">
                  {editSubmitting && <Loader2 className="size-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
         CHANGE PASSWORD MODAL — Upgraded
         ═══════════════════════════════════════════════════════════ */}
      {passwordModalOpen && passwordTargetUser && (
        <div className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center overflow-y-auto">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setPasswordModalOpen(false); setNewPassword(''); }} />
          <div className="relative z-10 min-h-dvh w-full max-w-2xl sm:min-h-0">
            <div className="flex min-h-dvh flex-col bg-white shadow-brand-xl sm:min-h-0 sm:rounded-2xl">
              {/* Scrollable body */}
              <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
                {/* ── Header ── */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-amber-100">
                      <KeyRound className="size-7 text-amber-600" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-zinc-900">Change Password</h2>
                      <p className="text-sm text-zinc-500 mt-0.5">{passwordTargetUser.name}</p>
                    </div>
                  </div>
                  <button onClick={() => { setPasswordModalOpen(false); setNewPassword(''); }} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600" aria-label="Close"><X className="size-5" /></button>
                </div>

                <div className="border-t border-zinc-100" />

                {/* ── Password Fields Card ── */}
                <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-brand">
                  <div className="flex items-center gap-2 mb-4">
                    <Lock className="size-4 text-amber-500" />
                    <h3 className="text-sm font-semibold text-zinc-800">Password Fields</h3>
                  </div>
                  <div className="space-y-4">
                    {/* New Password */}
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-zinc-700">New Password</label>
                      <div className="relative">
                        <input type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setPasswordCopied(false); }} placeholder="Enter new password" className="w-full rounded-xl border-0 ring-1 ring-brand-sage bg-white px-3.5 py-2.5 pr-10 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal hover:ring-brand-teal" />
                        <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors" aria-label={showNewPassword ? 'Hide password' : 'Show password'}>
                          {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Confirm Password */}
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-zinc-700">Confirm Password</label>
                      <div className="relative">
                        <input type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" className={cn('w-full rounded-xl border-0 ring-1 px-3.5 py-2.5 pr-10 text-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal', passwordsMatchError ? 'ring-red-400 bg-red-50' : 'ring-brand-sage bg-white hover:ring-brand-teal')} />
                        <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors" aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}>
                          {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                      {passwordsMatchError && <p className="mt-1 text-xs text-red-500">{passwordsMatchError}</p>}
                    </div>
                  </div>
                </div>

                {/* ── Password Strength Card ── */}
                {newPassword && (
                  <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-brand transition-all duration-200">
                    <div className="flex items-center gap-2 mb-4">
                      <Shield className="size-4 text-amber-500" />
                      <h3 className="text-sm font-semibold text-zinc-800">Password Strength</h3>
                    </div>
                    {/* Strength bar */}
                    <div className="h-2 rounded-full bg-zinc-100 overflow-hidden mb-2">
                      <div className={cn('h-full rounded-full transition-all duration-300', passwordStrength.color)} style={{ width: `${passwordStrength.score}%` }} />
                    </div>
                    <p className={cn('text-xs font-medium', passwordStrength.level === 'strong' ? 'text-emerald-600' : passwordStrength.level === 'good' ? 'text-yellow-600' : passwordStrength.level === 'fair' ? 'text-orange-600' : 'text-red-600')}>
                      {passwordStrength.label}
                    </p>
                  </div>
                )}

                {/* ── Password Requirements Card ── */}
                <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-brand">
                  <div className="flex items-center gap-2 mb-4">
                    <CheckCircle2 className="size-4 text-amber-500" />
                    <h3 className="text-sm font-semibold text-zinc-800">Password Requirements</h3>
                  </div>
                  <div className="space-y-2">
                    {PASSWORD_REQUIREMENTS.map((req) => {
                      const satisfied = passwordChecks[req.key];
                      return (
                        <div key={req.key} className="flex items-center gap-2 text-sm">
                          {satisfied ? (
                            <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                          ) : (
                            <XCircle className="size-4 text-zinc-300 shrink-0" />
                          )}
                          <span className={satisfied ? 'text-emerald-700' : 'text-zinc-400'}>{req.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── Generate Password ── */}
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleGeneratePassword} className="inline-flex items-center gap-2 rounded-xl ring-1 ring-brand-sage bg-white px-3.5 py-2 text-sm font-medium text-brand-teal transition-colors hover:bg-brand-moss/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal">
                    <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                    </svg>
                    Generate Password
                  </button>
                  {newPassword && (
                    <button type="button" onClick={handleCopyPassword} className="inline-flex items-center gap-2 rounded-xl ring-1 ring-brand-sage bg-white px-3.5 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal">
                      {passwordCopied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                      {passwordCopied ? 'Copied!' : 'Copy'}
                    </button>
                  )}
                </div>
              </div>

              {/* ── Sticky Footer ── */}
              <div className="sticky bottom-0 border-t border-zinc-100 bg-white p-4 flex items-center justify-end gap-3 rounded-b-none sm:rounded-b-2xl">
                <button onClick={() => { setPasswordModalOpen(false); setNewPassword(''); }} className="rounded-xl ring-1 ring-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal">
                  Cancel
                </button>
                <button onClick={handleChangePassword} disabled={passwordSubmitting || !!passwordsMatchError || !newPassword} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed">
                  {passwordSubmitting && <Loader2 className="size-4 animate-spin" />}
                  Update Password
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
