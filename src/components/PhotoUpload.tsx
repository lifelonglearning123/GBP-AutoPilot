'use client';
import { useState } from 'react';
import Action from './Action';

const CATS = ['ADDITIONAL', 'AT_WORK', 'EXTERIOR', 'INTERIOR', 'TEAMS', 'PRODUCT', 'COVER', 'PROFILE'];

/** Photos are a freshness signal too. Google fetches from a public URL; there is no direct upload here. */
export default function PhotoUpload({ locationId }: { locationId: string }) {
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState('ADDITIONAL');
  const [description, setDescription] = useState('');
  return (
    <details className="panel p-4">
      <summary className="cursor-pointer font-semibold text-sm">Add a photo to the profile</summary>
      <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: '2fr 1fr 2fr auto' }}>
        <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="Public https image URL (min 250px short edge)" />
        <select value={category} onChange={e => setCategory(e.target.value)}>{CATS.map(c => <option key={c}>{c}</option>)}</select>
        <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Caption (service + town helps)" />
        <Action action="photo.upload" params={{ id: locationId, url, category, description }} busy="Uploading…" disabled={!url} onDone={() => setUrl('')}>Upload</Action>
      </div>
    </details>
  );
}
