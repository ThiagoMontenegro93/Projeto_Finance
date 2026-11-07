import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { loadSession, login, Me } from '../api';
import { Button, C, ErrorText, Input, st } from '../ui';

export default function Login({ onLogin }: { onLogin: (m: Me) => void }) {
  const [server, setServer] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSession().then((s) => s.server && setServer(s.server));
  }, []);

  const submit = async () => {
    setError('');
    if (!/^https?:\/\//.test(server)) return setError('Endereço do servidor deve começar com http:// ou https://');
    setBusy(true);
    try {
      onLogin(await login(server, email, password));
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
        <Text style={[st.h1, { fontSize: 28, marginBottom: 4 }]}>Lend<Text style={{ color: C.accent }}>Control</Text></Text>
        <Text style={[st.muted, { marginBottom: 20 }]}>Cobrança na palma da mão</Text>
        <View style={{ gap: 14 }}>
          <ErrorText text={error} />
          <Input label="Servidor" value={server} onChangeText={setServer} placeholder="https://seu-servidor.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Input label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Input label="Senha" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
          <Button title="Entrar" kind="primary" onPress={submit} loading={busy} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
