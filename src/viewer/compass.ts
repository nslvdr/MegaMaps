/** iOS adds its own compass reading to the standard event. */
interface CompassEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}
type PermissionRequest = { requestPermission?: () => Promise<PermissionState> };

/** Whether the browser wants a tap before it shares the compass (iOS). */
export const compassNeedsPermission = () =>
  typeof (globalThis.DeviceOrientationEvent as PermissionRequest | undefined)?.requestPermission === "function";

/** Asks for the compass; call it from a tap. */
export async function allowCompass() {
  const events = globalThis.DeviceOrientationEvent as PermissionRequest | undefined;
  if (!events) return false;
  try {
    return (await events.requestPermission?.()) !== "denied";
  } catch {
    return false;
  }
}

/** Where the top of the screen points, in degrees clockwise from north. */
export function screenHeading(event: CompassEvent, screenAngle: number) {
  const device = event.webkitCompassHeading ??
    (event.absolute && event.alpha !== null ? 360 - event.alpha : undefined);
  if (device === undefined || !Number.isFinite(device)) return undefined;
  // A phone turned sideways shows its side edge at the top of the screen.
  return (((device + screenAngle) % 360) + 360) % 360;
}

/** Calls back with every heading until the returned stop is called. */
export function watchCompass(onHeading: (degrees: number) => void) {
  // Android reports headings on a separate event; iOS on the usual one.
  const type = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
  const listener = (event: Event) => {
    const heading = screenHeading(event as CompassEvent, globalThis.screen?.orientation?.angle ?? 0);
    if (heading !== undefined) onHeading(heading);
  };
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}
