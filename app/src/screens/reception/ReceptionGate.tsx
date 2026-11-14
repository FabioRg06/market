// Puerta de recepción: usuario y contraseña antes de ver el hotel.
// La primera vez (cuando el servidor aún no tiene cuenta) se crea aquí mismo.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { api, session } from '../../api';
import { C } from '../../ui';
import { DoorGlyph } from '../../icons';
import { CompanyWordmark } from '../../brand';

const NAVY = '#0B1640';

type Mode = 'loading' | 'offline' | 'setup' | 'login' | 'in';

export default function ReceptionGate({ children, onChangeRole }: { children: React.ReactNode; onChangeRole: () => void }) {
  const { width } = useWindowDimensions();
  const wide = width >= 860;
  const [mode, setMode] = useState<Mode>('loading');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      const st = await api.get<{ configured: boolean; signedIn: boolean }>('/api/auth/status');
      setMode(!st.configured ? 'setup' : st.signedIn ? 'in' : 'login');
    } catch {
      setMode('offline');
    }
  }, []);
  useEffect(() => {
    check();
    // Si el servidor da la sesión por vencida, se vuelve a pedir.
    return session.onChange(() => {
      if (!session.token) setMode((m) => (m === 'in' ? 'login' : m));
    });
  }, [check]);

  async function submit() {
    setError(null);
    if (mode === 'setup' && password !== repeat) return setError('Las dos contraseñas no son iguales.');
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; token?: string; error?: string }>(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', {
        user,
        password,
      });
      if (!res.ok || !res.token) return setError(res.error ?? 'No se pudo entrar.');
      session.set(res.token);
      setPassword('');
      setRepeat('');
      setMode('in');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'in') return <>{children}</>;

  const setup = mode === 'setup';
  const ready = user.trim().length >= 3 && password.length >= (setup ? 6 : 1) && (!setup || repeat.length > 0);

  return (
    <View style={[st.root, { flexDirection: wide ? 'row' : 'column' }]}>
      <View style={[st.brand, wide ? st.brandWide : st.brandNarrow]}>
        <View style={st.mark}>
          <DoorGlyph size={26} color="#FFFFFF" />
        </View>
        <Text style={st.name}>Market</Text>
        <Text style={st.tagline}>Minibar · Recepción</Text>
        {wide && (
          <View style={{ marginTop: 'auto' }}>
            <CompanyWordmark color="#FFFFFF" muted="#9FB0DC" />
          </View>
        )}
      </View>

      <View style={st.side}>
        {mode === 'loading' ? (
          <ActivityIndicator color={C.brand} />
        ) : mode === 'offline' ? (
          <View style={st.form}>
            <Text style={st.title}>Sin conexión con el servidor</Text>
            <Text style={st.text}>Revisa que Market esté abierto en el computador de recepción.</Text>
            <Pressable onPress={check} style={st.button} accessibilityRole="button">
              <Text style={st.buttonText}>Reintentar</Text>
            </Pressable>
          </View>
        ) : (
          <View style={st.form}>
            <Text style={st.title}>{setup ? 'Crea el acceso de recepción' : 'Entrar a recepción'}</Text>
            <Text style={st.text}>
              {setup
                ? 'Es la primera vez en este computador. Elige el usuario y la contraseña que usará recepción.'
                : 'Escribe el usuario y la contraseña de recepción.'}
            </Text>
            <Text style={st.label}>Usuario</Text>
            <TextInput
              value={user}
              onChangeText={setUser}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              style={st.input}
              onSubmitEditing={submit}
              accessibilityLabel="Usuario"
            />
            <Text style={st.label}>Contraseña{setup ? ' (mínimo 6 caracteres)' : ''}</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              style={st.input}
              onSubmitEditing={submit}
              accessibilityLabel="Contraseña"
            />
            {setup && (
              <>
                <Text style={st.label}>Repite la contraseña</Text>
                <TextInput
                  value={repeat}
                  onChangeText={setRepeat}
                  secureTextEntry
                  autoCapitalize="none"
                  style={st.input}
                  onSubmitEditing={submit}
                  accessibilityLabel="Repite la contraseña"
                />
              </>
            )}
            {error && (
              <Text style={st.error} accessibilityRole="alert">
                {error}
              </Text>
            )}
            <Pressable onPress={submit} disabled={!ready || busy} style={[st.button, (!ready || busy) && { opacity: 0.45 }]} accessibilityRole="button">
              <Text style={st.buttonText}>{busy ? 'Un momento…' : setup ? 'Crear y entrar' : 'Entrar'}</Text>
            </Pressable>
            <Pressable onPress={onChangeRole} style={{ alignSelf: 'center', padding: 8 }} accessibilityRole="button">
              <Text style={st.link}>Usar este dispositivo para revisar habitaciones</Text>
            </Pressable>
          </View>
        )}
        {!wide && (
          <View style={{ marginTop: 28 }}>
            <CompanyWordmark color={C.ink} muted={C.muted} />
          </View>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  brand: { backgroundColor: NAVY, padding: 32 },
  brandWide: { width: '40%', maxWidth: 480, padding: 48 },
  brandNarrow: { paddingTop: 56 },
  mark: { width: 52, height: 52, borderRadius: 14, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  name: { color: '#FFFFFF', fontSize: 34, fontWeight: '800', letterSpacing: -0.8, marginTop: 18 },
  tagline: { color: '#9FB0DC', fontSize: 15, marginTop: 4 },
  side: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  form: { width: '100%', maxWidth: 380, gap: 8 },
  title: { fontSize: 24, fontWeight: '800', color: C.ink, letterSpacing: -0.4 },
  text: { fontSize: 14, color: C.muted, lineHeight: 20, marginBottom: 10 },
  label: { fontSize: 13, fontWeight: '600', color: C.body, marginTop: 6 },
  input: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    fontSize: 16,
    color: C.ink,
  },
  error: { color: C.danger, fontSize: 14, fontWeight: '600', marginTop: 6 },
  button: { height: 48, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  link: { color: C.brand, fontSize: 13, fontWeight: '600' },
});
