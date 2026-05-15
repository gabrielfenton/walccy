// ──────────────────────────────────────────────
// useKeyboardHeight — live keyboard height in px
// ──────────────────────────────────────────────
//
// Under Expo SDK 54 edge-to-edge, neither `adjustResize` nor `adjustPan`
// move the RN view tree out from behind the IME — the composer ends up
// fully occluded by the keyboard. The reliable signal that still works is
// the JS `keyboardDidShow` event's `endCoordinates.height`, which a host
// layout can turn into bottom padding to lift its content above the IME.

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** Current keyboard height in px (0 when hidden). */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS reports `Will*` ahead of the animation; Android only fires `Did*`.
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
