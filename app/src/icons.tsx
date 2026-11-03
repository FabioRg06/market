// Ilustraciones de línea (un solo trazo, mismo grosor) para la puerta y los 13 productos.
// Si más adelante hay fotos reales de los productos, se reemplazan en ProductImage.
import React from 'react';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

type IconProps = { size?: number; color?: string; strokeWidth?: number };

function Base({ size = 48, color = '#334155', strokeWidth = 1.8, children }: IconProps & { children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export function DoorGlyph({ size = 22, color = '#334155', fill }: IconProps & { fill?: string }) {
  return (
    <Base size={size} color={color} strokeWidth={3}>
      <Path d="M10 44V6a2 2 0 0 1 2-2h24a2 2 0 0 1 2 2v38" fill={fill} />
      <Path d="M5 44h38" />
      <Circle cx={31} cy={26} r={1.6} fill={color} />
    </Base>
  );
}

export function CloudPending({ size = 16, color = '#64748B' }: IconProps) {
  return (
    <Base size={size} color={color} strokeWidth={3.5}>
      <Path d="M14 36h20a8 8 0 0 0 1-15.9A11 11 0 0 0 13.6 22 7 7 0 0 0 14 36z" />
      <Path d="M24 22v9M24 35v.5" />
    </Base>
  );
}

export function GearGlyph({ size = 22, color = '#334155' }: IconProps) {
  return (
    <Base size={size} color={color} strokeWidth={3}>
      <Circle cx={24} cy={24} r={6} />
      <Path d="M24 4v6M24 38v6M4 24h6M38 24h6M9.9 9.9l4.2 4.2M33.9 33.9l4.2 4.2M9.9 38.1l4.2-4.2M33.9 14.1l4.2-4.2" />
    </Base>
  );
}

const PRODUCTS: Record<string, (p: IconProps) => React.ReactElement> = {
  agua: (p) => (
    <Base {...p}>
      <Rect x={20} y={4} width={8} height={5} rx={1} />
      <Path d="M20 9h8l3 6v25a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3V15z" />
      <Path d="M17 22h14M17 33h14" />
      <Path d="M24 25.5c1.6 1.8 2.2 2.8 2.2 3.6a2.2 2.2 0 0 1-4.4 0c0-.8.6-1.8 2.2-3.6z" />
    </Base>
  ),
  cocacola: (p) => (
    <Base {...p}>
      <Path d="M16 8h16l2 4v24l-2 4H16l-2-4V12z" />
      <Path d="M14 12h20M14 36h20" />
      <Path d="M14 25c3.5-3 7 3 10.5 0s6.5-2 9.5 0" />
      <Path d="M21 8V6h6v2" />
    </Base>
  ),
  gatorade: (p) => (
    <Base {...p}>
      <Rect x={20} y={3} width={8} height={6} rx={1.5} />
      <Path d="M18 9h12v6c-2.5 2-2.5 5 0 7v17a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V22c2.5-2 2.5-5 0-7z" />
      <Path d="M25.5 26l-3.5 5h4l-3.5 5" />
    </Base>
  ),
  hit: (p) => (
    <Base {...p}>
      <Path d="M14 17h20v25H14z" />
      <Path d="M14 17l3.5-6h13l3.5 6" />
      <Path d="M28 11l2.5-7H35" />
      <Circle cx={24} cy={30} r={5} />
      <Path d="M24 25c0-2 1-3 2.5-3.5" />
    </Base>
  ),
  detodito_g: (p) => (
    <Base {...p}>
      <Path d="M11 7h26l-2.5 4v26l2.5 4H11l2.5-4V11z" />
      <Path d="M13.5 11h21M13.5 37h21" />
      <Path d="M18 26l6-7 6 7-6 5z" />
    </Base>
  ),
  detodito_p: (p) => (
    <Base {...p}>
      <Path d="M15 13h18l-2 3.5v15l2 3.5H15l2-3.5v-15z" />
      <Path d="M17 16.5h14M17 31.5h14" />
      <Path d="M20.5 25l3.5-4 3.5 4-3.5 3z" />
    </Base>
  ),
  mani_g: (p) => (
    <Base {...p}>
      <Path d="M12 8h24v31a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3z" />
      <Path d="M12 13h24" />
      <Path d="M21 19a4.5 4.5 0 0 1 6.3 5.3 4.5 4.5 0 1 1-6.3 5.4A4.5 4.5 0 0 1 21 19z" />
    </Base>
  ),
  mani_p: (p) => (
    <Base {...p}>
      <Path d="M16 14h16v22a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 16 36z" />
      <Path d="M16 18h16" />
      <Path d="M22 22.5a3.3 3.3 0 0 1 4.6 3.8 3.3 3.3 0 1 1-4.6 3.9 3.3 3.3 0 0 1 0-7.7z" />
    </Base>
  ),
  salchichas: (p) => (
    <Base {...p}>
      <Ellipse cx={24} cy={15} rx={13} ry={4.5} />
      <Path d="M11 15v18c0 2.5 5.8 4.5 13 4.5s13-2 13-4.5V15" />
      <Ellipse cx={24} cy={15} rx={9} ry={2.5} />
      <Path d="M17 26h14" strokeWidth={4} />
    </Base>
  ),
  crema: (p) => (
    <Base {...p}>
      <Path d="M8 18h24l6 3v6l-6 3H8z" />
      <Path d="M8 18v12M11.5 18v12" />
      <Rect x={38} y={21} width={4} height={6} rx={1} />
      <Path d="M17 24h9" />
    </Base>
  ),
  cepillo: (p) => (
    <Base {...p}>
      <Path d="M8 40l19-19" strokeWidth={4} />
      <Path d="M25 17l6 6 7-7-6-6z" />
      <Path d="M30 9l-2.5-2.5M34 13l-2.5-2.5M38 17l-2.5-2.5" />
    </Base>
  ),
  shampoo: (p) => (
    <Base {...p}>
      <Path d="M21 4h7M26 4v6" />
      <Rect x={21} y={10} width={8} height={4} rx={1} />
      <Path d="M17 14h16a2 2 0 0 1 2 2v24a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V16a2 2 0 0 1 2-2z" />
      <Rect x={19} y={23} width={12} height={9} rx={1.5} />
    </Base>
  ),
  preservativo: (p) => (
    <Base {...p}>
      <Rect x={9} y={9} width={30} height={30} rx={3} />
      <Circle cx={24} cy={24} r={8} />
      <Circle cx={24} cy={24} r={4.5} />
      <Path d="M9 14h30M9 34h30" strokeDasharray="2 3" />
    </Base>
  ),
};

export function ProductImage({ id, size = 56, color }: { id: string; size?: number; color?: string }) {
  const Icon = PRODUCTS[id];
  return Icon ? <Icon size={size} color={color} /> : <Base size={size} color={color}><Rect x={12} y={12} width={24} height={24} rx={4} /></Base>;
}
