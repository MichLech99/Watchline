import { useState } from 'react'
import { Cloud, Download, History, RefreshCw } from 'lucide-react'
import { listCloudBackups } from './cloud'
import type { LibraryController } from './library-controller'
import type { LocalBackup } from './library-persistence'
import type { MediaItem } from './types'

export function LibrarySafetyPanel({ controller, userId, onRecover }: { controller: LibraryController | null; userId: string; onRecover: (items: MediaItem[]) => boolean }) {
  const [backups, setBackups] = useState<LocalBackup[]>([])
  const [opened, setOpened] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const load = async () => {
    setOpened(true); setLoading(true); setMessage('')
    let local: LocalBackup[] = []
    try { local = controller?.persistence.backups() || [] } catch { setMessage('Non riesco a leggere le copie locali.') }
    setBackups(local)
    try {
      const cloud = await listCloudBackups(userId)
      setBackups([...cloud.map((backup) => ({ ...backup, id: `cloud:${backup.id}` })), ...local].sort((a, b) => b.savedAt - a.savedAt))
    } catch { setMessage('Cloud non raggiungibile. Sono mostrate le copie disponibili sul dispositivo.') }
    finally { setLoading(false) }
  }
  const exportCopy = () => {
    if (!controller) return
    const blob = new Blob([JSON.stringify(controller.draft.snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `watchline-${new Date().toISOString().slice(0, 10)}.json`; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return <section className="backup-card library-safety" aria-labelledby="library-safety-title">
    <div><p className="eyebrow">La tua libreria al sicuro</p><h2 id="library-safety-title"><Cloud size={21} /> Copie recuperabili</h2></div>
    <p>Conserviamo le ultime 20 versioni nel cloud e una copia prima della prima modifica di ogni giorno. Puoi recuperare i titoli mancanti senza cambiare quelli già presenti.</p>
    <div className="backup-actions"><button className="secondary-action" onClick={() => void load()} disabled={loading}><History size={18} />{loading ? 'Carico…' : 'Vedi copie'}</button><button className="secondary-action" onClick={exportCopy} disabled={!controller}><Download size={18} />Scarica libreria</button></div>
    {opened && !loading && !backups.length && <p>Le copie vengono create con i prossimi salvataggi. Non contengono i titoli persi prima di questa protezione.</p>}
    {message && <p role="status">{message}</p>}
    {opened && <div className="library-backup-list">{backups.map((backup) => {
      const missing = backup.snapshot.library.filter((item) => !controller?.draft.snapshot.library.some((current) => current.id === item.id))
      return <article key={backup.id}><div><strong>{new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(backup.savedAt || Date.now())}</strong><span>{backup.snapshot.library.length} titoli · {backup.id.startsWith('cloud:') ? 'Cloud' : 'Dispositivo'}</span></div><button className="secondary-action" disabled={!missing.length || !controller} onClick={() => { if (onRecover(missing)) setMessage(`${missing.length} titoli recuperati. Attendi la conferma del salvataggio cloud.`) }}><RefreshCw size={16} />{missing.length ? `Recupera ${missing.length} titoli` : 'Già presenti'}</button></article>
    })}</div>}
  </section>
}
