import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import type { Nav } from '../../App';
import { api, brl, date } from '../api';
import { Button, Card, Empty, ErrorText, Input, st } from '../ui';

/** Biometria do celular (digital / Face ID). Retorna false se o aparelho não tiver. */
async function biometric(): Promise<boolean | 'cancelado'> {
  if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return false;
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirme para aprovar', fallbackLabel: 'Usar senha do celular' });
  return r.success ? true : 'cancelado';
}

export default function Approvals({ nav, onChange }: { nav: Nav; onChange: () => void }) {
  const [list, setList] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const owner = nav.me.role !== 'FUNCIONARIO';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await api<any[]>('/payments/pending'));
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
    onChange();
  }, [onChange]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (p: any, pwd?: string) => {
    setError('');
    try {
      let body: Record<string, unknown>;
      if (pwd) body = { password: pwd };
      else {
        const b = await biometric();
        if (b === 'cancelado') return;
        if (!b) return setPasswordFor(p.id); // sem biometria: pede a senha
        body = { biometricVerified: true };
      }
      await api(`/payments/${p.id}/approve`, body);
      setPasswordFor(null);
      setPassword('');
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const reject = async (p: any) => {
    try {
      await api(`/payments/${p.id}/reject`, { reason: 'Recusado pelo app' });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={st.h1}>Aprovações</Text>
      <Text style={st.muted}>Só juros e quitação ficam travados até o Dono aprovar. Quem lançou não aprova.</Text>
      <ErrorText text={error} />
      {list.length === 0 && !loading && <Empty text="Nada aguardando aprovação." />}
      {list.map((p) => (
        <Card key={p.id} style={{ gap: 6 }}>
          <View style={st.between}>
            <Text style={st.bold}>{p.loan.client.name}</Text>
            <Text style={st.bold}>{brl(p.amount)}</Text>
          </View>
          <Text style={st.muted}>
            #{p.loan.code} · {p.type === 'JUROS' ? `Só juros da ${p.installment?.number}ª` : 'Quitação total'} · por {p.createdBy.name} em {date(p.createdAt)}
          </Text>
          {owner && p.createdById !== nav.me.id ? (
            passwordFor === p.id ? (
              <View style={{ gap: 8 }}>
                <Input label="Sua senha do LendControl" value={password} onChangeText={setPassword} secureTextEntry />
                <Button title="Aprovar com senha" kind="primary" onPress={() => approve(p, password)} disabled={!password} />
              </View>
            ) : (
              <View style={st.row}>
                <View style={{ flex: 1 }}><Button title="🔐 Aprovar" kind="primary" onPress={() => approve(p)} /></View>
                <View style={{ flex: 1 }}><Button title="Recusar" kind="danger" onPress={() => reject(p)} /></View>
              </View>
            )
          ) : (
            <Text style={st.muted}>Aguardando o Dono</Text>
          )}
        </Card>
      ))}
    </ScrollView>
  );
}
