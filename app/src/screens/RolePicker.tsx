// Primera pantalla: elegir cómo se usa este dispositivo. A la izquierda la marca (azul
// noche, como el menú de recepción); a la derecha las dos formas de trabajar.
import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../ui';
import { ChartGlyph, DoorGlyph } from '../icons';
import { CompanyWordmark } from '../brand';

export type Role = 'revision' | 'recepcion';

const NAVY = '#0B1640';

export default function RolePicker({ onPick }: { onPick: (r: Role) => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 820;

  const options: { role: Role; title: string; text: string; points: string[]; Icon: typeof DoorGlyph; tint: string; color: string }[] = [
    {
      role: 'revision',
      title: 'Revisar habitaciones',
      text: 'Para la tablet de quien entra a las habitaciones.',
      points: ['Marca lo consumido con un toque', 'Funciona sin internet', 'Ve primero tus habitaciones asignadas'],
      Icon: DoorGlyph,
      tint: '#FFF8E1',
      color: '#C99A1E',
    },
    {
      role: 'recepcion',
      title: 'Recepción',
      text: 'Para el computador de recepción.',
      points: ['Estado de todo el hotel en vivo', 'Trabajadores, reportes y analítica', 'Carga el Excel de salidas'],
      Icon: ChartGlyph,
      tint: '#EEF2FE',
      color: C.brand,
    },
  ];

  return (
    <View style={[st.root, { flexDirection: wide ? 'row' : 'column' }]}>
      <View style={[st.brand, wide ? st.brandWide : { paddingTop: insets.top + 32 }]}>
        <View style={st.mark}>
          <DoorGlyph size={26} color="#FFFFFF" />
        </View>
        <Text style={st.name}>Market</Text>
        <Text style={st.tagline}>El minibar de cada habitación, revisado, surtido y cobrado.</Text>
        {wide && (
          <View style={st.stats}>
            <Stat value="Sin señal" label="la tablet guarda todo y lo envía sola" />
            <Stat value="En vivo" label="recepción ve cada revisión al momento" />
          </View>
        )}
        {wide && (
          <View style={{ marginTop: 'auto', paddingTop: 24 }}>
            <CompanyWordmark color="#FFFFFF" muted="#9FB0DC" />
          </View>
        )}
      </View>

      <View style={[st.choose, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={st.question}>¿Cómo vas a usar este dispositivo?</Text>
        <View style={{ gap: 16, width: '100%', maxWidth: 520 }}>
          {options.map(({ role, title, text, points, Icon, tint, color }) => (
            <Pressable
              key={role}
              onPress={() => onPick(role)}
              accessibilityRole="button"
              accessibilityLabel={title}
              style={({ hovered, pressed }: any) => [st.option, (hovered || pressed) && st.optionHover]}
            >
              <View style={[st.icon, { backgroundColor: tint }]}>
                <Icon size={30} color={color} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={st.optionTitle}>{title}</Text>
                <Text style={st.optionText}>{text}</Text>
                <View style={{ gap: 3, marginTop: 6 }}>
                  {points.map((p) => (
                    <Text key={p} style={st.point}>
                      <Text style={{ color }}>●</Text>  {p}
                    </Text>
                  ))}
                </View>
              </View>
              <Text style={st.arrow}>→</Text>
            </Pressable>
          ))}
        </View>
        <Text style={st.foot}>Se puede cambiar después desde Ajustes.</Text>
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: '#8E9CC4', fontSize: 13 }}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  brand: { backgroundColor: NAVY, paddingHorizontal: 28, paddingBottom: 32, gap: 10 },
  brandWide: { width: '42%', maxWidth: 560, justifyContent: 'center', paddingHorizontal: 56 },
  mark: { width: 52, height: 52, borderRadius: 14, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  name: { color: '#FFFFFF', fontSize: 44, fontWeight: '800', letterSpacing: -1.5 },
  tagline: { color: '#C3CCE6', fontSize: 17, lineHeight: 25, maxWidth: 380 },
  stats: { gap: 18, marginTop: 36, paddingTop: 24, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  choose: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 },
  question: { fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.4, textAlign: 'center' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: C.line,
    padding: 22,
  },
  optionHover: { borderColor: C.brand, shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  icon: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontSize: 19, fontWeight: '800', color: C.ink, letterSpacing: -0.3 },
  optionText: { fontSize: 14, color: C.muted },
  point: { fontSize: 13, color: C.body },
  arrow: { fontSize: 24, color: C.faint },
  foot: { fontSize: 12, color: C.faint },
});
