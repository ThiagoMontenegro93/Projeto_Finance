import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, brl, date, METHODS, pct } from '../api';
import { Alert, Field, Modal, ScoreBadge, StatusBadge, toast, useAsync } from '../components/ui';

const TYPE: Record<string, string> = { PARCELA: 'Parcela', JUROS: 'Só juros', QUITACAO: 'Quitação' };

export default function LoanDetail() {
  const { id } = useParams();
  const { data: l, reload, error } = useAsync(() => api(`/loans/${id}`), [id]);
  const [pay, setPay] = useState<{ type: string; installment?: any } | null>(null);
  if (error) return <div className="alert error">{error}</div>;
  if (!l) return <div className="empty">Carregando…</div>;
  const active = l.status === 'ATIVO';
  const waiting = l.payments.some((p: any) => p.status === 'AGUARDANDO_APROVACAO');
  return (
    <>
      <div className="page-head">
        <Link to="/emprestimos">← Empréstimos</Link>
        <h1>#{l.code} · <Link to={`/clientes/${l.client.id}`}>{l.client.name}</Link></h1>
        <ScoreBadge status={l.client.scoreStatus} />
        <div className="actions">
          {active && <button disabled={waiting} onClick={() => setPay({ type: 'QUITACAO' })}>Quitar tudo {l.payoff && `(${brl(l.payoff.total)})`}</button>}
        </div>
      </div>
      {waiting && <Alert kind="warn">Há um pagamento aguardando aprovação do Dono.</Alert>}
      <div className="cards">
        <div className="card"><div className="label">Valor emprestado</div><div className="value">{brl(l.principal)}</div><div className="sub">{pct(l.interestRate)} · {METHODS[l.method as keyof typeof METHODS]} · {l.installmentsCount}x</div></div>
        <div className="card"><div className="label">Parcela</div><div className="value">{brl(l.installmentAmount)}</div><div className="sub">multa {pct(l.lateFeeDailyRate)} ao dia</div></div>
        <div className="card"><div className="label">Saldo para quitar</div><div className="value">{l.payoff ? brl(l.payoff.total) : '—'}</div><div className="sub">{l.payoff && `principal ${brl(l.payoff.principal)} + juros/multa vencidos`}</div></div>
        <div className="card"><div className="label">Próximas datas</div><div className="value" style={{ fontSize: 14 }}>{l.projection.map(date).join(' · ') || '—'}</div><div className="sub">projeção automática</div></div>
      </div>
      <div className="row muted" style={{ marginBottom: 10 }}>Capital de <b>{l.funder.name}</b> · emprestado por <b>{l.lender.name}</b> · status <b>{l.status}</b></div>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table className="dense">
          <thead><tr><th>Nº</th><th>Vencimento</th><th className="num">Parcela</th><th className="num">Juros</th><th className="num">Principal</th><th className="num">Dias</th><th className="num">Valor atual</th><th>Status</th><th>Pago em</th><th></th></tr></thead>
          <tbody>{l.installments.map((i: any) => (
            <tr key={i.id}>
              <td>{i.number}</td><td>{date(i.dueDate)}</td><td className="num">{brl(i.amount)}</td><td className="num">{brl(i.interestPart)}</td><td className="num">{brl(i.principalPart)}</td>
              <td className="num" style={{ color: i.daysLate ? 'var(--danger)' : undefined }}>{i.daysLate || ''}</td>
              <td className="num">{brl(i.currentValue)}</td><td><StatusBadge status={i.status} late={i.daysLate} /></td><td>{i.paidAt ? date(i.paidAt) : ''}</td>
              <td>{i.status === 'PENDENTE' && active && (
                <div className="row">
                  <button onClick={() => setPay({ type: 'PARCELA', installment: i })}>Receber</button>
                  <button disabled={waiting} onClick={() => setPay({ type: 'JUROS', installment: i })}>Só juros</button>
                </div>
              )}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <h2>Pagamentos</h2>
      <div className="table-wrap">
        <table className="dense">
          <thead><tr><th>Data</th><th>Tipo</th><th className="num">Valor</th><th className="num">Multa</th><th>Status</th><th>Lançado por</th><th>Aprovado por</th></tr></thead>
          <tbody>{l.payments.map((p: any) => (
            <tr key={p.id}><td>{date(p.paidAt)}</td><td>{TYPE[p.type]}</td><td className="num">{brl(p.amount)}</td><td className="num">{brl(p.lateFee)}</td><td>{p.status.replace('_', ' ')}{p.biometricVerified ? ' 🔐' : ''}</td><td>{p.createdBy?.name}</td><td>{p.approvedBy?.name ?? ''}</td></tr>
          ))}</tbody>
        </table>
        {!l.payments.length && <div className="empty">Nenhum pagamento.</div>}
      </div>
      {pay && <PayModal loan={l} pay={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); reload(); }} />}
    </>
  );
}

function PayModal({ loan, pay, onClose, onDone }: { loan: any; pay: { type: string; installment?: any }; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('PIX');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const i = pay.installment;
  const amount = pay.type === 'QUITACAO' ? loan.payoff.total : pay.type === 'JUROS' ? Number(i.interestPart) + (i.currentValue - Number(i.amount)) : i.currentValue;
  const submit = async () => {
    try {
      const r = await api(`/loans/${loan.id}/payments`, { body: { type: pay.type, installmentId: i?.id, method, notes } });
      toast(r.status === 'APROVADO' ? 'Pagamento registrado' : 'Enviado para aprovação do Dono 🔒');
      onDone();
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <Modal title={`${TYPE[pay.type]}${i ? ` · parcela ${i.number}` : ''}`} onClose={onClose}>
      <Alert>{error}</Alert>
      <div style={{ fontSize: 26, fontWeight: 600, marginBottom: 6 }}>{brl(amount)}</div>
      {pay.type === 'JUROS' && <p className="muted">Paga só os juros: esta parcela fica como “só juros” e uma nova parcela igual é criada no final. Precisa de aprovação do Dono.</p>}
      {pay.type === 'QUITACAO' && <p className="muted">Quitação total: todas as parcelas em aberto serão apagadas e o empréstimo fechado. Precisa de aprovação do Dono.</p>}
      <div className="form-grid">
        <Field label="Forma"><select value={method} onChange={(e) => setMethod(e.target.value)}><option>PIX</option><option>Dinheiro</option><option>Transferência</option></select></Field>
        <Field label="Observação" className="span2"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancelar</button><button className="primary" onClick={submit}>Confirmar</button>
      </div>
    </Modal>
  );
}
