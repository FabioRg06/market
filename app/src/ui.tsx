// Sistema visual de Market: azul rey como color de la app (barras, fondo y botones),
// superficies blancas y el estado de cada habitación como único color de las tarjetas.
import React from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LineItem, RoomStatus, RoomType } from './types';
import { money, TYPE_BY_CODE } from './format';
import { ProductImage } from './icons';

export const C = {
  bg: '#EDF1FA',
  brand: '#1E40AF',
  brandDeep: '#172F82',
  onBrand: '#FFFFFF',
  onBrandMuted: '#BFCDF3',
  surface: '#FFFFFF',
  ink: '#0F172A',
  body: '#334155',
  muted: '#64748B',
  faint: '#94A3B8',
  line: '#DCE3F1',
  primary: '#1E40AF',
  danger: '#B42318',
  // Los colores verde/amarillo/naranja/rojo son de los tipos de habitación (SS, SM, CM, PR),
  // así que los estados usan otra gama para no confundirse.
  status: {
    surtida: { tint: '#FFFFFF', border: '#DCE3F1', solid: '#94A3B8', ink: '#475569' },
    por_revisar: { tint: '#EAF0FF', border: '#9DB4F2', solid: '#2F57D6', ink: '#1E3A9C' },
    en_revision: { tint: '#E6F7FA', border: '#8ED3E0', solid: '#0E8FA8', ink: '#0B6577' },
    revisada: { tint: '#F3EEFF', border: '#C9B6F5', solid: '#7247D6', ink: '#4F2CA3' },
  } as Record<RoomStatus, { tint: string; border: string; solid: string; ink: string }>,
};

/** Números con ancho fijo para que las columnas no bailen. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ height: insets.top, backgroundColor: C.brand }} />
      <View style={[{ flex: 1 }, style]}>{children}</View>
    </View>
  );
}

export function Header({
  title,
  eyebrow,
  onBack,
  right,
}: {
  title: string;
  eyebrow?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={s.header}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={12} style={s.back} accessibilityRole="button" accessibilityLabel="Volver">
          <Text style={s.backText}>‹</Text>
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
        <Text style={s.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

export function Btn({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
  textStyle,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const v = {
    primary: { bg: C.primary, fg: '#FFFFFF', border: C.primary },
    secondary: { bg: C.surface, fg: C.ink, border: C.line },
    quiet: { bg: 'transparent', fg: C.muted, border: 'transparent' },
    danger: { bg: C.surface, fg: C.danger, border: C.line },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: v.bg, borderColor: v.border, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      <Text style={[s.btnText, { color: v.fg }, textStyle]}>{title}</Text>
    </Pressable>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  if (onPress)
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }, style]}>
        {children}
      </Pressable>
    );
  return <View style={[s.card, style]}>{children}</View>;
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={C.faint} {...props} style={[s.input, props.style]} />;
}

export function Stepper({ value, onChange, max }: { value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <View style={s.stepper}>
      <Pressable style={[s.stepBtn, value === 0 && { opacity: 0.35 }]} onPress={() => onChange(Math.max(0, value - 1))} hitSlop={6}>
        <Text style={s.stepBtnText}>−</Text>
      </Pressable>
      <Text style={[s.stepValue, tabular]}>{value}</Text>
      <Pressable
        style={[s.stepBtn, max != null && value >= max && { opacity: 0.35 }]}
        onPress={() => onChange(max != null ? Math.min(max, value + 1) : value + 1)}
        hitSlop={6}
      >
        <Text style={s.stepBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

/** Ventana de confirmación (igual en tablet, teléfono y computador). */
export function Confirm({
  visible,
  title,
  message,
  confirmText = 'Sí',
  cancelText = 'No',
  onConfirm,
  onCancel,
  children,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.overlay}>
        <View style={s.dialog}>
          <Text style={s.dialogTitle}>{title}</Text>
          {message ? <Text style={s.dialogMsg}>{message}</Text> : null}
          {children}
          <View style={s.dialogRow}>
            <Btn title={cancelText} variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
            <Btn title={confirmText} onPress={onConfirm} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Etiqueta del tipo de habitación con su color (SS amarillo, SM naranja, CM verde, PR rojo, VIP). */
export function TypeBadge({ type, size = 'sm' }: { type: RoomType; size?: 'sm' | 'md' }) {
  const t = TYPE_BY_CODE[type] ?? TYPE_BY_CODE.CM;
  const md = size === 'md';
  return (
    <View
      accessibilityLabel={`Tipo ${t.name}`}
      style={{ backgroundColor: t.color, borderRadius: 6, paddingHorizontal: md ? 8 : 5, paddingVertical: md ? 3 : 1 }}
    >
      <Text style={{ color: t.ink, fontSize: md ? 12 : 10, fontWeight: '800', letterSpacing: 0.4 }}>{t.code}</Text>
    </View>
  );
}

/** Foto real del producto si recepción la subió; si no, la ilustración. */
export function ProductPicture({ id, image, size, color }: { id: string; image?: string | null; size: number; color?: string }) {
  if (image) return <Image source={{ uri: image }} style={{ width: size * 1.4, height: size * 1.4, borderRadius: 8 }} resizeMode="contain" />;
  return <ProductImage id={id} size={size} color={color} />;
}

/** Panel que entra desde la derecha, por encima del contenido (drawer). */
export function Drawer({ open, onClose, width = 460, children }: { open: boolean; onClose: () => void; width?: number; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const x = React.useRef(new Animated.Value(width)).current;
  const [mounted, setMounted] = React.useState(open);
  React.useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(x, {
      toValue: open ? 0 : width,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => !open && setMounted(false));
  }, [open, width, x]);
  if (!mounted) return null;
  return (
    <Modal visible transparent onRequestClose={onClose} animationType="none">
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.35)' }} onPress={onClose} accessibilityLabel="Cerrar" />
        <Animated.View
          style={{
            width,
            maxWidth: '100%',
            backgroundColor: C.bg,
            paddingTop: insets.top,
            transform: [{ translateX: x }],
            shadowColor: '#0F172A',
            shadowOpacity: 0.25,
            shadowRadius: 24,
            elevation: 16,
          }}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Consumo presentado como factura. */
export function Receipt({
  title,
  subtitle,
  lines,
  footer,
}: {
  title: string;
  subtitle?: string;
  lines: LineItem[];
  footer?: React.ReactNode;
}) {
  const total = lines.reduce((t, l) => t + l.quantity * l.unit_price, 0);
  return (
    <View style={s.receipt}>
      <View style={{ gap: 2 }}>
        <Text style={s.receiptTitle}>{title}</Text>
        {subtitle ? <Text style={s.receiptSub}>{subtitle}</Text> : null}
      </View>
      <View style={s.receiptRule} />
      {lines.length === 0 ? (
        <Text style={[s.receiptSub, { paddingVertical: 6 }]}>Sin consumo</Text>
      ) : (
        lines.map((l) => (
          <View key={l.product_id} style={s.receiptLine}>
            <Text style={[s.receiptQty, tabular]}>{l.quantity}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.receiptName}>{l.name}</Text>
              <Text style={[s.receiptSub, tabular]}>{money(l.unit_price)} c/u</Text>
            </View>
            <Text style={[s.receiptAmount, tabular]}>{money(l.quantity * l.unit_price)}</Text>
          </View>
        ))
      )}
      <View style={s.receiptRule} />
      <View style={s.receiptLine}>
        <Text style={[s.receiptName, { flex: 1, fontWeight: '700' }]}>Total</Text>
        <Text style={[s.receiptTotal, tabular]}>{money(total)}</Text>
      </View>
      {footer}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return <Text style={s.empty}>{text}</Text>;
}

export const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.brand,
  },
  back: { paddingRight: 2 },
  backText: { fontSize: 32, lineHeight: 34, color: C.onBrand, fontWeight: '300' },
  eyebrow: { fontSize: 12, fontWeight: '600', color: C.onBrandMuted, marginBottom: 1 },
  title: { fontSize: 20, fontWeight: '700', color: C.onBrand, letterSpacing: -0.3 },
  btn: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  card: { backgroundColor: C.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.line },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: C.ink,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 20, lineHeight: 22, color: C.ink },
  stepValue: { minWidth: 26, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.ink },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'center', padding: 20 },
  dialog: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 22,
    gap: 10,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  dialogTitle: { fontSize: 19, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  dialogMsg: { fontSize: 15, color: C.muted, lineHeight: 22 },
  dialogRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  receipt: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: C.line,
  },
  receiptTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  receiptSub: { fontSize: 12, color: C.muted },
  receiptRule: { borderBottomWidth: 1, borderBottomColor: C.line, borderStyle: 'dashed', marginVertical: 2 },
  receiptLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  receiptQty: { minWidth: 24, fontSize: 15, fontWeight: '700', color: C.brand },
  receiptName: { fontSize: 14, color: C.ink },
  receiptAmount: { fontSize: 14, fontWeight: '600', color: C.ink },
  receiptTotal: { fontSize: 18, fontWeight: '800', color: C.ink },
  empty: { textAlign: 'center', color: C.muted, padding: 32, fontSize: 15, lineHeight: 22 },
  label: { fontSize: 12, fontWeight: '600', color: C.muted, marginBottom: 6, letterSpacing: 0.2 },
  h2: { fontSize: 15, fontWeight: '600', color: C.ink },
  muted: { fontSize: 13, color: C.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
