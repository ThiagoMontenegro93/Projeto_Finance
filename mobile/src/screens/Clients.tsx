import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { Nav } from '../../App';
import { api, brl } from '../api';
import { Badge, Card, Empty, ErrorText, Input, st } from '../ui';

export default function Clients({ nav }: { nav: Nav }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async (term = q) => {
    setLoading(true);
    try {
      setList(await api<any[]>(`/clients?q=${encodeURIComponent(term)}`));
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };
  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <FlatList
      data={list}
      keyExtractor={(c) => c.id}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} />}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          <Text style={st.h1}>Clientes</Text>
          <Input label="Buscar" value={q} onChangeText={setQ} placeholder="Nome, CPF ou telefone" />
          <ErrorText text={error} />
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text="Nenhum cliente encontrado." />}
      renderItem={({ item: c }) => {
        const open = c.loans.flatMap((l: any) => l.installments);
        const total = open.reduce((s: number, i: any) => s + Number(i.amount), 0);
        return (
          <Pressable onPress={() => nav.push({ name: 'client', id: c.id })}>
            <Card>
              <View style={st.between}>
                <Text style={st.bold}>{c.name}{c.blocked ? ' 🔒' : ''}</Text>
                <Badge status={c.scoreStatus} />
              </View>
              <View style={[st.between, { marginTop: 6 }]}>
                <Text style={st.muted}>{c.cpf}</Text>
                <Text style={st.muted}>Em aberto {brl(total)}</Text>
              </View>
            </Card>
          </Pressable>
        );
      }}
    />
  );
}
