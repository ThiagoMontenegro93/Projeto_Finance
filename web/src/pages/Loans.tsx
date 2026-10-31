import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isOwner, useMe } from '../App';
import { api, brl, date, download, METHODS, pct } from '../api';
import { Alert, Field, Modal, ScoreBadge, toast, useAsync } from '../components/ui';

export default function Loans() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('ATIVO');
  const nav = useNavigate();
  const { data, reload } = useAsync(() => api<any[]>(`/loans?status=${status}`), [status]);
  const creating = params.get('novo') === '1';
  return (
    <>
      <div className="page-head">
        <h1>Empréstimos</h1>
        <div className="actions">
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140 }}>
            <option value="ATIVO">Ativos</option><option value="QUITADO">Quitados</option><option value="PERDA">Perda</option><option value="">Todos</option>
          </select>
          <button onClick={() => download('/backup/export/emprestimos.csv', 'emprestimos.csv').catch((e) => toast(e.message))}>Exportar CSV</button>
          <button className="primary" onClick={() => setParams({ novo: '1' })}>Novo empréstimo <span className="kbd">Ctrl+N</span></button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="dense">
          <thead><tr><th>#</th><th>Cliente</th><th>Score</th><th className="num">Valor</th><th className="num">Taxa</th><th>Método</th><th className="num">Parcela</th><th>Próx. venc.</th><th>Emprestou</th><th>Status</th></tr></thead>
          <tbody>{data?.map((l) => (
            <tr key={l.id} className="clickable" onClick={() => nav(`/emprestimos/${l.id}`)}>
              <td>{l.code}</td><td style={{ fontWeight: 500 }}>{l.client.name}</td><td><ScoreBadge status={l.client.scoreStatus} /></td>
              <td className="num">{brl(l.principal)}</td><td className="num">{pct(l.interestRate)}</td><td>{METHODS[l.method as keyof typeof METHODS]} · {l.installmentsCount}x</td>
              <td className="num">{brl(l.installmentAmount)}</td><td>{date(l.installments[0]?.dueDate)}</td><td>{l.lender.name}</td><td>{l.status}</td>
            </tr>
          ))}</tbody>
        </table>
        {data && !data.length && <div className="empty">Nenhum empréstimo.</div>}
      </div>
      {creating && <NewLoan clientId={params.get('cliente') ?? ''} onClose={() => setParams({})} onCreated={(id) => { reload(); nav(`/emprestimos/${id}`); }} />}
    </>
  );
}

function NewLoan({ clientId, onClose, onCreated }: { clientId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const me = useMe();
  const [clients, setClients] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const [f, setF] = useState({ clientId, principal: 1000, rate: 0.1, installments: 3, method: 'MENSAL', firstDueDate: in30, lateFeeDailyRate: 0.01, lenderUserId: '', overrideLimit: false });
  const [sim, setSim] = useState<any>(null);
  const [error, setError] = useState('');
  const client = clients.find((c) => c.id === f.clientId);

  useEffect(() => {
    api<any[]>('/clients').then(setClients);
    if (isOwner(me)) api<any[]>('/team').then(setTeam);
  }, [me]);
  useEffect(() => {
    if (client) setF((p) => ({ ...p, rate: Number(client.interestRate) }));
  }, [client?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => {
      if (!(f.principal > 0 && f.installments > 0)) return;
      api('/loans/simulate', { body: { principal: +f.principal, rate: +f.rate, installments: +f.installments, method: f.method, firstDueDate: f.firstDueDate } }).then(setSim).catch(() => setSim(null));
    }, 200);
    return () => clearTimeout(t);
  }, [f.principal, f.rate, f.installments, f.method, f.firstDueDate]);

  const up = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = async () => {
    setError('');
    try {
      const body: any = { ...f, principal: +f.principal, rate: +f.rate, installments: +f.installments, lateFeeDailyRate: +f.lateFeeDailyRate };
      if (!body.lenderUserId) delete body.lenderUserId;
      const r = await api('/loans', { body });
      onCreated(r.id);
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <Modal title="Novo empréstimo" onClose={onClose}>
      <Alert>{error}</Alert>
      {client?.blocked && <Alert>💀 Cliente bloqueado (PERDA) — NÃO EMPRESTAR.</Alert>}
      <div className="form-grid">
        <Field label="Cliente" className="span2">
          <select value={f.clientId} onChange={up('clientId')}>
            <option value="">Escolha…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.scoreStatus}{c.blocked ? ' 🔒' : ''}</option>)}
          </select>
        </Field>
        <div>{client && <><ScoreBadge status={client.scoreStatus} score={client.score} /><div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Margem {brl(client.creditLimit)}</div></>}</div>
        <Field label="Valor (R$)"><input type="number" step="0.01" value={f.principal} onChange={up('principal')} /></Field>
        <Field label="Taxa por período (0,10 = 10%)"><input type="number" step="0.005" value={f.rate} onChange={up('rate')} /></Field>
        <Field label="Nº de parcelas"><input type="number" min={1} value={f.installments} onChange={up('installments')} /></Field>
        <Field label="Método">
          <select value={f.method} onChange={up('method')}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="1º vencimento"><input type="date" value={f.firstDueDate} onChange={up('firstDueDate')} /></Field>
        <Field label="Multa por dia (0,01 = 1%)"><input type="number" step="0.001" value={f.lateFeeDailyRate} onChange={up('lateFeeDailyRate')} /></Field>
        {isOwner(me) && (
          <Field label="Quem empresta (carteira)">
            <select value={f.lenderUserId} onChange={up('lenderUserId')}>
              <option value="">Eu ({me.name})</option>{team.filter((t) => t.id !== me.id).map((t) => <option key={t.id} value={t.id}>{t.name} · {brl(t.capitalDisponivel)}</option>)}
            </select>
          </Field>
        )}
        {isOwner(me) && (
          <label className="row span2" style={{ fontSize: 13 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={f.overrideLimit} onChange={(e) => setF((p) => ({ ...p, overrideLimit: e.target.checked }))} />
            Liberar acima da margem / cliente RUIM (decisão do Dono)
          </label>
        )}
      </div>
      {sim && (
        <div className="panel" style={{ marginTop: 14, background: '#f8fafc' }}>
          <div className="row" style={{ gap: 24 }}>
            <div><div className="muted">Parcela (Price)</div><b style={{ fontSize: 18 }}>{brl(sim.installmentAmount)}</b></div>
            <div><div className="muted">Total</div><b>{brl(sim.totalPaid)}</b></div>
            <div><div className="muted">Juros</div><b>{brl(sim.totalInterest)}</b></div>
            <div><div className="muted">Projeção após a última</div>{sim.projection.map(date).join(' · ')}</div>
          </div>
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 180 }}>
            <table className="dense">
              <thead><tr><th>Nº</th><th>Vencimento</th><th className="num">Parcela</th><th className="num">Juros</th><th className="num">Amortização</th><th className="num">Saldo</th></tr></thead>
              <tbody>{sim.schedule.map((r: any) => <tr key={r.number}><td>{r.number}</td><td>{date(r.dueDate)}</td><td className="num">{brl(r.amount)}</td><td className="num">{brl(r.interestPart)}</td><td className="num">{brl(r.principalPart)}</td><td className="num">{brl(r.balanceAfter)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" disabled={!f.clientId || client?.blocked} onClick={submit}>Emprestar {brl(f.principal)}</button>
      </div>
    </Modal>
  );
}
