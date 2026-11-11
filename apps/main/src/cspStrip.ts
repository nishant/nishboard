/** Removes only the `frame-ancestors` directive from a Content-Security-Policy
 *  header value, keeping every other directive. Used for the Twitch and
 *  RainViewer embeds, whose frame-ancestors can never match the app:// parent. */
export function stripFrameAncestors(value: string): string {
  return value
    .split(';')
    .filter((directive) => !/^\s*frame-ancestors(\s|$)/i.test(directive))
    .join(';');
}
