'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { authRequest } from './auth-gate';

type Contact = {email: string | null};

export default function ClubContact({club}: {club: string}) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    authRequest<Contact>('club-contact').then(data => {
      if (active) {
        setContact(data);
        setAddress(data.email ?? '');
      }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [reload]);

  function openEditor() {
    setMessage('');
    setError('');
    setContact(null);
    setEditing(true);
    setReload(n => n + 1);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!contact || saving) return;
    setError('');
    setSaving(true);
    try {
      const result = await authRequest<Contact>('club-contact', {email: address, previousEmail: contact.email});
      setContact(result);
      setAddress(result.email ?? '');
      setMessage('负责人邮箱已保存');
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  return <section className="club-contact" aria-label={club + '主负责人邮箱'}>
    {!editing && <>
      {contact?.email === null && <span>本社团尚未填写主负责人邮箱。</span>}
      <button type="button" onClick={openEditor}>{contact?.email === null ? '填写主负责人邮箱' : '修改主负责人邮箱'}</button>
      {message && <span role="status">{message}</span>}
    </>}
    {editing && <form onSubmit={save}>
      <label htmlFor="club-lead-email">{club} 主负责人邮箱</label>
      <input id="club-lead-email" type="email" maxLength={254} required autoComplete="off" autoCapitalize="none"
        value={address} onChange={e => setAddress(e.target.value)} disabled={!contact || saving}/>
      <button type="submit" disabled={!contact || saving}>{saving ? '保存中…' : '保存'}</button>
      <button type="button" disabled={saving} onClick={() => { setEditing(false); setError(''); }}>返回</button>
      {!contact && (error ? <button type="button" onClick={openEditor}>重新读取</button> : <span role="status">正在读取邮箱…</span>)}
    </form>}
    {error && <span role="alert">{error}</span>}
  </section>;
}
