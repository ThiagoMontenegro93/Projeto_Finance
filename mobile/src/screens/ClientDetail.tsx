import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import type { Nav } from '../../App';
import { api, brl, date, waLink } from '../api';
import { Badge, Button, C, Card, ErrorText, st } from '../ui';

export default function ClientDetail({ id, nav }: { id: string; nav: Nav }) {
  const [c, setC] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/clients/${id}`).then(setC).catch((e) => setError(e.message));
  }, [id]);

  const phone = c?.whatsapp || c?.phone;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Pressable onPress={nav.back}><Text style={{ color: C.accent, fontSize: 16 }}>‹ Voltar</Text></Pressable>
      <ErrorText text={error} />
      {c && (
        <>
          <View style={st.between}>
            <Text style={[st.h1, { flex: 1 }]}>{c.name}</Text>
            <Badge status={c.scoreStatus} />
          </View>
          {c.blocked && <Text style={st.error}>🔒 Bloqueado — NÃO EMPRESTAR. {c.blockedReason}</Text>}
          <Card style={{ gap: 4 }}>
            <Text style={st.text}>CPF {c.cpf}</Text>
            <Text style={st.text}>Score {c.score}/10 · margem {brl(c.creditLimit)}</Text>
            {c.street && <Text style={st.muted}>{c.street}, {c.number} — {c.district}, {c.city}/{c.state}</Text>}
            {c.guarantor && <Text style={st.muted}>Fiador: {c.guarantor.name}</Text>}
            {c.emergencyName && <Text style={st.muted}>Emergência: {c.emergencyName} {c.emergencyPhone}</Text>}
          </Card>
          {phone && (
            <View style={st.row}>
              <View style={{ flex: 1 }}><Button title="WhatsApp" kind="primary" onPress={() => Linking.openURL(waLink(phone, `Olá ${c.name.split(' ')[0]}!`))} /></View>
              <View style={{ flex: 1 }}><Button title="Ligar" onPress={() => Linking.openURL(`tel:${phone.replace(/\D/g, '')}`)} /></View>
            </View>
          )}
          {c.guarantor?.whatsapp && (
            <Button title={`WhatsApp do fiador (${c.guarantor.name.split(' ')[0]})`} onPress={() => Linking.openURL(waLink(c.guarantor.whatsapp, `Olá ${c.guarantor.name.split(' ')[0]}, tudo bem?`))} />
          )}
          {c.strategies?.length > 0 && (
            <Card>
              <Text style={st.bold}>Estratégias de cobrança</Text>
              {c.strategies.map((s: string) => <Text key={s} style={st.muted}>• {s}</Text>)}
            </Card>
          )}
          <Text style={st.h2}>Empréstimos</Text>
          {c.loans.map((l: any) => {
            const open = l.installments.filter((i: any) => i.status === 'PENDENTE');
            return (
              <Pressable key={l.id} onPress={() => nav.push({ name: 'loan', id: l.id })}>
                <Card>
                  <View style={st.between}>
                    <Text style={st.bold}>#{l.code} · {brl(l.principal)}</Text>
                    <Text style={st.muted}>{l.status}</Text>
                  </View>
                  <Text style={st.muted}>{open.length ? `${open.length} parcela(s) em aberto · próxima ${date(open[0].dueDate)}` : 'Sem parcelas em aberto'}</Text>
                </Card>
              </Pressable>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}
