import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api, auth, download } from './api';
import { toast } from './components/ui';
import Approvals from './pages/Approvals';
import ClientForm from './pages/ClientForm';
import Clients from './pages/Clients';
import Collection from './pages/Collection';
import Dashboard from './pages/Dashboard';
import DataPage from './pages/DataPage';
import LoanDetail from './pages/LoanDetail';
import Loans from './pages/Loans';
import Login from './pages/Login';
import Settings from './pages/Settings';
import Team from './pages/Team';

export interface Me { id: string; name: string; role: 'SUPER_ADMIN' | 'DONO' | 'FUNCIONARIO'; email: string }
const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx)!;
export const isOwner = (m: Me) => m.role !== 'FUNCIONARIO';

const ROLE: Record<Me['role'], string> = { SUPER_ADMIN: 'Super Admin', DONO: 'Dono', FUNCIONARIO: 'Funcionário' };

function Shell() {
  const [me, setMe] = useState<Me | null>(null);
  const [pending, setPending] = useState(0);
  const nav = useNavigate();

  useEffect(() => {
    api<Me>('/auth/me').then(setMe).catch(() => nav('/login'));
    const load = () => api<unknown[]>('/payments/pending').then((p) => setPending(p.length)).catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [nav]);

  // Atalhos: Ctrl+N novo empréstimo · Ctrl+E exportar Excel completo
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'n') { e.preventDefault(); nav('/emprestimos?novo=1'); }
      if (k === 'e') {
        e.preventDefault();
        toast('Gerando planilha…');
        download('/backup/export', 'lendcontrol.xlsx').catch((err) => toast(err.message));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [nav]);

  if (!me) return <div className="empty">Carregando…</div>;
  const owner = isOwner(me);
  return (
    <MeCtx.Provider value={me}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">Lend<span>Control</span></div>
          <nav className="nav">
            <NavLink to="/" end>Painel</NavLink>
            <NavLink to="/clientes">Clientes</NavLink>
            <NavLink to="/emprestimos">Empréstimos</NavLink>
            <NavLink to="/aprovacoes">Aprovações {pending > 0 && <span className="badge count">{pending}</span>}</NavLink>
            <NavLink to="/cobranca">Cobrança</NavLink>
            <NavLink to="/equipe">{owner ? 'Equipe e carteira' : 'Minha carteira'}</NavLink>
            {owner && <NavLink to="/dados">Exportar / Importar</NavLink>}
            {owner && <NavLink to="/configuracoes">Configurações</NavLink>}
          </nav>
          <div className="me">
            <div style={{ fontWeight: 600 }}>{me.name}</div>
            <div className="muted">{ROLE[me.role]}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Ctrl+N novo · Ctrl+E exportar</div>
            <button style={{ marginTop: 8, width: '100%' }} onClick={() => { auth.set(null); nav('/login'); }}>Sair</button>
          </div>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/clientes" element={<Clients />} />
            <Route path="/clientes/:id" element={<ClientForm />} />
            <Route path="/emprestimos" element={<Loans />} />
            <Route path="/emprestimos/:id" element={<LoanDetail />} />
            <Route path="/aprovacoes" element={<Approvals onChange={setPending} />} />
            <Route path="/cobranca" element={<Collection />} />
            <Route path="/equipe" element={<Team />} />
            <Route path="/dados" element={<DataPage />} />
            <Route path="/configuracoes" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </MeCtx.Provider>
  );
}

/** Lê o token na hora de renderizar (não no primeiro render do App). */
function Protected() {
  return auth.token ? <Shell /> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<Protected />} />
    </Routes>
  );
}
