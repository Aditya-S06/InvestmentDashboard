'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { apiFetch } from '@/lib/http/api-fetch';

export default function SecurityPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [secret, setSecret] = useState('');
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [recovery, setRecovery] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    apiFetch('/api/account/security').then(async response => {
      if (!response.ok) throw new Error('Could not load account security');
      const data = await response.json(); setEnabled(data.mfaEnabled); setRemaining(data.recoveryCodesRemaining);
    }).catch(() => setError('Could not load account security. Refresh or sign in again.'));
  }, []);
  async function act(action: string) {
    setBusy(true); setError('');
    try {
      const response = await apiFetch('/api/account/security', {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, password, code, newPassword, enrollmentCode, confirmation }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Account operation failed');
      setCode('');
      if (data.secret) setSecret(data.secret);
      if (data.recoveryCodes) {
        setRecovery(data.recoveryCodes); setSecret(''); setPassword(''); setNewPassword('');
      } else if (data.signedOut || data.deleted) await signOut({ callbackUrl: '/login' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Account operation failed'); }
    finally { setBusy(false); }
  }
  const input = 'block w-full mt-1 rounded border border-border bg-background p-2';
  const button = 'rounded border border-border px-3 py-2 text-sm hover:bg-secondary disabled:opacity-50';
  return <main className="mx-auto max-w-2xl p-6 space-y-6">
    <Link href="/dashboard" className="text-sm underline">Back to dashboard</Link>
    <h1 className="text-2xl font-semibold">Account security</h1>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {recovery.length ? <section className="space-y-4 rounded border border-border p-4">
      <h2 className="font-semibold">Save your recovery codes</h2>
      <p>These codes are shown only once. Store them in your password manager. Each code replaces one authenticator code and can be used once, together with your password.</p>
      <pre className="overflow-x-auto rounded bg-secondary p-3 text-sm">{recovery.join('\n')}</pre>
      <p>Your sessions have been signed out. Wait for a fresh authenticator code before signing in.</p>
      <button className={button} onClick={() => signOut({ callbackUrl: '/login' })}>I saved my codes — sign in</button>
    </section> : <>
      <section className="space-y-3 rounded border border-border p-4">
        <h2 className="font-semibold">Confirm your identity</h2>
        <p className="text-sm text-muted-foreground">Every change requires your current password and, when MFA is enabled, a fresh authenticator or unused recovery code.</p>
        <label className="block">Current password<input className={input} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        {enabled && <label className="block">Authenticator or recovery code<input className={input} autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} /></label>}
      </section>
      <fieldset disabled={busy || enabled === null || !password} className="space-y-6">
        <section className="space-y-3 rounded border border-border p-4">
          <h2 className="font-semibold">Authenticator app</h2>
          <p>{enabled === null ? 'Loading…' : enabled ? `Enabled · ${remaining} recovery codes remaining` : 'MFA is not enabled'}</p>
          {!enabled && !secret && <button className={button} onClick={() => act('mfa-begin')}>Set up MFA</button>}
          {secret && <>
            <p>Add a time-based account in your authenticator app using this setup key. Enrollment expires in 10 minutes.</p>
            <code className="block break-all rounded bg-secondary p-3">{secret}</code>
            <label className="block">New authenticator code<input className={input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={enrollmentCode} onChange={e => setEnrollmentCode(e.target.value)} /></label>
            <button className={button} onClick={() => act('mfa-confirm')}>Confirm and show recovery codes</button>
          </>}
          {enabled && <div className="flex flex-wrap gap-3">
            <button className={button} onClick={() => act('mfa-recovery')}>Replace recovery codes</button>
            <button className={button} onClick={() => act('mfa-disable')}>Disable MFA</button>
          </div>}
        </section>
        <section className="space-y-3 rounded border border-border p-4">
          <h2 className="font-semibold">Password and sessions</h2>
          <label className="block">New password<input className={input} type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
          <p className="text-sm text-muted-foreground">Use at least 12 characters (at most 72 UTF-8 bytes). Changing your password or MFA signs out all sessions.</p>
          <div className="flex flex-wrap gap-3"><button className={button} disabled={!newPassword} onClick={() => act('password')}>Change password</button>
          <button className={button} onClick={() => act('logout-all')}>Sign out all sessions</button></div>
        </section>
        <section className="space-y-3 rounded border border-destructive p-4">
          <h2 className="font-semibold">Delete account</h2>
          <p>Permanently deletes your app account, keys, saved data and local Desk artifacts. Resolve active Desk runs and broker orders first. External broker records and retained backups are not deleted.</p>
          <label className="block">Type DELETE to confirm<input className={input} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
          <button className={button} disabled={confirmation !== 'DELETE'} onClick={() => act('delete')}>Permanently delete account</button>
        </section>
      </fieldset>
    </>}
  </main>;
}
