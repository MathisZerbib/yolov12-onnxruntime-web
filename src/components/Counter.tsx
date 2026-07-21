import { motion, useSpring, useTransform } from 'motion/react';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

import './Counter.css';

type Place = number | '.';

function Number({ mv, number, height }: { mv: ReturnType<typeof useSpring>; number: number; height: number }) {
  const y = useTransform(mv, (latest) => {
    const placeValue = latest % 10;
    const offset = (10 + number - placeValue) % 10;
    let memo = offset * height;
    if (offset > 5) memo -= 10 * height;
    return memo;
  });
  return (
    <motion.span className="counter-number" style={{ y }}>
      {number}
    </motion.span>
  );
}

function normalizeNearInteger(num: number): number {
  const nearest = Math.round(num);
  const tolerance = 1e-9 * Math.max(1, Math.abs(num));
  return Math.abs(num - nearest) < tolerance ? nearest : num;
}

function getValueRoundedToPlace(value: number, place: number): number {
  const scaled = value / place;
  return Math.floor(normalizeNearInteger(scaled));
}

function getDigitAtPlace(value: number, place: number): number {
  return getValueRoundedToPlace(value, place) % 10;
}

function Digit({ place, value, height, digitStyle }: { place: Place; value: number; height: number; digitStyle?: CSSProperties }) {
  const isDecimal = place === '.';
  const valueRoundedToPlace = isDecimal ? 0 : getValueRoundedToPlace(value, place as number);
  const animatedValue = useSpring(valueRoundedToPlace);

  useEffect(() => {
    if (!isDecimal) animatedValue.set(valueRoundedToPlace);
  }, [animatedValue, valueRoundedToPlace, isDecimal]);

  if (isDecimal) {
    return (
      <span className="counter-digit" style={{ height, ...digitStyle, width: 'fit-content' }}>
        .
      </span>
    );
  }

  return (
    <span className="counter-digit" style={{ height, ...digitStyle }}>
      {Array.from({ length: 10 }, (_, i) => (
        <Number key={i} mv={animatedValue} number={i} height={height} />
      ))}
    </span>
  );
}

function trimLeadingZerosInPlace(places: Place[], value: number): Place[] {
  const decimalIndex = places.findIndex((p): p is '.' => p === '.');
  if (decimalIndex === -1) return places; // No decimal point, return as-is
  
  // Check if all integer places have zero value
  const allIntegerPlacesAreZero = places.slice(0, decimalIndex).every((place) => {
    if (typeof place === 'number') {
      return getValueRoundedToPlace(value, place) === 0;
    }
    return false;
  });
  
  // If all integer places are zeros and there's more than one, keep only the smallest place (rightmost)
  if (allIntegerPlacesAreZero && decimalIndex > 0) {
    // Trim trailing zeros after decimal point as well
    const decimalPlaces = places.slice(decimalIndex + 1);
    // Find last significant decimal place (use modulo 10 to get the actual digit)
    let significantDecimalIndex = -1;
    for (let i = decimalPlaces.length - 1; i >= 0; i--) {
      if (typeof decimalPlaces[i] === 'number') {
        const digit = getDigitAtPlace(value, decimalPlaces[i] as number);
        if (digit !== 0) {
          significantDecimalIndex = i;
          break;
        }
      }
    }
    
    // Keep from 1 up to and including the last significant decimal place
    const relevantDecimals = significantDecimalIndex >= 0 
      ? decimalPlaces.slice(0, significantDecimalIndex + 1)
      : [];
    
    return [1, '.', ...relevantDecimals];
  }
  
  return places;
}

export default function Counter({
  value,
  fontSize = 100,
  padding = 0,
  places,
  gap = 8,
  borderRadius = 4,
  horizontalPadding = 8,
  textColor = 'inherit',
  fontWeight = 'inherit',
  containerStyle,
  counterStyle,
  digitStyle,
  gradientHeight = 16,
  gradientFrom = 'black',
  gradientTo = 'transparent',
  topGradientStyle,
  bottomGradientStyle,
  trimLeadingZeros = true,
}: {
  value: number;
  fontSize?: number;
  padding?: number;
  places?: Place[];
  gap?: number;
  borderRadius?: number;
  horizontalPadding?: number;
  textColor?: string;
  fontWeight?: string | number;
  containerStyle?: CSSProperties;
  counterStyle?: CSSProperties;
  digitStyle?: CSSProperties;
  gradientHeight?: number;
  gradientFrom?: string;
  gradientTo?: string;
  topGradientStyle?: CSSProperties;
  bottomGradientStyle?: CSSProperties;
  trimLeadingZeros?: boolean;
}) {
  const computedPlaces = (() => {
    const defaultPlaces = [...value.toString()].map((ch, i, a) => {
      if (ch === '.') return '.';
      return 10 ** (a.indexOf('.') === -1 ? a.length - i - 1 : i < a.indexOf('.') ? a.indexOf('.') - i - 1 : -(i - a.indexOf('.')));
    });
    
    const effectivePlaces = places ?? defaultPlaces;
    return trimLeadingZeros ? trimLeadingZerosInPlace(effectivePlaces, value) : effectivePlaces;
  })();

  const height = fontSize + padding;
  const defaultCounterStyle: CSSProperties = {
    fontSize,
    gap,
    borderRadius,
    paddingLeft: horizontalPadding,
    paddingRight: horizontalPadding,
    color: textColor,
    fontWeight,
    direction: 'ltr',
  };
  const defaultTopGradientStyle: CSSProperties = {
    height: gradientHeight,
    background: `linear-gradient(to bottom, ${gradientFrom}, ${gradientTo})`,
  };
  const defaultBottomGradientStyle: CSSProperties = {
    height: gradientHeight,
    background: `linear-gradient(to top, ${gradientFrom}, ${gradientTo})`,
  };

  return (
    <span className="counter-container" style={containerStyle}>
      <span className="counter-counter" style={{ ...defaultCounterStyle, ...counterStyle }}>
        {computedPlaces.map((place) => (
          <Digit key={String(place)} place={place} value={value} height={height} digitStyle={digitStyle} />
        ))}
      </span>
      <span className="gradient-container">
        <span className="top-gradient" style={topGradientStyle ?? defaultTopGradientStyle} />
        <span className="bottom-gradient" style={bottomGradientStyle ?? defaultBottomGradientStyle} />
      </span>
    </span>
  );
}