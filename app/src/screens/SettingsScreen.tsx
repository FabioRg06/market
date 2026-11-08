import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { api } from '../api';
import { getSettings, saveSettings } from '../settings';
import { syncNow, useSyncState } from '../local/sync';
import { listWorkers, localDbAvailable } from '../local/db';
import { time } from '../format';
import { discoverServer } from '../discovery';
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
  const [workerId, setWorkerId] = useState<string | null>(null);
  const workers = localDbAvailable ? listWorkers() : [];
  const [deviceId, setDeviceId] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then((st) => {
      setServerUrl(st.serverUrl);
      setName(st.inspectorName);
      setWorkerId(st.workerId);
      setDeviceId(st.deviceId);
    });
  }, []);

  async function save() {
    await saveSettings({ serverUrl, inspectorName: name.trim(), workerId });
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
          <Text style={s.label}>¿Quién eres?</Text>
          {workers.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {workers.map((w) => {
                const on = workerId === w.id;
                return (
                  <Pressable
                    key={w.id}
                    onPress={() => {
                      setWorkerId(on ? null : w.id);
                      setName(on ? '' : w.name);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 9,
                      borderRadius: 999,
                      borderWidth: 1.5,
                      borderColor: on ? C.brand : C.line,
                      backgroundColor: on ? '#EEF2FF' : C.surface,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: on ? '700' : '500', color: on ? C.brand : C.body }}>{w.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          <Input
            value={name}
            onChangeText={(t) => {
              setName(t);
              setWorkerId(null);
            }}
            placeholder={workers.length ? 'O escribe tu nombre' : 'Tu nombre'}
          />
          {workerId ? <Text style={[s.muted, { marginTop: 6 }]}>Verás primero las habitaciones que te asignó recepción.</Text> : null}
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
            Normalmente no hace falta: la app encuentra sola el servidor si está en el mismo wifi.
          </Text>
        </View>
        <Btn title="Guardar" onPress={save} />
        {Platform.OS !== 'web' && (
          <Btn
            title="Buscar el servidor en esta red"
            variant="secondary"
            onPress={async () => {
              setStatus('Buscando el servidor de recepción en el wifi…');
              const url = await discoverServer();
              if (url) {
                setServerUrl(url);
                setStatus(`Encontrado: ${url}`);
                syncNow();
              } else setStatus('No se encontró. Revisa que el computador de recepción esté encendido y en el mismo wifi.');
            }}
          />
        )}
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
