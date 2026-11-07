import { ReactNode, useEffect, useRef, useState } from 'react';
import { SCORE } from '../api';

export function ScoreBadge({ status, score }: { status: keyof typeof SCORE; score?: number }) {
  const s = SCORE[status] ?? SCORE.REGULAR;
  return <span className={`badge s-${status}`}>{s.icon} {s.label}{score !== undefined ? ` · ${score}` : ''}</span>;
}

export function StatusBadge({ status, late }: { status: string; late?: number }) {
  if (status === 'PENDENTE' && late && late > 0) return <span className="badge st-ATRASO">{late}d atraso</span>;
  const label: Record<string, string> = { PENDENTE: 'Aberta', PAGO: 'Paga', JUROS_PAGO: 'Só juros', CANCELADO: 'Cancelada' };
  return <span className={`badge st-${status}`}>{label[status] ?? status}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head"><h2 style={{ margin: 0 }}>{title}</h2><button onClick={onClose}>Fechar</button></div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className ?? ''}`}>{label}{children}</label>;
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'ok' | 'warn'; children: ReactNode }) {
  if (!children) return null;
  return <div className={`alert ${kind}`}>{children}</div>;
}

/** Área de arrastar-e-soltar arquivos. */
export function DropZone({ accept, onFile, children }: { accept: string; onFile: (f: File) => void; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      onClick={() => input.current?.click()}
      style={{ cursor: 'pointer' }}
    >
      {children}
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then((d) => alive && (setData(d), setError(''))).catch((e) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

let toastTimer: number | undefined;
export function toast(msg: string) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el!.style.display = 'none'), 3000);
}
