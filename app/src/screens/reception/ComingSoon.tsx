// Módulos en construcción (Bodega y Facturación): qué van a hacer cuando estén listos.
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { C } from '../../ui';
import { InvoiceGlyph, WarehouseGlyph } from '../../icons';

const BODEGA = [
  { title: 'Existencias', text: 'Cuánto hay de cada producto en la bodega, siempre al día.' },
  { title: 'Entradas', text: 'Registrar lo que llega del proveedor.' },
  { title: 'Salidas al surtir', text: 'Cada habitación surtida descuenta de la bodega sola.' },
  { title: 'Vencidos y dañados', text: 'Los cambios de producto se descuentan con su motivo.' },
  { title: 'Alertas', text: 'Aviso cuando un producto está por acabarse.' },
  { title: 'Con Siigo', text: 'Los movimientos cuadran con el inventario de Siigo.' },
];

const FACTURACION = [
  { title: 'Factura sola', text: 'Cada revisión con consumo genera su factura en Siigo, sin ningún botón.' },
  { title: 'Consulta', text: 'Ver las facturas del día y de cada habitación.' },
  { title: 'Estado', text: 'Saber cuáles ya están en Siigo y cuáles esperan conexión.' },
  { title: 'DIAN', text: 'Factura electrónica enviada a la DIAN desde Siigo.' },
  { title: 'Novedades', text: 'Lo no reconocido se reversa con nota crédito.' },
  { title: 'Reportes', text: 'Totales facturados por día y por producto.' },
];

export function BodegaPanel() {
  return <ComingSoon Icon={WarehouseGlyph} title="Bodega" text="Estamos construyendo el control de la bodega del minibar. Esto es lo que va a traer:" items={BODEGA} />;
}

export function FacturacionPanel() {
  return (
    <ComingSoon
      Icon={InvoiceGlyph}
      title="Facturación"
      text="Estamos construyendo la facturación del minibar con Siigo. Esto es lo que va a traer:"
      items={FACTURACION}
    />
  );
}

function ComingSoon({
  Icon,
  title,
  text,
  items,
}: {
  Icon: (p: { size?: number; color?: string }) => React.ReactElement;
  title: string;
  text: string;
  items: { title: string; text: string }[];
}) {
  return (
    <ScrollView contentContainerStyle={st.page}>
      <View style={st.hero}>
        <View style={st.icon}>
          <Icon size={34} color={C.brand} />
        </View>
        <View style={st.badge}>
          <Text style={st.badgeText}>EN CONSTRUCCIÓN</Text>
        </View>
        <Text style={st.title}>{title}</Text>
        <Text style={st.text}>{text}</Text>
      </View>
      <View style={st.grid}>
        {items.map((c) => (
          <View key={c.title} style={st.item}>
            <Text style={st.itemTitle}>{c.title}</Text>
            <Text style={st.itemText}>{c.text}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { padding: 24, gap: 18, maxWidth: 900, width: '100%', alignSelf: 'center' },
  hero: { alignItems: 'center', gap: 10, paddingVertical: 28, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line, paddingHorizontal: 20 },
  icon: { width: 68, height: 68, borderRadius: 18, backgroundColor: '#EEF2FE', alignItems: 'center', justifyContent: 'center' },
  badge: { backgroundColor: '#FFF8E1', borderColor: '#E0A800', borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: '#8A6D12', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  title: { fontSize: 24, fontWeight: '800', color: C.ink },
  text: { fontSize: 15, color: C.muted, textAlign: 'center', maxWidth: 460, lineHeight: 21 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  item: { flexGrow: 1, flexBasis: 240, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed', padding: 16, gap: 4 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  itemText: { fontSize: 13, color: C.muted, lineHeight: 18 },
});
