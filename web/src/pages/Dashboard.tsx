import { Link } from 'react-router-dom';
import { api, brl, date } from '../api';
import { ScoreBadge, useAsync } from '../components/ui';

export default function Dashboard() {
  const { data, error } = useAsync(() => api('/dashboard'));
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="empty">Carregando…</div>;
  const c = data.cards;
  const dist = data.scoreDistribution ?? {};
  return (
    <>
      <div className="page-head">
        <h1>Painel</h1>
        <div className="actions"><Link className="btn primary" to="/emprestimos?novo=1">Novo empréstimo <span className="kbd">Ctrl+N</span></Link></div>
      </div>
      <div className="cards">
        <div className="card"><div className="label">Capital disponível</div><div className="value">{brl(c.capitalDisponivel)}</div><div className="sub">pronto para emprestar</div></div>
        <div className="card"><div className="label">Capital na rua</div><div className="value">{brl(c.capitalEmprestado)}</div><div className="sub">principal emprestado</div></div>
        <div className="card"><div className="label">Recebido no mês</div><div className="value">{brl(c.recebidoMes)}</div><div className="sub">{c.pagamentosMes} pagamentos</div></div>
        <div className="card"><div className="label">Em atraso</div><div className="value" style={{ color: c.emAtraso > 0 ? 'var(--danger)' : undefined }}>{brl(c.emAtraso)}</div><div className="sub">{c.parcelasEmAtraso} parcelas, com multa</div></div>
      </div>
      <div className="row" style={{ marginBottom: 16, gap: 12 }}>
        {(['BOM', 'REGULAR', 'RUIM', 'PERDA'] as const).map((s) => (
          <Link key={s} to={`/clientes?status=${s}`}><ScoreBadge status={s} score={dist[s] ?? 0} /></Link>
        ))}
        <span className="spacer" />
        {data.pendingApprovals > 0 && <Link to="/aprovacoes" className="badge count">{data.pendingApprovals} aguardando aprovação</Link>}
        {data.saldoARepassar > 0 && <span className="muted">A repassar ao Dono: <b>{brl(data.saldoARepassar)}</b></span>}
      </div>
      <div className="grid2">
        <div>
          <h2>Atrasados</h2>
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="dense">
              <thead><tr><th>Cliente</th><th>Parc.</th><th>Venc.</th><th className="num">Dias</th><th className="num">Valor atual</th></tr></thead>
              <tbody>
                {data.overdue.map((o: any) => (
                  <tr key={o.id}>
                    <td><Link to={`/emprestimos/${o.loanId}`}>{o.client.name}</Link> <ScoreBadge status={o.client.scoreStatus} /></td>
                    <td>{o.number}</td><td>{date(o.dueDate)}</td>
                    <td className="num" style={{ color: 'var(--danger)' }}>{o.daysLate}</td>
                    <td className="num">{brl(o.currentValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.overdue.length && <div className="empty">Nenhuma parcela em atraso 🎉</div>}
          </div>
        </div>
        <div>
          <h2>Vencem hoje</h2>
          <div className="table-wrap">
            <table className="dense">
              <thead><tr><th>Cliente</th><th>Empréstimo</th><th className="num">Valor</th></tr></thead>
              <tbody>
                {data.dueToday.map((i: any) => (
                  <tr key={i.id}><td>{i.loan.client.name}</td><td><Link to={`/emprestimos/${i.loan.id}`}>#{i.loan.code} · {i.number}ª</Link></td><td className="num">{brl(i.amount)}</td></tr>
                ))}
              </tbody>
            </table>
            {!data.dueToday.length && <div className="empty">Nada vence hoje.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
