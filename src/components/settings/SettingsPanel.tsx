'use client';

/**
 * Account, sync and data.
 *
 * The import/export controls stay here even without an account: they are how
 * the local-only mode has always moved notebooks between browsers, and an
 * account does not replace that.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  EmptyState,
  Field,
  Modal,
  Notice,
  Panel,
  Spinner,
  TextArea,
  TextInput,
} from '@/components/ui/controls';
import { useAuth } from '@/lib/client/auth';
import { downloadJson } from '@/lib/client/export';
import * as storage from '@/lib/client/storage';
import { useSync } from '@/lib/client/sync-context';

export function SettingsPanel() {
  const router = useRouter();
  const { status, user, profile, updateProfile, signOut } = useAuth();
  const {
    phase,
    pendingCount,
    lastSyncedAt,
    foreignCount,
    error: syncError,
    syncNow,
    mergeNow,
  } = useSync();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '');
    setBio(profile?.bio ?? '');
  }, [profile]);

  const saveProfile = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ display_name: displayName.trim(), bio: bio.trim() });
      setNote('Profile updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const exportAll = async () => {
    setError(null);
    try {
      const ids = storage.listNotebookIds();
      if (ids.length === 0) {
        setNote('There is nothing in this browser to export.');
        return;
      }
      const bundle = await storage.exportBundle(ids);
      downloadJson(bundle, `nb-make-all-${new Date().toISOString().slice(0, 10)}.json`);
      setNote(`Exported ${ids.length} notebook${ids.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    try {
      let imported = 0;
      for (const file of Array.from(files)) {
        const result = await storage.importBundle(JSON.parse(await file.text()));
        imported += result.imported.length;
      }
      setNote(
        imported === 0
          ? 'That file contained no readable notebooks.'
          : `Imported ${imported} notebook${imported === 1 ? '' : 's'}.`
      );
      // Imported notebooks are new to the server, so get them up there.
      if (status === 'signed-in') await syncNow();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? `Import failed: ${err.message}` : 'Not valid JSON.');
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  };

  /**
   * Clears this browser only. The account keeps its copies, which is exactly
   * what makes it safe to offer — signing back in pulls them down again.
   */
  const wipeLocal = () => {
    for (const id of storage.listNotebookIds()) storage.deleteNotebook(id);
    setConfirmWipe(false);
    setNote('Cleared this browser. Notebooks in your account are untouched.');
    router.refresh();
  };

  if (status === 'unconfigured') {
    return (
      <div className="w-full max-w-2xl px-5 py-6">
        <h1 className="mb-4 font-display text-[32px] leading-none text-ink-900">Settings</h1>
        <Notice tone="info">
          No Supabase project is configured, so there are no accounts on this deployment.
          Notebooks live in this browser.
        </Notice>
        <div className="mt-4">
          <LocalDataPanel
            onExport={exportAll}
            onImportClick={() => importInput.current?.click()}
            onWipe={() => setConfirmWipe(true)}
          />
        </div>
        <FilePicker inputRef={importInput} onFiles={importFiles} />
        <WipeModal open={confirmWipe} onClose={() => setConfirmWipe(false)} onConfirm={wipeLocal} signedIn={false} />
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-ink-500">
        <Spinner /> Loading…
      </div>
    );
  }

  if (status === 'signed-out') {
    return (
      <div className="px-5 py-8">
        <EmptyState
          title="Sign in to manage your account"
          description="You can still export and import notebooks without one — those controls live on the dashboard too."
          action={
            <Link href="/signin?next=%2Fsettings">
              <Button variant="primary">Sign in</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl px-5 py-6">
      <h1 className="mb-1 font-display text-[32px] leading-none text-ink-900">Settings</h1>
      <p className="mb-5 text-[13px] text-ink-500">{user?.email}</p>

      {note && (
        <div className="mb-4">
          <Notice tone="info">{note}</Notice>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <div className="space-y-4">
        <Panel title="Profile" description="Shown next to anything you publish.">
          <div className="space-y-3">
            <Field label="Display name">
              <TextInput
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
            <Field label="Bio" hint="Optional.">
              <TextArea rows={3} value={bio} onChange={(event) => setBio(event.target.value)} />
            </Field>
            <Button variant="primary" disabled={saving} onClick={() => void saveProfile()}>
              {saving && <Spinner />} Save profile
            </Button>
          </div>
        </Panel>

        <Panel
          title="Sync"
          description="Notebooks are written to this browser first, then mirrored to your account."
        >
          {syncError && (
            <div className="mb-3">
              <Notice tone="error">{syncError}</Notice>
            </div>
          )}
          <dl className="mb-3 space-y-1.5 text-[12px]">
            <div className="flex justify-between">
              <dt className="text-ink-400">Status</dt>
              <dd className="font-semibold text-ink-700">
                {phase === 'syncing'
                  ? 'Syncing…'
                  : phase === 'pending'
                    ? `${pendingCount} waiting`
                    : phase === 'error'
                      ? 'Failed'
                      : 'Up to date'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Last synced</dt>
              <dd className="font-semibold text-ink-700">
                {lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : 'not yet'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">In this browser</dt>
              <dd className="font-semibold text-ink-700">
                {storage.listNotebookIds().length} notebooks
              </dd>
            </div>
          </dl>

          {foreignCount > 0 && (
            <div className="mb-3">
              <Notice tone="info">
                {foreignCount} notebook{foreignCount === 1 ? '' : 's'} in this browser
                belong{foreignCount === 1 ? 's' : ''} to another account — probably from
                someone who used this browser before you. They are left alone and never
                uploaded. Use “Clear this browser” if you want them gone.
              </Notice>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void syncNow()} disabled={phase === 'syncing'}>
              {phase === 'syncing' && <Spinner />} Sync now
            </Button>
            <Button
              onClick={async () => {
                const report = await mergeNow();
                if (report) {
                  setNote(
                    `Merged: ${report.pulled} pulled, ${report.pushed} pushed` +
                      (report.forked ? `, ${report.forked} kept as a separate copy` : '') +
                      (report.foreign ? `, ${report.foreign} skipped (another account)` : '') +
                      '.'
                  );
                  router.refresh();
                }
              }}
              disabled={phase === 'syncing'}
            >
              Pull from account
            </Button>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-400">
            Edits are pushed a couple of seconds after you stop typing, when the tab is
            hidden, and once more as the page closes. If the same notebook changed in two
            places, both versions are kept rather than one overwriting the other.
          </p>
        </Panel>

        <LocalDataPanel
          onExport={exportAll}
          onImportClick={() => importInput.current?.click()}
          onWipe={() => setConfirmWipe(true)}
        />

        <Panel title="Account">
          <Button
            variant="danger"
            onClick={async () => {
              await signOut();
              router.push('/');
              router.refresh();
            }}
          >
            Log out
          </Button>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-400">
            Notebooks stay in this browser after logging out, and are re-linked when you sign
            back in.
          </p>
        </Panel>
      </div>

      <FilePicker inputRef={importInput} onFiles={importFiles} />
      <WipeModal
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        onConfirm={wipeLocal}
        signedIn
      />
    </div>
  );
}

function LocalDataPanel({
  onExport,
  onImportClick,
  onWipe,
}: {
  onExport: () => void;
  onImportClick: () => void;
  onWipe: () => void;
}) {
  return (
    <Panel
      title="Data in this browser"
      description="JSON bundles include the notebooks and the images they use."
    >
      <div className="flex flex-wrap gap-2">
        <Button onClick={onImportClick}>Import JSON</Button>
        <Button onClick={onExport}>Export everything</Button>
        <Button variant="ghost" onClick={onWipe}>
          Clear this browser
        </Button>
      </div>
    </Panel>
  );
}

function FilePicker({
  inputRef,
  onFiles,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | null) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="application/json,.json"
      multiple
      className="hidden"
      onChange={(event) => void onFiles(event.target.files)}
    />
  );
}

function WipeModal({
  open,
  onClose,
  onConfirm,
  signedIn,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  signedIn: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Clear notebooks from this browser?"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>
            Clear this browser
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink-600">
        {signedIn
          ? 'Your account keeps its copies — signing in again will pull them back. Anything never synced is gone for good.'
          : 'This cannot be undone, and there is no account holding a copy. Export first if you might want any of it back.'}
      </p>
    </Modal>
  );
}
