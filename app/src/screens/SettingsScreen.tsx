import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api } from '../api';
import { getSettings, saveSettings } from '../settings';
import { syncNow, useSyncState } from '../local/sync';
import { localDbAvailable } from '../local/db';
import { time } from '../format';
import { Btn, C, Card, Header, Input, Screen, s } from '../ui';

function SyncStatus() {
  const sync = useSyncState();
  return (
    <Card style={{ gap: 6 }}>
      <Text style={s.label}>Envío a recepción</Text>
      <Text style={s.h2}>
        {sync.pending
          ? `${sync.pending} ${sync.pending === 1 ? 'habitación' : 'habitaciones'} por enviar`
          : 'Todo enviado'}
      </Text>
      <Text style={s.muted}>
        {sync.online ? `Conectado · último envío ${time(sync.lastSync)}` : 'Sin conexión con recepción. Lo revisado queda guardado aquí y se envía solo.'}
      </Text>
      <Btn title={sync.syncing ? 'Enviando…' : 'Enviar ahora'} variant="secondary" disabled={sync.syncing} onPress={syncNow} style={{ marginTop: 6 }} />
    </Card>
  );
}

export default function SettingsScreen({ onBack, onChangeRole }: { onBack: () => void; onChangeRole?: () => void }) {
  const [serverUrl, setServerUrl] = useState('');
  const [name, setName] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then((st) => {
      setServerUrl(st.serverUrl);
      setName(st.inspectorName);
      setDeviceId(st.deviceId);
    });
  }, []);

  async function save() {
    await saveSettings({ serverUrl, inspectorName: name.trim() });
    setStatus('Probando conexión…');
    try {
      await api.get('/api/health');
      if (localDbAvailable) await syncNow();
      setStatus('Guardado. Conectado al servidor de recepción.');
    } catch (e: any) {
      setStatus(`Guardado. No se pudo conectar ahora (${e.message}). Se seguirá intentando solo.`);
    }
  }

  return (
    <Screen>
      <Header title="Ajustes" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <View>
          <Text style={s.label}>Tu nombre (quien revisa)</Text>
          <Input value={name} onChangeText={setName} placeholder="Ej. María López" />
        </View>
        <View>
          <Text style={s.label}>Dirección del servidor de recepción</Text>
          <Input
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="http://192.168.1.10:4000"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={[s.muted, { marginTop: 6 }]}>
            Es la dirección que muestra el computador de recepción al iniciar el servidor ("Para los teléfonos").
          </Text>
        </View>
        <Btn title="Guardar" onPress={save} />
        {localDbAvailable && <SyncStatus />}
        {status && (
          <Card>
            <Text style={{ color: C.ink }}>{status}</Text>
          </Card>
        )}
        {onChangeRole && <Btn title="Cambiar de vista" variant="secondary" onPress={onChangeRole} />}
        <Text style={s.muted}>Id del dispositivo: {deviceId}</Text>
      </ScrollView>
    </Screen>
  );
}
