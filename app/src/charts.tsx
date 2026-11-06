// Gráficas del panel de analítica (SVG + vistas). Paleta pastel validada para daltonismo en
// este orden; como varios tonos tienen poco contraste sobre blanco, toda gráfica muestra
// su valor o su leyenda en texto. Al pasar el mouse se ve el dato exacto.
import React, { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { C, ProductPicture, tabular } from './ui';

/** Orden fijo: el color sigue a la categoría, nunca a su posición en un ranking. */
export const PALETTE = ['#5B7CF0', '#E58A3E', '#2FAE8D', '#9177EC', '#E2709E', '#3AA6D9', '#C99A1E'];
/** Fondo pastel de cada color (mismo orden). */
export const TINT = ['#EEF2FE', '#FDF1E7', '#E7F6F1', '#F1EEFD', '#FCEEF4', '#E8F5FB', '#F9F3E2'];

export interface Datum {
  key: string;
  label: string;
  value: number;
  /** Texto del valor (p. ej. "$ 45.000" o "12 u"). */
  display: string;
  /** Segunda línea del tooltip. */
  detail?: string;
  color?: string;
  /** Foto del producto (barras de productos). */
  image?: { id: string; uri: string | null };
}

function useWidth() {
  const [w, setW] = useState(0);
  return [w, (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)] as const;
}

const Empty = ({ text = 'Sin datos en este rango.' }: { text?: string }) => <Text style={st.empty}>{text}</Text>;

// ---------- Dona ----------

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
}

/** Proporción de un todo (≤ 6 partes). Leyenda siempre visible con valor y porcentaje. */
export function Donut({
  data,
  size = 168,
  thickness = 22,
  center,
}: {
  data: Datum[];
  size?: number;
  thickness?: number;
  center?: { value: string; label: string };
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = data.reduce((t, d) => t + d.value, 0);
  if (!total) return <Empty />;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const gap = data.filter((d) => d.value > 0).length > 1 ? 0.035 : 0; // espacio de 2px entre tramos
  let a = -Math.PI / 2;
  const segs = data.map((d, i) => {
    const sweep = (d.value / total) * Math.PI * 2;
    const seg = { d, color: d.color ?? PALETTE[i % PALETTE.length], a0: a + gap / 2, a1: a + sweep - gap / 2 };
    a += sweep;
    return seg;
  });
  const active = segs.find((x) => x.d.key === hover);
  return (
    <View style={st.donutWrap}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={c} cy={c} r={r} stroke="#F1F4F9" strokeWidth={thickness} fill="none" />
          {segs.map((x) =>
            x.d.value > 0 ? (
              <Path
                key={x.d.key}
                d={x.a1 - x.a0 >= Math.PI * 2 - 0.01 ? arc(c, c, r, -Math.PI / 2, Math.PI * 1.4999) : arc(c, c, r, x.a0, Math.max(x.a0 + 0.001, x.a1))}
                stroke={x.color}
                strokeWidth={hover === x.d.key ? thickness + 6 : thickness}
                strokeLinecap="butt"
                fill="none"
                opacity={hover && hover !== x.d.key ? 0.35 : 1}
              />
            ) : null
          )}
        </Svg>
        <View style={st.donutCenter} pointerEvents="none">
          <Text style={[st.donutValue, tabular]} numberOfLines={1}>
            {active ? active.d.display : center?.value}
          </Text>
          <Text style={st.donutLabel} numberOfLines={1}>
            {active ? active.d.label : center?.label}
          </Text>
        </View>
      </View>
      <View style={{ flex: 1, gap: 6, minWidth: 150 }}>
        {segs.map((x) => (
          <Pressable
            key={x.d.key}
            onHoverIn={() => setHover(x.d.key)}
            onHoverOut={() => setHover(null)}
            style={[st.legendRow, hover === x.d.key && { backgroundColor: '#F5F7FC' }]}
          >
            <View style={[st.swatch, { backgroundColor: x.color }]} />
            <Text style={st.legendLabel} numberOfLines={1}>
              {x.d.label}
            </Text>
            <Text style={[st.legendValue, tabular]}>{x.d.display}</Text>
            <Text style={[st.legendPct, tabular]}>{Math.round((x.d.value / total) * 100)}%</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ---------- Área (serie en el tiempo) ----------

export function AreaChart({
  data,
  color = PALETTE[0],
  height = 190,
  labelEvery = 1,
}: {
  data: Datum[];
  color?: string;
  height?: number;
  labelEvery?: number;
}) {
  const [w, onLayout] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  if (!max) return <Empty />;
  const top = 26;
  const plotH = height - top - 6;
  const x = (i: number) => (data.length === 1 ? w / 2 : (i / (data.length - 1)) * (w - 16) + 8);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  // Curva suave (Catmull-Rom → Bézier), sin pasar por debajo de cero.
  let line = `M${x(0)} ${y(data[0].value)}`;
  for (let i = 0; i < data.length - 1; i++) {
    const p0 = data[Math.max(0, i - 1)].value, p1 = data[i].value, p2 = data[i + 1].value, p3 = data[Math.min(data.length - 1, i + 2)].value;
    const c1y = Math.min(top + plotH, y(p1 + (p2 - p0) / 6));
    const c2y = Math.min(top + plotH, y(p2 - (p3 - p1) / 6));
    const dx = (x(i + 1) - x(i)) / 3;
    line += ` C${x(i) + dx} ${c1y} ${x(i + 1) - dx} ${c2y} ${x(i + 1)} ${y(p2)}`;
  }
  const area = `${line} L${x(data.length - 1)} ${top + plotH} L${x(0)} ${top + plotH} Z`;
  const peak = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0);
  const show = hover ?? peak;
  const gid = `g${color.slice(1)}`;
  return (
    <View onLayout={onLayout}>
      {w > 0 && (
        <View style={{ height }}>
          <Svg width={w} height={height}>
            <Defs>
              <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={0.32} />
                <Stop offset="1" stopColor={color} stopOpacity={0.02} />
              </LinearGradient>
            </Defs>
            {[0.5, 1].map((f) => (
              <Path key={f} d={`M0 ${top + plotH * (1 - f)} H${w}`} stroke="#EEF1F7" strokeWidth={1} />
            ))}
            <Path d={area} fill={`url(#${gid})`} />
            <Path d={line} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
            <Path d={`M${x(show)} ${top} V${top + plotH}`} stroke={color} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 3" />
            <Circle cx={x(show)} cy={y(data[show].value)} r={5} fill={C.surface} stroke={color} strokeWidth={2.5} />
          </Svg>
          <View style={[st.tip, { left: Math.min(Math.max(0, x(show) - 110), w - 220), top: 0 }]} pointerEvents="none">
            <Text style={st.tipText} numberOfLines={1}>
              {data[show].label} · {data[show].display}
            </Text>
          </View>
          {/* zonas para el mouse */}
          <View style={StyleSheet.absoluteFill}>
            <View style={{ flex: 1, flexDirection: 'row' }}>
              {data.map((d, i) => (
                <Pressable key={d.key} style={{ flex: 1 }} onHoverIn={() => setHover(i)} onHoverOut={() => setHover(null)} accessibilityLabel={`${d.label}: ${d.display}`} />
              ))}
            </View>
          </View>
        </View>
      )}
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

// ---------- Barras horizontales (ranking) ----------

export function HBars({ data, max: maxIn, labelWidth = 150 }: { data: Datum[]; max?: number; labelWidth?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  if (!data.length) return <Empty />;
  const max = maxIn ?? Math.max(...data.map((d) => d.value), 1);
  return (
    <View style={{ gap: 6 }}>
      {data.map((d, i) => {
        const color = d.color ?? PALETTE[i % PALETTE.length];
        return (
          <Pressable
            key={d.key}
            onHoverIn={() => setHover(d.key)}
            onHoverOut={() => setHover(null)}
            accessibilityLabel={`${d.label}: ${d.display}${d.detail ? `, ${d.detail}` : ''}`}
            style={[st.hrow, hover === d.key && { backgroundColor: '#F7F9FD' }]}
          >
            {d.image && (
              <View style={st.thumb}>
                <ProductPicture id={d.image.id} image={d.image.uri} size={18} fill shrink={/pequeñ/i.test(d.label) ? 0.65 : 1} />
              </View>
            )}
            <Text style={[st.hlabel, { width: labelWidth }]} numberOfLines={1}>
              {d.label}
            </Text>
            <View style={st.htrack}>
              <View style={[st.hbar, { width: `${Math.max(2, (d.value / max) * 100)}%`, backgroundColor: color, opacity: hover && hover !== d.key ? 0.4 : 1 }]} />
            </View>
            <Text style={[st.hvalue, tabular]} numberOfLines={1}>
              {d.display}
            </Text>
            <Text style={[st.hdetail, tabular]} numberOfLines={1}>
              {d.detail ?? ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- Columnas (categorías) ----------

export function Columns({ data, height = 170 }: { data: Datum[]; height?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  if (!max) return <Empty />;
  return (
    <View>
      <View style={[st.cols, { height }]}>
        <View style={[st.grid, { top: 22 }]} />
        <View style={[st.grid, { top: 22 + (height - 22) / 2 }]} />
        {data.map((d, i) => {
          const h = d.value ? Math.max(4, (d.value / max) * (height - 26)) : 0;
          const color = d.color ?? PALETTE[i % PALETTE.length];
          return (
            <Pressable key={d.key} onHoverIn={() => setHover(d.key)} onHoverOut={() => setHover(null)} accessibilityLabel={`${d.label}: ${d.display}`} style={st.colHit}>
              <Text style={[st.colValue, tabular, hover === d.key && { color: C.ink }]} numberOfLines={1}>
                {d.display}
              </Text>
              <View style={[st.col, { height: h, backgroundColor: color, opacity: hover && hover !== d.key ? 0.4 : 1 }]} />
            </Pressable>
          );
        })}
      </View>
      <View style={st.axis}>
        {data.map((d) => (
          <Text key={d.key} style={[st.tick, { fontSize: 11, color: C.body }]} numberOfLines={1}>
            {d.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ---------- Mapa de calor (día × hora) ----------

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
// Rampa secuencial de un solo tono (azul rey), de claro a oscuro.
const RAMP = ['#F1F4FC', '#D9E2FB', '#B7C8F7', '#8EA8F2', '#5B7CF0', '#2F57D6', '#1E3A9C'];

export function Heatmap({ grid }: { grid: number[][] }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...grid.flat(), 0);
  if (!max) return <Empty />;
  const shade = (v: number) => (v ? RAMP[Math.min(RAMP.length - 1, 1 + Math.floor((v / max) * (RAMP.length - 2)))] : RAMP[0]);
  const [d, h] = (hover ?? '').split(':').map(Number);
  return (
    <View style={{ gap: 3 }}>
      <Text style={[st.heatInfo, tabular]}>
        {hover ? `${DAYS[d]} ${String(h).padStart(2, '0')}:00 · ${grid[d][h]} revisiones` : 'Pasa el mouse sobre una celda'}
      </Text>
      {grid.map((row, di) => (
        <View key={di} style={st.heatRow}>
          <Text style={st.heatDay}>{DAYS[di]}</Text>
          {row.map((v, hi) => (
            <Pressable
              key={hi}
              onHoverIn={() => setHover(`${di}:${hi}`)}
              onHoverOut={() => setHover(null)}
              accessibilityLabel={`${DAYS[di]} ${hi}:00, ${v} revisiones`}
              style={[st.heatCell, { backgroundColor: shade(v) }, hover === `${di}:${hi}` && { borderColor: C.ink, borderWidth: 1.5 }]}
            />
          ))}
        </View>
      ))}
      <View style={st.heatRow}>
        <Text style={st.heatDay} />
        {Array.from({ length: 24 }, (_, i) => (
          <Text key={i} style={st.heatHour}>
            {i % 3 === 0 ? String(i).padStart(2, '0') : ''}
          </Text>
        ))}
      </View>
      <View style={[st.heatRow, { justifyContent: 'flex-end', gap: 3, marginTop: 4 }]}>
        <Text style={st.heatLegend}>menos</Text>
        {RAMP.map((c) => (
          <View key={c} style={[st.heatKey, { backgroundColor: c }]} />
        ))}
        <Text style={st.heatLegend}>más</Text>
      </View>
    </View>
  );
}

// ---------- Mini tendencia para indicadores ----------

export function Sparkline({ values, color, width = 90, height = 28 }: { values: number[]; color: string; width?: number; height?: number }) {
  const max = Math.max(...values, 0);
  if (values.length < 2 || !max) return null;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width} ${height - 2 - (v / max) * (height - 4)}`);
  return (
    <Svg width={width} height={height}>
      <Path d={`M${pts.join(' L')}`} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

const st = StyleSheet.create({
  empty: { color: C.muted, fontSize: 13, paddingVertical: 28, textAlign: 'center' },
  donutWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 22 },
  donutCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  donutValue: { fontSize: 20, fontWeight: '800', color: C.ink, letterSpacing: -0.4 },
  donutLabel: { fontSize: 11, color: C.muted, marginTop: 1 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 8 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { flex: 1, fontSize: 13, color: C.body },
  legendValue: { fontSize: 13, fontWeight: '700', color: C.ink },
  legendPct: { width: 40, textAlign: 'right', fontSize: 12, color: C.muted },
  tip: { position: 'absolute', width: 220, alignItems: 'center' },
  tipText: { backgroundColor: C.ink, color: '#FFFFFF', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  axis: { flexDirection: 'row', gap: 2, marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: C.line },
  tick: { flex: 1, textAlign: 'center', fontSize: 10, color: C.muted },
  hrow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 30, paddingHorizontal: 4, borderRadius: 8 },
  thumb: { width: 26, height: 26, borderRadius: 6, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 2 },
  hlabel: { fontSize: 13, color: C.body },
  htrack: { flex: 1, height: 14, borderRadius: 7, backgroundColor: '#F3F5FA', overflow: 'hidden' },
  hbar: { height: 14, borderRadius: 7 },
  hvalue: { width: 74, textAlign: 'right', fontSize: 13, fontWeight: '700', color: C.ink },
  hdetail: { width: 84, textAlign: 'right', fontSize: 12, color: C.muted },
  cols: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, position: 'relative' },
  grid: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#EEF1F7' },
  colHit: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  colValue: { fontSize: 11, fontWeight: '700', color: C.body },
  col: { width: '70%', maxWidth: 46, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  heatInfo: { fontSize: 12, color: C.muted, marginBottom: 4 },
  heatRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  heatDay: { width: 32, fontSize: 11, color: C.muted },
  heatCell: { flex: 1, height: 20, borderRadius: 4, borderWidth: 1, borderColor: 'transparent' },
  heatHour: { flex: 1, fontSize: 10, color: C.muted, textAlign: 'left' },
  heatLegend: { fontSize: 10, color: C.muted, marginHorizontal: 4 },
  heatKey: { width: 14, height: 10, borderRadius: 2 },
});
