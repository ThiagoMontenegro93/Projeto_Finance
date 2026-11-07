import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, loadSession, logout, Me, setUnauthorizedHandler } from './src/api';
import Approvals from './src/screens/Approvals';
import ClientDetail from './src/screens/ClientDetail';
import Clients from './src/screens/Clients';
import LoanDetail from './src/screens/LoanDetail';
import Login from './src/screens/Login';
import Today from './src/screens/Today';
import Wallet from './src/screens/Wallet';
import { C, st } from './src/ui';

export type Route = { name: 'client'; id: string } | { name: 'loan'; id: string };
export interface Nav {
  push: (r: Route) => void;
  back: () => void;
  me: Me;
}

const TABS = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'aprovacoes', label: 'Aprovações' },
  { key: 'carteira', label: 'Carteira' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('hoje');
  const [stack, setStack] = useState<Route[]>([]);
  const [badges, setBadges] = useState<{ aprovacoes: number; hoje: number }>({ aprovacoes: 0, hoje: 0 });

  const signOut = useCallback(async () => {
    await logout();
    setStack([]);
    setMe(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => signOut());
    loadSession()
      .then(({ server, token }) => (server && token ? api<Me>('/auth/me').then(setMe) : setMe(null)))
      .catch(() => setMe(null));
  }, [signOut]);

  const refreshBadges = useCallback(() => {
    if (!me) return;
    Promise.all([api<any[]>('/payments/pending'), api<any[]>('/messages/queue')])
      .then(([p, q]) => setBadges({ aprovacoes: p.length, hoje: q.filter((m) => !m.alreadySent && !m.missingPhone).length }))
      .catch(() => undefined);
  }, [me]);
  useEffect(refreshBadges, [refreshBadges, tab, stack.length]);

  // Botão voltar do Android
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length) {
        setStack((s) => s.slice(0, -1));
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length]);

  if (me === undefined) {
    return <View style={[st.screen, { justifyContent: 'center' }]}><ActivityIndicator color={C.accent} /></View>;
  }
  if (me === null) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={st.screen}><Login onLogin={setMe} /></SafeAreaView>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  const nav: Nav = { push: (r) => setStack((s) => [...s, r]), back: () => setStack((s) => s.slice(0, -1)), me };
  const top = stack[stack.length - 1];

  return (
    <SafeAreaProvider>
      <SafeAreaView style={st.screen} edges={['top', 'left', 'right']}>
        {top?.name === 'client' && <ClientDetail key={top.id} id={top.id} nav={nav} />}
        {top?.name === 'loan' && <LoanDetail key={top.id} id={top.id} nav={nav} />}
        {!top && (
          <>
            <View style={{ flex: 1 }}>
              {tab === 'hoje' && <Today nav={nav} />}
              {tab === 'clientes' && <Clients nav={nav} />}
              {tab === 'aprovacoes' && <Approvals nav={nav} onChange={refreshBadges} />}
              {tab === 'carteira' && <Wallet nav={nav} onLogout={signOut} />}
            </View>
          </>
        )}
      </SafeAreaView>
      {!top && (
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line }}>
          <View style={{ flexDirection: 'row' }}>
            {TABS.map((t) => {
              const count = t.key === 'aprovacoes' ? badges.aprovacoes : t.key === 'hoje' ? badges.hoje : 0;
              const active = tab === t.key;
              return (
                <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10 }} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                  <View style={st.row}>
                    <Text style={{ color: active ? C.accent : C.muted, fontWeight: active ? '700' : '500' }}>{t.label}</Text>
                    {count > 0 && (
                      <View style={{ backgroundColor: C.danger, borderRadius: 999, minWidth: 18, paddingHorizontal: 5 }}>
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', textAlign: 'center' }}>{count}</Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </SafeAreaView>
      )}
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
