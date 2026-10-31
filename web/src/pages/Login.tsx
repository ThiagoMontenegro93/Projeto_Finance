import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, auth } from '../api';
import { Alert, Field } from '../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const nav = useNavigate();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ accessToken: string }>('/auth/login', { body: { email, password } });
      auth.set(r.accessToken);
      nav('/');
    } catch (err: any) {
      setError(err.message);
    }
  };
  return (
    <div className="login">
      <form className="panel" onSubmit={submit}>
        <div className="brand" style={{ padding: '0 0 16px', fontSize: 20 }}>Lend<span style={{ color: 'var(--accent)' }}>Control</span></div>
        <Alert>{error}</Alert>
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="E-mail"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></Field>
          <Field label="Senha"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <button className="primary" type="submit">Entrar</button>
        </div>
      </form>
    </div>
  );
}
