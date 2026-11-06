// When to ask the phone to keep our data. No browser code, so it runs under `node --test`.

/**
 * Ask once only, and only from the installed app: the Safari copy has separate
 * storage (spike W1), and installed apps are what iOS looks at when it decides.
 */
export function shouldAskToKeepData({ installed, supported, alreadyAsked }) {
  return installed && supported && !alreadyAsked;
}
