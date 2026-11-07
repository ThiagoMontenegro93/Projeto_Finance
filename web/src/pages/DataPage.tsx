import { useState } from 'react';
import { api, date, download } from '../api';
import { Alert, DropZone, toast, useAsync } from '../components/ui';

const CSVS = [
  ['clientes', 'Clientes'], ['emprestimos', 'Empréstimos'], ['parcelas', 'Parcelas'],
  ['pagamentos', 'Pagamentos'], ['equipe', 'Equipe'], ['movimentacoes', 'Movimentações'],
] as const;

const AREA: Record<string, string> = { equipe: 'Equipe', clientes: 'Clientes', emprestimos: 'Empréstimos', parcelas: 'Parcelas', pagamentos: 'Pagamentos', movimentacoes: 'Movimentações' };

const KIND: Record<string, string> = { AUTOMATICO: 'Automático', MANUAL: 'Manual', RESTAURACAO: 'Importação', MODELO: 'Modelo' };

export default function DataPage() {
  const history = useAsync(() => api<any[]>('/backup'));
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const dl = (path: string, name: string) => download(path, name).catch((e) => toast(e.message));

  const check = async (f: File) => {
    setFile(f); setReport(null); setBusy(true);
    const form = new FormData(); form.append('file', f);
    try { setReport(await api('/backup/restore?dryRun=true', { form })); } catch (e: any) { setReport({ ok: false, errors: [e.message], warnings: [], counts: {} }); }
    setBusy(false);
  };
  const apply = async () => {
    if (!file) return;
    setBusy(true);
    const form = new FormData(); form.append('file', file);
    try {
      const r = await api('/backup/restore', { form });
      setReport(r); setFile(null); toast('Dados importados'); history.reload();
    } catch (e: any) { toast(e.message); }
    setBusy(false);
  };

  return (
    <>
      <div className="page-head"><h1>Exportar / Importar</h1></div>
      <div className="grid2">
        <div className="panel">
          <h2>1 · Exportar (retirar os dados)</h2>
          <p className="muted" style={{ marginTop: 0 }}>Planilha completa com 7 abas e as fórmulas BANE: dá para tocar o negócio só pelo Excel se o sistema cair.</p>
          <div className="row" style={{ marginBottom: 12 }}>
            <button className="primary" onClick={() => dl('/backup/export', 'lendcontrol.xlsx')}>Baixar Excel completo <span className="kbd">Ctrl+E</span></button>
            <button onClick={() => dl('/backup/template', 'modelo.xlsx')}>Modelo vazio (500 linhas)</button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Ou uma tabela só, em CSV leve:</div>
          <div className="row">{CSVS.map(([k, l]) => <button key={k} onClick={() => dl(`/backup/export/${k}.csv`, `${k}.csv`)}>{l}</button>)}</div>
        </div>
        <div className="panel">
          <h2>2 · Importar (devolver os dados)</h2>
          <p className="muted" style={{ marginTop: 0 }}>Arraste o Excel exportado (inteiro ou só algumas abas) ou um CSV. Primeiro mostramos a prévia; nada é apagado — registros com o mesmo ID ou CPF são atualizados, os novos são incluídos.</p>
          <DropZone accept=".xlsx,.csv" onFile={check}>{busy ? 'Lendo…' : file ? <>📄 {file.name} — clique para trocar</> : 'Arraste o arquivo .xlsx ou .csv aqui'}</DropZone>
          {report && (
            <div style={{ marginTop: 12 }}>
              {report.errors?.map((e: string) => <Alert key={e}>{e}</Alert>)}
              {report.warnings?.slice(0, 8).map((w: string) => <Alert key={w} kind="warn">{w}</Alert>)}
              {report.ok && (
                <>
                  <Alert kind="ok">{report.dryRun ? 'Arquivo válido. Confira e confirme:' : 'Importação concluída.'}</Alert>
                  <table className="dense" style={{ marginBottom: 10 }}>
                    <thead><tr><th>Área</th><th className="num">{report.dryRun ? 'Linhas' : 'Incluídos'}</th>{!report.dryRun && <><th className="num">Atualizados</th><th className="num">Ignorados</th></>}</tr></thead>
                    <tbody>{Object.entries(report.counts).map(([k, c]: any) => (
                      <tr key={k}><td>{AREA[k] ?? k}</td><td className="num">{c.created}</td>{!report.dryRun && <><td className="num">{c.updated}</td><td className="num">{c.skipped}</td></>}</tr>
                    ))}</tbody>
                  </table>
                  {report.dryRun && <button className="primary" disabled={busy} onClick={apply}>Importar agora</button>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <h2>Backups automáticos (toda segunda 08:00 · últimos 10)</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        <button onClick={async () => { await api('/backup', { body: {} }); toast('Backup gerado'); history.reload(); }}>Gerar backup agora</button>
      </div>
      <div className="table-wrap">
        <table className="dense">
          <thead><tr><th>Data</th><th>Tipo</th><th>Status</th><th>Arquivo</th><th className="num">Registros</th><th>E-mail</th><th></th></tr></thead>
          <tbody>{history.data?.map((b) => (
            <tr key={b.id}>
              <td>{date(b.createdAt)} {new Date(b.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
              <td>{KIND[b.kind] ?? b.kind}</td><td>{b.status}{b.error ? ` — ${b.error}` : ''}</td><td>{b.fileName}</td><td className="num">{b.rowsCount}</td><td>{b.emailedTo ?? '—'}</td>
              <td>{b.available && <button onClick={() => dl(`/backup/files/${encodeURIComponent(b.fileName)}`, b.fileName)}>Baixar</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        {history.data && !history.data.length && <div className="empty">Nenhum backup ainda.</div>}
      </div>
    </>
  );
}
