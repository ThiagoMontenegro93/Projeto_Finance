import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { isOwner, useMe } from '../App';
import { api, brl, date, daysLate, METHODS, pct } from '../api';
import { Alert, DropZone, Field, Modal, ScoreBadge, StatusBadge, toast } from '../components/ui';

const TABS = ['Dados pessoais', 'Contato e endereço', 'Financeiro / PIX', 'Vínculos', 'Documentos e recibos'] as const;
const DOC_KINDS: Record<string, string> = {
  RG: 'RG', CPF: 'CPF', CNH: 'CNH', COMPROVANTE_RESIDENCIA: 'Comprovante de residência', SELFIE: 'Selfie',
  RECIBO: 'Recibo', COMPROVANTE_CLIENTE: 'Comprovante enviado pelo cliente', CONTRATO: 'Contrato', OUTRO: 'Outro',
};

const empty: Record<string, any> = {};

export default function ClientForm() {
  const { id } = useParams();
  const isNew = id === 'novo';
  const me = useMe();
  const nav = useNavigate();
  const [tab, setTab] = useState(0);
  const [c, setC] = useState<Record<string, any>>(empty);
  const [all, setAll] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(isNew);
  const [docKind, setDocKind] = useState('COMPROVANTE_CLIENTE');

  const load = () => !isNew && api(`/clients/${id}`).then(setC).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api<any[]>('/clients').then(setAll).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (k: string) => (e: { target: { value: string } }) => setC((p) => ({ ...p, [k]: e.target.value }));
  const val = (k: string) => (k === 'birthDate' && c[k] ? String(c[k]).slice(0, 10) : c[k] ?? '');
  const inp = (k: string, label: string, props: Record<string, any> = {}) => (
    <Field label={label} className={props.className}><input value={val(k)} onChange={set(k)} {...props} className={undefined} /></Field>
  );

  const cep = async () => {
    const d = String(c.cep ?? '').replace(/\D/g, '');
    if (d.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`).then((x) => x.json());
      if (r.erro) return toast('CEP não encontrado');
      setC((p) => ({ ...p, street: r.logradouro || p.street, district: r.bairro || p.district, city: r.localidade, state: r.uf, complement: p.complement || r.complemento }));
    } catch {
      toast('ViaCEP indisponível — preencha à mão');
    }
  };

  const save = async () => {
    setError('');
    try {
      const body = { ...c };
      ['loans', 'documents', 'guarantor', 'referredBy', 'guaranteeing', 'referrals', 'meta', 'strategies'].forEach((k) => delete body[k]);
      const r = isNew ? await api('/clients', { body }) : await api(`/clients/${id}`, { method: 'PATCH', body });
      toast('Ficha salva');
      if (isNew) nav(`/clientes/${r.id}`, { replace: true });
      else load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const upload = async (f: File) => {
    const form = new FormData();
    form.append('file', f);
    form.append('clientId', String(id));
    form.append('kind', docKind);
    try {
      await api('/documents', { form });
      toast('Documento enviado');
      load();
    } catch (e: any) {
      toast(e.message);
    }
  };

  const openDoc = async (docId: string) => {
    const r = await api(`/documents/${docId}/signed-url`);
    window.open(r.url, '_blank');
  };

  const others = all.filter((x) => x.id !== id);

  return (
    <>
      <div className="page-head">
        <Link to="/clientes">← Clientes</Link>
        <h1>{isNew ? 'Novo cliente' : c.name}</h1>
        {!isNew && c.scoreStatus && <ScoreBadge status={c.scoreStatus} score={c.score} />}
        {c.blocked && <span className="badge s-PERDA">🔒 Bloqueado — NÃO EMPRESTAR</span>}
        <div className="actions">
          <button onClick={() => setImporting(true)}>Colar do WhatsApp</button>
          {!isNew && !c.blocked && <Link className="btn" to={`/emprestimos?novo=1&cliente=${id}`}>Novo empréstimo</Link>}
          {!isNew && c.blocked && me.role === 'SUPER_ADMIN' && (
            <button onClick={async () => { await api(`/clients/${id}/unblock`, { body: { reason: prompt('Motivo do desbloqueio') ?? '' } }); load(); }}>Desbloquear</button>
          )}
          <button className="primary" onClick={save}>Salvar ficha</button>
        </div>
      </div>
      <Alert>{error}</Alert>
      {c.blocked && <Alert kind="warn">{c.blockedReason}. Somente o Super Admin pode desbloquear.</Alert>}

      <div className="tabs">{TABS.map((t, i) => <button key={t} className={tab === i ? 'active' : ''} onClick={() => setTab(i)}>{t}</button>)}</div>

      <div className="panel">
        {tab === 0 && (
          <div className="form-grid">
            {inp('name', 'Nome completo', { className: 'span2' })}
            {inp('cpf', 'CPF', { placeholder: '000.000.000-00' })}
            {inp('rg', 'RG')}
            {inp('birthDate', 'Nascimento', { type: 'date' })}
            <Field label="Estado civil">
              <select value={val('maritalStatus')} onChange={set('maritalStatus')}>
                <option value="">—</option>{['Solteiro', 'Casado', 'União estável', 'Divorciado', 'Viúvo'].map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
            {inp('profession', 'Profissão')}
            <Field label="Observações" className="span3"><textarea style={{ minHeight: 70, fontFamily: 'inherit' }} value={val('notes')} onChange={set('notes')} /></Field>
          </div>
        )}
        {tab === 1 && (
          <div className="form-grid">
            {inp('whatsapp', 'WhatsApp', { placeholder: '11999999999' })}
            {inp('phone', 'Telefone')}
            {inp('email', 'E-mail', { type: 'email' })}
            <Field label="CEP (busca automática ViaCEP)"><input value={val('cep')} onChange={set('cep')} onBlur={cep} placeholder="00000-000" /></Field>
            {inp('street', 'Endereço', { className: 'span2' })}
            {inp('number', 'Número')}
            {inp('complement', 'Complemento')}
            {inp('district', 'Bairro')}
            {inp('city', 'Cidade')}
            {inp('state', 'UF', { maxLength: 2 })}
          </div>
        )}
        {tab === 2 && (
          <div className="form-grid">
            <Field label="Tipo de chave PIX">
              <select value={val('pixKeyType')} onChange={set('pixKeyType')}>
                <option value="">—</option>{['CPF', 'Telefone', 'E-mail', 'Aleatória'].map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
            {inp('pixKey', 'Chave PIX', { className: 'span2' })}
            {inp('bank', 'Banco')}
            {inp('income', 'Renda mensal (R$)', { type: 'number', step: '0.01' })}
            <div />
            <div className="card"><div className="label">Margem liberada</div><div className="value">{brl(c.creditLimit ?? 1000)}</div><div className="sub">ajustada pelo score</div></div>
            <div className="card"><div className="label">Taxa do cliente</div><div className="value">{pct(c.interestRate ?? 0.1)}</div><div className="sub">BOM = 8% fidelidade</div></div>
            <div className="card"><div className="label">Estratégias de cobrança</div><div className="sub" style={{ marginTop: 8 }}>{(c.strategies ?? []).map((s: string) => <div key={s}>• {s}</div>)}</div></div>
          </div>
        )}
        {tab === 3 && (
          <div className="form-grid">
            {inp('emergencyName', 'Contato de emergência')}
            {inp('emergencyPhone', 'Telefone emergência')}
            {inp('emergencyRelation', 'Parentesco')}
            <Field label="Fiador (cliente cadastrado)" className="span2">
              <select value={val('guarantorId')} onChange={set('guarantorId')}>
                <option value="">— sem fiador —</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.cpf}</option>)}
              </select>
            </Field>
            <div>{c.guarantor && <Link to={`/clientes/${c.guarantor.id}`}>Abrir ficha do fiador →</Link>}</div>
            <Field label="Indicado por" className="span2">
              <select value={val('referredById')} onChange={set('referredById')}>
                <option value="">—</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <div className="muted span3">
              {c.guaranteeing?.length > 0 && <>É fiador de: {c.guaranteeing.map((g: any) => g.name).join(', ')}. </>}
              {c.referrals?.length > 0 && <>Indicou: {c.referrals.map((g: any) => g.name).join(', ')}.</>}
            </div>
          </div>
        )}
        {tab === 4 && (isNew ? <div className="empty">Salve a ficha para anexar documentos.</div> : (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <Field label="Tipo do documento"><select value={docKind} onChange={(e) => setDocKind(e.target.value)} style={{ width: 280 }}>{Object.entries(DOC_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            </div>
            <DropZone accept="image/*,application/pdf" onFile={upload}>Arraste a foto/PDF aqui ou clique para escolher (máx. 10 MB). Armazenado em área privada; links valem 5 minutos.</DropZone>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="dense">
                <thead><tr><th>Tipo</th><th>Arquivo</th><th>Enviado em</th><th></th></tr></thead>
                <tbody>{(c.documents ?? []).map((d: any) => (
                  <tr key={d.id}><td>{DOC_KINDS[d.kind]}</td><td>{d.fileName}</td><td>{date(d.createdAt)}</td><td><button onClick={() => openDoc(d.id)}>Abrir</button></td></tr>
                ))}</tbody>
              </table>
              {!c.documents?.length && <div className="empty">Nenhum documento.</div>}
            </div>
          </>
        ))}
      </div>

      {!isNew && c.loans?.length > 0 && (
        <>
          <h2>Empréstimos</h2>
          <div className="table-wrap">
            <table className="dense">
              <thead><tr><th>#</th><th>Início</th><th className="num">Valor</th><th>Método</th><th>Parcelas</th><th>Status</th><th>Emprestou</th></tr></thead>
              <tbody>{c.loans.map((l: any) => (
                <tr key={l.id} className="clickable" onClick={() => nav(`/emprestimos/${l.id}`)}>
                  <td>{l.code}</td><td>{date(l.startDate)}</td><td className="num">{brl(l.principal)}</td><td>{METHODS[l.method as keyof typeof METHODS]}</td>
                  <td>{l.installments.map((i: any) => <StatusBadge key={i.id} status={i.status} late={i.status === 'PENDENTE' ? daysLate(i.dueDate) : 0} />)}</td><td>{l.status}</td><td>{l.lender?.name}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {importing && <WhatsappImport onClose={() => setImporting(false)} onApply={(f) => { setC((p) => ({ ...p, ...f })); setImporting(false); setTab(0); }} />}
      {!isOwner(me) && null}
    </>
  );
}

function WhatsappImport({ onClose, onApply }: { onClose: () => void; onApply: (f: Record<string, string>) => void }) {
  const [text, setText] = useState('');
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    if (!text.trim()) return setR(null);
    const t = setTimeout(() => api('/clients/import/preview', { body: { text } }).then(setR).catch(() => undefined), 250);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <Modal title="Importar ficha do WhatsApp" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Cole a mensagem. Aceita linha <code>NOME;CPF;RG;NASCIMENTO;…</code> ou bloco <code>Nome: … CPF: …</code>.
      </p>
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={'Nome: Maria Souza\nCPF: 529.982.247-25\nTelefone: 11 98888-7777\nCEP: 01001-000'} />
      {r && (
        <div style={{ marginTop: 12 }}>
          <div className="row"><b>{r.preview}</b><span className="muted">formato {r.format.toLowerCase()}</span></div>
          {r.warnings.map((w: string) => <div key={w} className="alert warn" style={{ marginTop: 8 }}>{w}</div>)}
          <div className="table-wrap" style={{ marginTop: 8, maxHeight: 220 }}>
            <table className="dense"><tbody>{Object.entries(r.fields).map(([k, v]) => <tr key={k}><td className="muted">{r.labels?.[k] ?? k}</td><td>{String(v)}</td></tr>)}</tbody></table>
          </div>
          {r.missing.length > 0 && <div className="muted" style={{ marginTop: 6 }}>Faltando: {r.missing.join(', ')}</div>}
        </div>
      )}
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" disabled={!r?.found} onClick={() => onApply(r.fields)}>Preencher ficha</button>
      </div>
    </Modal>
  );
}
