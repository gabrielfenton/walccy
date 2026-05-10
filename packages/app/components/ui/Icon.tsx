// ──────────────────────────────────────────────
// Walccy UI — Icon
// Typed Feather wrapper with accent-default color.
// ──────────────────────────────────────────────

import React, { type ComponentProps } from 'react';
import { Feather } from '@expo/vector-icons';
import type { StyleProp, TextStyle } from 'react-native';
import { Colors } from '../../constants/colors';

export type FeatherIconName = ComponentProps<typeof Feather>['name'];

export interface IconProps {
  name: FeatherIconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

export function Icon({
  name,
  size = 18,
  color = Colors.accent,
  style,
}: IconProps): React.ReactElement {
  return <Feather name={name} size={size} color={color} style={style} />;
}
