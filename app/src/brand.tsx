// Nombre de la empresa, solo con letras (sin el símbolo): "SOLUCIONES" grande y debajo
// "CREATIVAS Y TURÍSTICAS S.A.S" entre dos líneas finas, como en su logo.
import React from 'react';
import { Text, View } from 'react-native';

export function CompanyWordmark({ color, muted, scale = 1 }: { color: string; muted: string; scale?: number }) {
  return (
    <View style={{ alignSelf: 'flex-start' }} accessibilityRole="image" accessibilityLabel="Soluciones Creativas y Turísticas S.A.S">
      <Text style={{ color, fontSize: 24 * scale, fontWeight: '300', letterSpacing: 1.5 * scale }}>SOLUCIONES</Text>
      <View style={{ height: 1, backgroundColor: muted, marginVertical: 3 * scale }} />
      <Text style={{ color: muted, fontSize: 9.5 * scale, fontWeight: '700', letterSpacing: 1.1 * scale }}>CREATIVAS Y TURÍSTICAS S.A.S</Text>
    </View>
  );
}
