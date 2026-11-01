import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { Nav } from '../../App';
import { api, brl, date, waLink } from '../api';
import { Badge, Button, C, Card, ErrorText, st } from '../ui';

const STATUS: Record<string, string> = { PENDENTE: 'Aberta', PAGO: 'Paga', JUROS_PAGO: 'Só juros', CANCELADO: 'Cancelada' };

export default function LoanDetail({ id, nav }: { id: string; nav: Nav }) {
  const [l, setL] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/loans/${id}`).then(setL).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const pay = (type: 'PARCELA' | 'JUROS' | 'QUITACAO', inst?: any) => {
    const amount = type === 'QUITACAO' ? l.payoff.total : type === 'JUROS' ? Number(inst.interestPart) + (inst.currentValue - Number(inst.amount)) : inst.currentValue;
    const what = type === 'PARCELA' ? `Receber a parcela ${inst.number}` : type === 'JUROS' ? `Receber só os juros da parcela ${inst.number}` : 'Quitar o empréstimo todo';
    const extra = type === 'PARCELA' ? '' : '\n\nVai para aprovação do Dono antes de valer.';
    Alert.alert('Confirmar', `${what}: ${brl(amount)}${extra}`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar',
        onPress: async () => {
          setBusy(true);
          try {
            const r = await api(`/loans/${id}/payments`, { type, installmentId: inst?.id, method: 'PIX' });
            Alert.alert(r.status === 'APROVADO' ? 'Pagamento registrado' : 'Enviado para aprovação 🔒');
            load();
          } catch (e: any) {
            setError(e.message);
          }
          setBusy(false);
        },
      },
    ]);
  };

  const waiting = l?.payments?.some((p: any) => p.status === 'AGUARDANDO_APROVACAO');
  const active = l?.status === 'ATIVO';
  const phone = l?.client?.whatsapp || l?.client?.phone;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Pressable onPress={nav.back}><Text style={{ color: C.accent, fontSize: 16 }}>‹ Voltar</Text></Pressable>
      <ErrorText text={error} />
      {l && (
        <>
          <View style={st.between}>
            <Text style={[st.h1, { flex: 1 }]}>#{l.code} · {l.client.name}</Text>
            <Badge status={l.client.scoreStatus} />
          </View>
          <Card style={{ gap: 4 }}>
            <Text style={st.text}>{brl(l.principal)} · parcela {brl(l.installmentAmount)} · {l.installmentsCount}x</Text>
            {l.payoff && <Text style={st.bold}>Para quitar hoje: {brl(l.payoff.total)}</Text>}
            {l.projection?.length > 0 && <Text style={st.muted}>Próximas datas: {l.projection.map(date).join(' · ')}</Text>}
            <Text style={st.muted}>Status {l.status}</Text>
          </Card>
          {waiting && <Text style={[st.error, { color: '#9A3412', backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}>Há um pagamento aguardando aprovação do Dono.</Text>}
          {phone && <Button title="Cobrar no WhatsApp" onPress={() => Linking.openURL(waLink(phone, `Olá ${l.client.name.split(' ')[0]}! Sobre seu empréstimo #${l.code}: ${l.payoff ? `saldo para quitar hoje ${brl(l.payoff.total)}.` : ''}`))} />}

          <Text style={st.h2}>Parcelas</Text>
          {l.installments.map((i: any) => (
            <Card key={i.id}>
              <View style={st.between}>
                <Text style={st.bold}>{i.number}ª · {date(i.dueDate)}</Text>
                <Text style={{ color: i.daysLate ? C.danger : C.muted, fontWeight: '600' }}>
                  {i.status === 'PENDENTE' && i.daysLate ? `${i.daysLate}d atraso` : STATUS[i.status]}
                </Text>
              </View>
              <Text style={[st.text, { marginVertical: 6 }]}>{i.status === 'PENDENTE' ? `Valor atual ${brl(i.currentValue)}` : brl(i.amount)}</Text>
              {i.status === 'PENDENTE' && active && (
                <View style={st.row}>
                  <View style={{ flex: 1 }}><Button title="Receber" kind="primary" loading={busy} onPress={() => pay('PARCELA', i)} /></View>
                  <View style={{ flex: 1 }}><Button title="Só juros" disabled={waiting} onPress={() => pay('JUROS', i)} /></View>
                </View>
              )}
            </Card>
          ))}
          {active && <Button title="Quitar tudo" kind="danger" disabled={waiting || busy} onPress={() => pay('QUITACAO')} />}
        </>
      )}
    </ScrollView>
  );
}
