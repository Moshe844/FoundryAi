/** Removes terminal control sequences before command evidence is rendered as ordinary UI text. */
export function stripTerminalFormatting(value: string): string {
  return value
    // Standard CSI sequences (including Next/Turbopack's dense SGR output). Keep this explicit
    // pass even though the broader matcher below handles OSC and legacy forms; malformed or
    // concatenated color sequences must never reach the ordinary execution summary UI.
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "")
    .replace(/\r(?!\n)/g, "\n");
}
