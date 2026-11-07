import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

export const C = {
  bg: '#F6F7F9', surface: '#FFFFFF', line: '#E5E7EB', text: '#0F172A', muted: '#64748B',
  accent: '#0F766E', accentSoft: '#E6F4F2', danger: '#DC2626', warn: '#EA580C', ok: '#16A34A',
};

export const SCORE: Record<string, { bg: string; fg: string; label: string }> = {
  BOM: { bg: '#DCFCE7', fg: '#166534', label: '⭐ Bom' },
  REGULAR: { bg: '#DBEAFE', fg: '#1E40AF', label: 'Regular' },
  RUIM: { bg: '#FFEDD5', fg: '#9A3412', label: '⚠️ Ruim' },
  PERDA: { bg: '#111827', fg: '#F9FAFB', label: '💀 Perda' },
};

export function Badge({ status }: { status: string }) {
  const s = SCORE[status] ?? SCORE.REGULAR;
  return (
    <View style={[st.badge, { backgroundColor: s.bg }]}>
      <Text style={[st.badgeText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

export function Pill({ text, color = C.danger }: { text: string; color?: string }) {
  return (
    <View style={[st.badge, { backgroundColor: color }]}>
      <Text style={[st.badgeText, { color: '#fff' }]}>{text}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[st.card, style]}>{children}</View>;
}

export function Button({ title, onPress, kind = 'default', disabled, loading }: { title: string; onPress: () => void; kind?: 'default' | 'primary' | 'danger'; disabled?: boolean; loading?: boolean }) {
  const primary = kind === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [st.btn, primary && st.btnPrimary, kind === 'danger' && { borderColor: '#FECACA' }, (pressed || disabled) && { opacity: 0.6 }]}
    >
      {loading ? <ActivityIndicator color={primary ? '#fff' : C.accent} /> : (
        <Text style={[st.btnText, primary && { color: '#fff' }, kind === 'danger' && { color: C.danger }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={st.label}>{props.label}</Text>
      <TextInput placeholderTextColor="#94A3B8" {...props} style={[st.input, props.style]} />
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return <Text style={st.empty}>{text}</Text>;
}

export function ErrorText({ text }: { text?: string }) {
  if (!text) return null;
  return <Text style={st.error}>{text}</Text>;
}

export const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  h1: { fontSize: 22, fontWeight: '700', color: C.text },
  h2: { fontSize: 16, fontWeight: '600', color: C.text, marginTop: 8, marginBottom: 6 },
  muted: { color: C.muted, fontSize: 13 },
  text: { color: C.text, fontSize: 15 },
  bold: { color: C.text, fontSize: 15, fontWeight: '600' },
  card: { backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  btn: { borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: C.surface, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: C.accent, borderColor: C.accent },
  btnText: { color: C.text, fontWeight: '600', fontSize: 15 },
  label: { fontSize: 13, fontWeight: '500', color: '#334155' },
  input: { backgroundColor: '#FFFFFF', color: '#0F172A', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  empty: { color: C.muted, textAlign: 'center', padding: 24 },
  error: { color: '#991B1B', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 8, padding: 10 },
  value: { fontSize: 20, fontWeight: '700', color: C.text },
});
