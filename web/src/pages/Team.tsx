import { useState } from 'react';
import { isOwner, useMe } from '../App';
import { api, brl, date, pct } from '../api';
import { Alert, Field, Modal, toast, useAsync } from '../components/ui';

const TT: Record<string, string> = { REPASSE_CAPITAL: 'Repasse de capital', DEVOLUCAO_CAPITAL: 'Devolução de capital', REPASSE_RECEBIMENTO: 'Repasse de recebimentos' };

export default function Team() {
  const me = useMe();
  const owner = isOwner(me);
  const team = useAsync(() => api<any[]>('/team'));
  const transfers = useAsync(() => api<any[]>('/wallet/transfers'));
  const ledger = useAsync(() => api<any[]>('/wallet/ledger'));
  const [modal, setModal] = useState<'member' | 'transfer' | 'deposit' | null>(null);
  const mine = team.data?.find((u) => u.id === me.id);
  const reload = () => { team.reload(); transfers.reload(); ledger.reload(); };
  return (
    <>
      <div className="page-head">
        <h1>{owner ? 'Equipe e carteira' : 'Minha carteira'}</h1>
        <div className="actions">
          {owner && <button onClick={() => setModal('deposit')}>Aporte de capital</button>}
          {owner && <button onClick={() => setModal('member')}>Novo funcionário</button>}
          <button className="primary" onClick={() => setModal('transfer')}>{owner ? 'Repassar capital' : 'Repassar ao Dono'}</button>
        </div>
      </div>
      {mine && (
        <div className="cards">
          <div className="card"><div className="label">Capital disponível</div><div className="value">{brl(mine.capitalDisponivel)}</div></div>
          <div className="card"><div className="label">Capital emprestado</div><div className="value">{brl(mine.capitalEmprestado)}</div></div>
          <div className="card"><div className="label">Comissão acumulada</div><div className="value">{brl(mine.comissaoAcumulada)}</div><div className="sub">{pct(mine.commissionRate)} sobre juros</div></div>
          <div className="card"><div className="label">A repassar ao Dono</div><div className="value">{brl(mine.saldoARepassar)}</div></div>
        </div>
      )}
      {owner && (
        <>
          <h2>Equipe</h2>
          <div className="table-wrap" style={{ marginBottom: 18 }}>
            <table className="dense">
              <thead><tr><th>Nome</th><th>Papel</th><th>E-mail</th><th className="num">Disponível</th><th className="num">Emprestado</th><th className="num">Comissão</th><th className="num">A repassar</th><th>Ativo</th></tr></thead>
              <tbody>{team.data?.map((u) => (
                <tr key={u.id}><td style={{ fontWeight: 500 }}>{u.name}</td><td>{u.role}</td><td>{u.email}</td><td className="num">{brl(u.capitalDisponivel)}</td><td className="num">{brl(u.capitalEmprestado)}</td><td className="num">{brl(u.comissaoAcumulada)}</td><td className="num">{brl(u.saldoARepassar)}</td><td>{u.active ? 'Sim' : 'Não'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      <div className="grid2">
        <div>
          <h2>Repasses</h2>
          <div className="table-wrap" style={{ maxHeight: 400 }}>
            <table className="dense">
              <thead><tr><th>Data</th><th>Tipo</th><th>De → Para</th><th className="num">Valor</th></tr></thead>
              <tbody>{transfers.data?.map((t) => <tr key={t.id}><td>{date(t.createdAt)}</td><td>{TT[t.type]}</td><td>{t.fromUser.name} → {t.toUser.name}</td><td className="num">{brl(t.amount)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div>
          <h2>Extrato (caixa)</h2>
          <div className="table-wrap" style={{ maxHeight: 400 }}>
            <table className="dense">
              <thead><tr><th>Data</th><th>Lançamento</th><th className="num">Valor</th><th className="num">Saldo</th></tr></thead>
              <tbody>{ledger.data?.map((l) => <tr key={l.id}><td>{date(l.createdAt)}</td><td title={l.description ?? ''}>{l.type.replace(/_/g, ' ').toLowerCase()}</td><td className="num" style={{ color: Number(l.amount) < 0 ? 'var(--danger)' : 'var(--ok)' }}>{brl(l.amount)}</td><td className="num">{brl(l.balanceAfter)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
      {modal === 'member' && <MemberModal onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'transfer' && <TransferModal team={team.data ?? []} owner={owner} mine={mine} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'deposit' && <DepositModal onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </>
  );
}

function MemberModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', password: '', phone: '', commissionRate: 0.3 });
  const [error, setError] = useState('');
  return (
    <Modal title="Novo funcionário" onClose={onClose}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        {(['name', 'email', 'phone', 'password'] as const).map((k) => (
          <Field key={k} label={{ name: 'Nome', email: 'E-mail', phone: 'Telefone', password: 'Senha inicial' }[k]}><input type={k === 'password' ? 'password' : 'text'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
        ))}
        <Field label="Comissão sobre juros"><input type="number" step="0.05" value={f.commissionRate} onChange={(e) => setF({ ...f, commissionRate: +e.target.value })} /></Field>
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="primary" onClick={async () => { try { await api('/team', { body: f }); toast('Funcionário criado'); onDone(); } catch (e: any) { setError(e.message); } }}>Criar</button>
      </div>
    </Modal>
  );
}

function TransferModal({ team, owner, mine, onClose, onDone }: { team: any[]; owner: boolean; mine: any; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState(owner ? 'REPASSE_CAPITAL' : 'REPASSE_RECEBIMENTO');
  const [userId, setUserId] = useState(owner ? '' : mine?.ownerId ?? '');
  const [amount, setAmount] = useState(owner ? 10000 : Number(mine?.saldoARepassar ?? 0));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal title={owner ? 'Repassar capital ao funcionário' : 'Repassar ao Dono'} onClose={onClose}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        {owner ? (
          <Field label="Funcionário" className="span2"><select value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Escolha…</option>{team.filter((u) => u.role === 'FUNCIONARIO').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        ) : (
          <Field label="Tipo" className="span2"><select value={type} onChange={(e) => setType(e.target.value)}><option value="REPASSE_RECEBIMENTO">Recebimentos (parte do Dono)</option><option value="DEVOLUCAO_CAPITAL">Devolver capital parado</option></select></Field>
        )}
        <Field label="Valor (R$)"><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(+e.target.value)} /></Field>
        <Field label="Observação" className="span3"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="primary" onClick={async () => { try { await api('/wallet/transfers', { body: { type, userId, amount, notes } }); toast('Repasse registrado'); onDone(); } catch (e: any) { setError(e.message); } }}>Confirmar</button>
      </div>
    </Modal>
  );
}

function DepositModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState('Aporte');
  return (
    <Modal title="Aporte de capital (valor negativo = retirada)" onClose={onClose}>
      <div className="form-grid">
        <Field label="Valor (R$)"><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(+e.target.value)} /></Field>
        <Field label="Descrição" className="span2"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="primary" onClick={async () => { await api('/wallet/deposit', { body: { amount, description } }); onDone(); }}>Lançar</button>
      </div>
    </Modal>
  );
}
