// Gráficas del panel de analítica. Una sola serie por gráfica (azul rey), marcas delgadas,
// extremos redondeados, cuadrícula discreta; el valor exacto aparece al pasar el mouse.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { C, tabular } from './ui';

export const SERIES = '#2F57D6';
const SERIES_SOFT = '#C9D6F8';

export interface Datum {
  key: string;
  label: string;
  value: number;
  /** Texto del valor (p. ej. "$ 45.000" o "12 u"). */
  display: string;
  /** Segunda línea opcional del tooltip. */
  detail?: string;
}

/** Barras horizontales: ranking (productos, bloques, tipos). */
export function HBars({ data, max: maxIn, emptyText = 'Sin datos en este rango.' }: { data: Datum[]; max?: number; emptyText?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  if (!data.length) return <Text style={st.empty}>{emptyText}</Text>;
  const max = maxIn ?? Math.max(...data.map((d) => d.value), 1);
  return (
    <View style={{ gap: 8 }}>
      {data.map((d) => (
        <Pressable
          key={d.key}
          onHoverIn={() => setHover(d.key)}
          onHoverOut={() => setHover(null)}
          accessibilityLabel={`${d.label}: ${d.display}`}
          style={st.hrow}
        >
          <Text style={st.hlabel} numberOfLines={1}>
            {d.label}
          </Text>
          <View style={st.htrack}>
            <View
              style={[
                st.hbar,
                { width: `${Math.max(1.5, (d.value / max) * 100)}%`, backgroundColor: hover && hover !== d.key ? SERIES_SOFT : SERIES },
              ]}
            />
          </View>
          <Text style={[st.hvalue, tabular]} numberOfLines={1}>
            {d.display}
          </Text>
          {hover === d.key && d.detail ? (
            <View style={st.tipRight} pointerEvents="none">
              <Text style={st.tipText}>{d.detail}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

/** Columnas verticales: series en el tiempo (horas del día, días). */
export function Columns({
  data,
  height = 150,
  labelEvery = 1,
  emptyText = 'Sin datos en este rango.',
}: {
  data: Datum[];
  height?: number;
  labelEvery?: number;
  emptyText?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  if (max === 0) return <Text style={st.empty}>{emptyText}</Text>;
  const peak = data.find((d) => d.value === max)!;
  return (
    <View>
      <View style={[st.cols, { height }]}>
        {/* cuadrícula discreta: mitad y tope */}
        <View style={[st.grid, { top: 0 }]} />
        <View style={[st.grid, { top: height / 2 }]} />
        {data.map((d) => {
          const h = d.value ? Math.max(3, (d.value / max) * (height - 18)) : 0;
          const show = hover === d.key || (!hover && d.key === peak.key);
          return (
            <Pressable
              key={d.key}
              onHoverIn={() => setHover(d.key)}
              onHoverOut={() => setHover(null)}
              accessibilityLabel={`${d.label}: ${d.display}`}
              style={st.colHit}
            >
              {show && (
                <View style={[st.tipTop, { bottom: h + 6 }]} pointerEvents="none">
                  <Text style={st.tipText} numberOfLines={1}>
                    {d.display}
                  </Text>
                </View>
              )}
              <View style={[st.col, { height: h, backgroundColor: hover && hover !== d.key ? SERIES_SOFT : SERIES }]} />
            </Pressable>
          );
        })}
      </View>
      <View style={st.axis}>
        {data.map((d, i) => (
          <Text key={d.key} style={st.tick} numberOfLines={1}>
            {i % labelEvery === 0 ? d.label : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  empty: { color: C.muted, fontSize: 13, paddingVertical: 24, textAlign: 'center' },
  hrow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 24 },
  hlabel: { width: 130, fontSize: 13, color: C.body },
  htrack: { flex: 1, height: 12, justifyContent: 'center' },
  hbar: { height: 12, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  hvalue: { width: 84, textAlign: 'right', fontSize: 13, fontWeight: '600', color: C.ink },
  cols: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, position: 'relative' },
  grid: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#EEF1F7' },
  colHit: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  col: { width: '72%', maxWidth: 26, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  axis: { flexDirection: 'row', gap: 2, marginTop: 6, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 4 },
  tick: { flex: 1, textAlign: 'center', fontSize: 10, color: C.muted },
  tipTop: {
    position: 'absolute',
    backgroundColor: C.ink,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    zIndex: 5,
    minWidth: 54,
    alignItems: 'center',
  },
  tipRight: { position: 'absolute', right: 96, backgroundColor: C.ink, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tipText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
});
