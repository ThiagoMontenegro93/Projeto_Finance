import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { Nav } from '../../App';
import { api, brl, date } from '../api';
import { Badge, Button, C, Card, Empty, ErrorText, Pill, st } from '../ui';

const LABEL: Record<string, string> = { D_MENOS_2: 'D-2', D_0: 'Vence hoje', D_MAIS_1: 'D+1', D_MAIS_3: 'D+3', D_MAIS_7: 'D+7' };
const label = (c: string) => LABEL[c] ?? (c.startsWith('ATRASO_SEMANAL_D') ? `D+${c.slice(16)}` : c);

export default function Today({ nav }: { nav: Nav }) {
  const [dash, setDash] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, q] = await Promise.all([api('/dashboard'), api<any[]>('/messages/queue')]);
      setDash(d);
      setQueue(q);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const register = async () => {
    try {
      await api('/messages/send', {});
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const pending = queue.filter((q) => !q.alreadySent && !q.missingPhone);
  const c = dash?.cards;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={st.h1}>Olá, {nav.me.name.split(' ')[0]}</Text>
      <ErrorText text={error} />
      {c && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {[
            ['Disponível', brl(c.capitalDisponivel)],
            ['Na rua', brl(c.capitalEmprestado)],
            ['Recebido no mês', brl(c.recebidoMes)],
            ['Em atraso', brl(c.emAtraso)],
          ].map(([l, v], i) => (
            <Card key={l} style={{ flexBasis: '47%', flexGrow: 1 }}>
              <Text style={st.muted}>{l}</Text>
              <Text style={[st.value, i === 3 && Number(c.emAtraso) > 0 ? { color: C.danger } : null]}>{v}</Text>
            </Card>
          ))}
        </View>
      )}

      <View style={st.between}>
        <Text style={st.h2}>Cobrar hoje ({queue.length})</Text>
        {pending.length > 0 && <Pill text={`${pending.length} a enviar`} />}
      </View>
      {queue.length === 0 && <Empty text="Nenhuma cobrança da régua para hoje." />}
      {queue.map((q) => (
        <Card key={q.installmentId + q.templateCode + q.toPhone + q.recipient}>
          <View style={st.between}>
            <Text style={st.bold}>{q.clientName}</Text>
            <Text style={[st.muted, { fontWeight: '700' }]}>{label(q.templateCode)}{q.recipient === 'FIADOR' ? ' · fiador' : ''}</Text>
          </View>
          <Text style={[st.muted, { marginVertical: 6 }]} numberOfLines={3}>{q.body}</Text>
          {q.missingPhone ? <Text style={{ color: C.danger }}>Sem WhatsApp cadastrado</Text> : (
            <Button title={q.alreadySent ? 'Registrado ✓ · abrir WhatsApp' : 'Enviar no WhatsApp'} kind={q.alreadySent ? 'default' : 'primary'} onPress={() => Linking.openURL(q.waLink)} />
          )}
        </Card>
      ))}
      {pending.length > 0 && <Button title="Marcar fila do dia como enviada" onPress={register} />}

      <Text style={st.h2}>Atrasados ({dash?.overdue?.length ?? 0})</Text>
      {dash?.overdue?.length === 0 && <Empty text="Nenhuma parcela em atraso 🎉" />}
      {dash?.overdue?.map((o: any) => (
        <Pressable key={o.id} onPress={() => nav.push({ name: 'loan', id: o.loanId })}>
          <Card>
            <View style={st.between}>
              <Text style={st.bold}>{o.client.name}</Text>
              <Badge status={o.client.scoreStatus} />
            </View>
            <View style={[st.between, { marginTop: 6 }]}>
              <Text style={st.muted}>Parcela {o.number} · venceu {date(o.dueDate)}</Text>
              <Text style={{ color: C.danger, fontWeight: '700' }}>{o.daysLate}d · {brl(o.currentValue)}</Text>
            </View>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
