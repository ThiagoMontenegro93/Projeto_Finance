import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import type { Nav } from '../../App';
import { api, brl, date } from '../api';
import { Button, C, Card, ErrorText, Input, st } from '../ui';

export default function Wallet({ nav, onLogout }: { nav: Nav; onLogout: () => void }) {
  const [w, setW] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [me, l] = await Promise.all([api('/wallet'), api<any[]>('/wallet/ledger')]);
      setW(me);
      setLedger(l.slice(0, 30));
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const repassar = async () => {
    setError('');
    setOk('');
    const value = Number(amount.replace(/\./g, '').replace(',', '.'));
    if (!(value > 0)) return setError('Informe um valor');
    try {
      await api('/wallet/transfers', { type: 'REPASSE_RECEBIMENTO', userId: w.ownerId, amount: value });
      setOk(`Repasse de ${brl(value)} registrado.`);
      setAmount('');
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={st.h1}>Minha carteira</Text>
      <ErrorText text={error} />
      {ok ? <Text style={{ color: C.ok }}>{ok}</Text> : null}
      {w && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {[
            ['Disponível', w.capitalDisponivel],
            ['Emprestado', w.capitalEmprestado],
            ['Comissão', w.comissaoAcumulada],
            ['A repassar ao Dono', w.saldoARepassar],
          ].map(([l, v]) => (
            <Card key={l} style={{ flexBasis: '47%', flexGrow: 1 }}>
              <Text style={st.muted}>{l}</Text>
              <Text style={st.value}>{brl(v)}</Text>
            </Card>
          ))}
        </View>
      )}
      {w?.ownerId && Number(w.saldoARepassar) > 0 && (
        <Card style={{ gap: 8 }}>
          <Text style={st.bold}>Repassar ao Dono</Text>
          <Input label="Valor (R$)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={String(Number(w.saldoARepassar).toFixed(2)).replace('.', ',')} />
          <Button title="Registrar repasse" kind="primary" onPress={repassar} />
        </Card>
      )}
      <Text style={st.h2}>Extrato</Text>
      {ledger.map((l) => (
        <View key={l.id} style={[st.between, { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line }]}>
          <View style={{ flex: 1 }}>
            <Text style={st.text}>{l.type.replace(/_/g, ' ').toLowerCase()}</Text>
            <Text style={st.muted}>{date(l.createdAt)}</Text>
          </View>
          <Text style={{ color: Number(l.amount) < 0 ? C.danger : C.ok, fontWeight: '600' }}>{brl(l.amount)}</Text>
        </View>
      ))}
      <Text style={[st.muted, { marginTop: 16 }]}>Conectado como {nav.me.name}</Text>
      <Button title="Sair" onPress={onLogout} />
    </ScrollView>
  );
}
