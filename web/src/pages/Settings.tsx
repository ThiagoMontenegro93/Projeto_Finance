import { useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, Field, toast } from '../components/ui';

export default function Settings() {
  const [s, setS] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/settings').then(setS).catch((e) => setError(e.message)); }, []);
  if (!s) return <Alert>{error || 'Carregando…'}</Alert>;
  const up = (k: string) => (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value });
  const save = async () => {
    try { setS(await api('/settings', { method: 'PUT', body: s })); toast('Configurações salvas'); setError(''); } catch (e: any) { setError(e.message); }
  };
  return (
    <>
      <div className="page-head"><h1>Configurações</h1><div className="actions"><button className="primary" onClick={save}>Salvar</button></div></div>
      <Alert>{error}</Alert>
      <div className="panel">
        <h2>Backup semanal</h2>
        <div className="form-grid">
          <Field label="E-mail que recebe o backup toda segunda 08:00 (separe vários com vírgula)" className="span2">
            <input type="text" value={s.backup_email} onChange={up('backup_email')} placeholder="voce@exemplo.com" />
          </Field>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>O envio usa o servidor SMTP definido no arquivo .env do backend (SMTP_HOST, SMTP_USER…).</p>
      </div>
      <div className="panel">
        <h2>Padrões</h2>
        <div className="form-grid">
          <Field label="Nome da empresa"><input value={s.company_name} onChange={up('company_name')} /></Field>
          <Field label="Chave PIX para recebimento (vai nas mensagens)"><input value={s.pix_key} onChange={up('pix_key')} /></Field>
          <Field label="Envio automático da régua às 09:00">
            <select value={s.messages_auto_send} onChange={up('messages_auto_send')}><option value="false">Desligado (envio manual)</option><option value="true">Ligado</option></select>
          </Field>
          <Field label="Taxa padrão (0,10 = 10%)"><input value={s.default_interest_rate} onChange={up('default_interest_rate')} /></Field>
          <Field label="Multa por dia padrão (0,01 = 1%)"><input value={s.default_late_fee_daily_rate} onChange={up('default_late_fee_daily_rate')} /></Field>
        </div>
      </div>
    </>
  );
}
