import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, brl, date, download, pct } from '../api';
import { ScoreBadge, toast, useAsync } from '../components/ui';

export default function Clients() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const status = params.get('status') ?? '';
  const nav = useNavigate();
  const { data, error } = useAsync(() => api<any[]>(`/clients?q=${encodeURIComponent(q)}&status=${status}`), [q, status]);
  return (
    <>
      <div className="page-head">
        <h1>Clientes</h1>
        <div className="actions">
          <input placeholder="Buscar nome, CPF ou telefone" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          <select value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})} style={{ width: 140 }}>
            <option value="">Todos</option><option value="BOM">⭐ Bom</option><option value="REGULAR">Regular</option><option value="RUIM">⚠️ Ruim</option><option value="PERDA">💀 Perda</option>
          </select>
          <button onClick={() => download('/backup/export/clientes.csv', 'clientes.csv').catch((e) => toast(e.message))}>Exportar CSV</button>
          <Link className="btn primary" to="/clientes/novo">Novo cliente</Link>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="table-wrap">
        <table className="dense">
          <thead>
            <tr><th>Nome</th><th>CPF</th><th>WhatsApp</th><th>Cidade</th><th>Score</th><th className="num">Margem</th><th className="num">Taxa</th><th className="num">Em aberto</th><th>Próx. venc.</th><th>Fiador</th></tr>
          </thead>
          <tbody>
            {data?.map((c) => {
              const open = c.loans.flatMap((l: any) => l.installments);
              const next = open.map((i: any) => i.dueDate).sort()[0];
              return (
                <tr key={c.id} className="clickable" onClick={() => nav(`/clientes/${c.id}`)}>
                  <td style={{ fontWeight: 500 }}>{c.name} {c.blocked && '🔒'}</td>
                  <td className="mono">{c.cpf}</td>
                  <td className="mono">{c.whatsapp || c.phone || '—'}</td>
                  <td>{c.city ? `${c.city}/${c.state ?? ''}` : '—'}</td>
                  <td><ScoreBadge status={c.scoreStatus} score={c.score} /></td>
                  <td className="num">{brl(c.creditLimit)}</td>
                  <td className="num">{pct(c.interestRate)}</td>
                  <td className="num">{brl(open.reduce((s: number, i: any) => s + Number(i.amount), 0))}</td>
                  <td>{next ? date(next) : '—'}</td>
                  <td>{c.guarantor?.name ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && !data.length && <div className="empty">Nenhum cliente. Clique em “Novo cliente” e cole a ficha do WhatsApp.</div>}
      </div>
    </>
  );
}
