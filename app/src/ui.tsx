// Sistema visual de Market: sobrio y limpio. Superficies blancas, tipografía del sistema,
// un solo color de acción (pizarra oscura) y el estado de cada habitación como único color.
import React from 'react';
import {
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
import type { RoomStatus } from './types';

export const C = {
  bg: '#F5F6F8',
  surface: '#FFFFFF',
  ink: '#0F172A',
  body: '#334155',
  muted: '#64748B',
  faint: '#94A3B8',
  line: '#E2E8F0',
  primary: '#0F172A',
  danger: '#B42318',
  status: {
    sin_revisar: { tint: '#FFFFFF', border: '#E2E8F0', solid: '#94A3B8', ink: '#475569' },
    en_revision: { tint: '#EFF5FF', border: '#C7D9FA', solid: '#3567D6', ink: '#1E4BA8' },
    revisada: { tint: '#FFF7EB', border: '#F2D7AA', solid: '#C77D12', ink: '#8A5308' },
    surtida: { tint: '#EEF8F2', border: '#BFE3CC', solid: '#2E8452', ink: '#1E6139' },
  } as Record<RoomStatus, { tint: string; border: string; solid: string; ink: string }>,
};

/** Números con ancho fijo para que las columnas no bailen. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return <View style={[{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }, style]}>{children}</View>;
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
    backgroundColor: C.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  back: { paddingRight: 2 },
  backText: { fontSize: 32, lineHeight: 34, color: C.ink, fontWeight: '300' },
  eyebrow: { fontSize: 12, fontWeight: '600', color: C.muted, marginBottom: 1 },
  title: { fontSize: 20, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
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
  empty: { textAlign: 'center', color: C.muted, padding: 32, fontSize: 15, lineHeight: 22 },
  label: { fontSize: 12, fontWeight: '600', color: C.muted, marginBottom: 6, letterSpacing: 0.2 },
  h2: { fontSize: 15, fontWeight: '600', color: C.ink },
  muted: { fontSize: 13, color: C.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
