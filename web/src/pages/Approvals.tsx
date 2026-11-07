import { useEffect, useState } from 'react';
import { isOwner, useMe } from '../App';
import { api, brl, date } from '../api';
import { Alert, toast, useAsync } from '../components/ui';

/** Biometria do aparelho (WebAuthn: digital/Face ID/Windows Hello). Sem suporte, cai para senha. */
async function biometric(): Promise<boolean> {
  if (!window.PublicKeyCredential || !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.())) return false;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const stored = localStorage.getItem('lendcontrol.webauthn');
    if (!stored) {
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge, rp: { name: 'LendControl' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'aprovador', displayName: 'Aprovador LendControl' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' }, timeout: 60000,
        },
      })) as PublicKeyCredential | null;
      if (!cred) return false;
      localStorage.setItem('lendcontrol.webauthn', btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
      return true;
    }
    const id = Uint8Array.from(atob(stored), (ch) => ch.charCodeAt(0));
    const ok = await navigator.credentials.get({ publicKey: { challenge, allowCredentials: [{ type: 'public-key', id }], userVerification: 'required', timeout: 60000 } });
    return !!ok;
  } catch {
    return false;
  }
}

export default function Approvals({ onChange }: { onChange: (n: number) => void }) {
  const me = useMe();
  const { data, reload, error } = useAsync(() => api<any[]>('/payments/pending'));
  const [msg, setMsg] = useState('');
  useEffect(() => { if (data) onChange(data.length); }, [data, onChange]);

  const approve = async (p: any) => {
    setMsg('');
    let body: any = { biometricVerified: await biometric() };
    if (!body.biometricVerified) {
      const password = prompt('Biometria indisponível. Confirme sua senha para aprovar:');
      if (!password) return;
      body = { password };
    }
    try {
      await api(`/payments/${p.id}/approve`, { body });
      toast('Aprovado');
      reload();
    } catch (e: any) {
      setMsg(e.message);
    }
  };
  const reject = async (p: any) => {
    const reason = prompt('Motivo da recusa');
    if (!reason) return;
    await api(`/payments/${p.id}/reject`, { body: { reason } });
    reload();
  };
  return (
    <>
      <div className="page-head"><h1>Aprovações</h1><span className="muted">Pagamentos de só juros e quitação ficam travados até o Dono aprovar. Quem lançou não pode aprovar.</span></div>
      <Alert>{error || msg}</Alert>
      <div className="table-wrap">
        <table className="dense">
          <thead><tr><th>Lançado em</th><th>Cliente</th><th>Empréstimo</th><th>Tipo</th><th>Parcela</th><th className="num">Valor</th><th>Lançado por</th><th></th></tr></thead>
          <tbody>{data?.map((p) => (
            <tr key={p.id}>
              <td>{date(p.createdAt)}</td><td>{p.loan.client.name}</td><td>#{p.loan.code}</td><td>{p.type === 'JUROS' ? 'Só juros' : 'Quitação'}</td>
              <td>{p.installment ? `${p.installment.number}ª · ${date(p.installment.dueDate)}` : 'todas'}</td><td className="num">{brl(p.amount)}</td><td>{p.createdBy.name}</td>
              <td>{isOwner(me) && p.createdById !== me.id ? (
                <div className="row"><button className="primary" onClick={() => approve(p)}>🔐 Aprovar</button><button className="danger" onClick={() => reject(p)}>Recusar</button></div>
              ) : <span className="muted">aguardando Dono</span>}</td>
            </tr>
          ))}</tbody>
        </table>
        {data && !data.length && <div className="empty">Nada aguardando aprovação.</div>}
      </div>
    </>
  );
}
