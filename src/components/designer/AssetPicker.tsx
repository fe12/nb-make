'use client';

import { useRef, useState } from 'react';
import { Button, Notice, Spinner } from '@/components/ui/controls';
import { assetUrl } from '@/lib/assets';
import { deleteAsset, saveAsset } from '@/lib/client/storage';
import { useNotebook } from '@/lib/client/store';

export function AssetPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (assetId: string) => void;
}) {
  const { assets, refreshAssets } = useNotebook();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      let lastId = '';
      for (const file of Array.from(files)) {
        const meta = await saveAsset(file);
        lastId = meta.id;
      }
      await refreshAssets();
      if (lastId) onChange(lastId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await deleteAsset(id);
      await refreshAssets();
      if (value === id) onChange('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setBusy(false);
    }
  };

  const list = Object.values(assets).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-2">
      {error && <Notice tone="error">{error}</Notice>}

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        multiple
        className="hidden"
        onChange={(event) => upload(event.target.files)}
      />

      <Button size="sm" onClick={() => input.current?.click()} disabled={busy} className="w-full">
        {busy ? <Spinner /> : null} Upload PNG or JPEG
      </Button>

      {list.length === 0 ? (
        <p className="text-[10.5px] leading-snug text-ink-400">
          No images yet. PNG and JPEG are supported — those are the formats that can be embedded
          directly in a PDF without re-encoding.
        </p>
      ) : (
        <ul className="grid max-h-52 grid-cols-3 gap-1.5 overflow-y-auto">
          {list.map((asset) => (
            <li key={asset.id} className="group relative">
              <button
                type="button"
                onClick={() => onChange(asset.id)}
                title={`${asset.name} — ${asset.width}×${asset.height}`}
                className={
                  value === asset.id
                    ? 'block w-full overflow-hidden rounded border-2 border-accent-500'
                    : 'block w-full overflow-hidden rounded border border-ink-200 hover:border-ink-400'
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={assetUrl(asset.id)}
                  alt={asset.name}
                  className="aspect-square w-full bg-ink-50 object-contain"
                />
              </button>
              <button
                type="button"
                onClick={() => remove(asset.id)}
                aria-label={`Delete ${asset.name}`}
                className="absolute right-0.5 top-0.5 hidden rounded bg-white/90 px-1 text-[10px] text-danger-500 shadow group-hover:block"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
