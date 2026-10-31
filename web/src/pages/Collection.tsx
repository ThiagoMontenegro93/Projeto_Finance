import { useState } from 'react';
import { isOwner, useMe } from '../App';
import { api, date } from '../api';
import { Alert, Modal, toast, useAsync } from '../components/ui';

const LABEL: Record<string, string> = { D_MENOS_2: 'D-2', D_0: 'D-0', D_MAIS_1: 'D+1', D_MAIS_3: 'D+3', D_MAIS_7: 'D+7 + fiador' };

export default function Collection() {
  const me = useMe();
  const queue = useAsync(() => api<any[]>('/messages/queue'));
  const status = useAsync(() => api('/messages/whatsapp/status'));
  const log = useAsync(() => api<any[]>('/messages/log'));
  const [qr, setQr] = useState<any>(null);
  const [templates, setTemplates] = useState<any[] | null>(null);
  const connected = status.data?.state === 'open';

  const sendAll = async () => {
    const r = await api('/messages/send', { body: {} });
    toast(r.channel === 'EVOLUTION' ? `${r.total} mensagens enviadas` : `${r.total} links wa.me gerados`);
    queue.reload(); log.reload();
  };
  return (
    <>
      <div className="page-head">
        <h1>Cobrança</h1>
        <span className={`badge ${connected ? 's-BOM' : 's-RUIM'}`}>WhatsApp: {status.data?.configured ? (connected ? 'conectado' : status.data.state) : 'Evolution API não configurada — usando wa.me'}</span>
        <div className="actions">
          {isOwner(me) && <button onClick={async () => setTemplates(await api('/messages/templates'))}>Editar mensagens</button>}
          {isOwner(me) && status.data?.configured && !connected && <button onClick={async () => setQr(await api('/messages/whatsapp/qr'))}>Conectar (QR code)</button>}
          <button className="primary" onClick={sendAll} disabled={!queue.data?.some((q) => !q.alreadySent)}>{connected ? 'Enviar fila do dia' : 'Registrar fila do dia'}</button>
        </div>
      </div>
      <h2>Fila de hoje (D-2, D-0, D+1, D+3, D+7)</h2>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table className="dense">
          <thead><tr><th>Régua</th><th>Para</th><th>Cliente</th><th>Mensagem</th><th></th></tr></thead>
          <tbody>{queue.data?.map((q) => (
            <tr key={q.installmentId + q.templateCode + q.toPhone}>
              <td><b>{LABEL[q.templateCode]}</b></td><td>{q.recipient === 'FIADOR' ? 'Fiador' : 'Cliente'} · {q.toPhone}</td><td>{q.clientName}</td>
              <td style={{ whiteSpace: 'normal', maxWidth: 480 }}>{q.body}</td>
              <td><a className="btn" href={q.waLink} target="_blank" rel="noreferrer">{q.alreadySent ? 'Enviado ✓' : 'Abrir no WhatsApp'}</a></td>
            </tr>
          ))}</tbody>
        </table>
        {queue.data && !queue.data.length && <div className="empty">Nenhuma mensagem para hoje.</div>}
      </div>
      <h2>Histórico</h2>
      <div className="table-wrap">
        <table className="dense">
          <thead><tr><th>Data</th><th>Régua</th><th>Cliente</th><th>Canal</th><th>Status</th></tr></thead>
          <tbody>{log.data?.map((m) => <tr key={m.id}><td>{date(m.createdAt)}</td><td>{LABEL[m.templateCode]}</td><td>{m.client.name}</td><td>{m.channel}</td><td>{m.status}{m.error ? ` — ${m.error}` : ''}</td></tr>)}</tbody>
        </table>
      </div>
      {qr && (
        <Modal title="Conectar WhatsApp" onClose={() => { setQr(null); status.reload(); }}>
          {qr.base64 ? <img src={qr.base64} alt="QR code" style={{ width: 280, display: 'block', margin: '0 auto' }} /> : <Alert>Não foi possível obter o QR code.</Alert>}
          <p className="muted" style={{ textAlign: 'center' }}>WhatsApp → Aparelhos conectados → Conectar aparelho.{qr.pairingCode && <> Código: <b>{qr.pairingCode}</b></>}</p>
        </Modal>
      )}
      {templates && (
        <Modal title="Mensagens pré-programadas" onClose={() => setTemplates(null)}>
          <p className="muted" style={{ marginTop: 0 }}>Variáveis: {'{nome} {parcela} {valor} {valor_atual} {vencimento} {dias} {pix} {fiador}'}</p>
          {templates.map((t, i) => (
            <div key={t.code} style={{ marginBottom: 12 }}>
              <div className="row"><b>{LABEL[t.code]}</b><label className="row muted" style={{ fontSize: 12 }}><input type="checkbox" style={{ width: 'auto' }} checked={t.active} onChange={(e) => setTemplates(templates.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} /> ativa</label></div>
              <textarea style={{ minHeight: 70, fontFamily: 'inherit' }} value={t.body} onChange={(e) => setTemplates(templates.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
            </div>
          ))}
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="primary" onClick={async () => { await api('/messages/templates', { method: 'PUT', body: templates }); toast('Mensagens salvas'); setTemplates(null); queue.reload(); }}>Salvar</button></div>
        </Modal>
      )}
    </>
  );
}
